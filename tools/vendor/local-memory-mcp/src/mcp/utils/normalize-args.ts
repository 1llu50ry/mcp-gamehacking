import path from "node:path";
import type { SessionContext } from "../session";
import {
	findContainingRoot,
	getFilesystemRoots,
	inferOwnerFromSession,
	inferRepoFromSession,
	isPathWithinRoots
} from "../session";
import { GITHUB_REPOSITORY, LOCAL_MEMORY_DEFAULT_OWNER, LOCAL_MEMORY_DEFAULT_REPO, envStr } from "./constants";
import { logger } from "./logger";
import { parseRepoInput } from "./normalize";
import { WRITE_TOOLS } from "./tool-plumbing";
import { UUID_REGEX } from "./uuid";

/**
 * Optional call-site context for {@link normalizeToolArguments}.
 *
 * `toolName` lets the normalizer decide whether the call is a write (via
 * {@link WRITE_TOOLS}) so it can fail loud rather than silently targeting the
 * daemon CWD. `isWrite` is an explicit override for callers that already know
 * the write-ness and want to avoid re-deriving it.
 */
export type NormalizeToolArgumentsOptions = {
	toolName?: string;
	isWrite?: boolean;
};

/**
 * Tools where `agent`/`model` are CALLER-SUPPLIED SEMANTICS — a filter or a
 * mode discriminator — NOT write-attribution metadata. The session-wide
 * lazy-capture at the end of {@link normalizeToolArguments} must NOT auto-fill
 * them, because an omitted `agent` would silently become "the connected
 * client's name" and change the operation:
 *
 * - `claim-manage` RELEASE narrows its UPDATE to `AND agent = ?`, so a claim
 *   held by a different agent reports "No active claim found" even though the
 *   claim is active (observed: client `opencode` releasing a claim held by
 *   `backend`).
 * - `handoff-read` treats a present `agent` as the LIST-CLAIMS discriminator
 *   (`claim:true` OR `agent`), so every handoff list/search silently became
 *   "claims for <clientName>" and returned 0 rows.
 *
 * Attribution-writing tools (memory-write, task-write, standard-write,
 * observation-write, …) keep the injection: there `agent` records who
 * performed the write, which is exactly what the session fallback is for.
 */
export const AGENT_SEMANTIC_TOOLS: ReadonlySet<string> = new Set(["claim-manage", "handoff-read"]);

/** True only for a non-empty (post-trim) string — the "explicitly provided" test. */
function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

// ── Owner-inference warning dedup (FIX-029) ──────────────────────────────
// The "owner inferred from session — may be incorrect" advisory used to be
// emitted on EVERY scope-less call (6903 occurrences observed; bursts of 52
// in one minute) because the derived JSON Schema drops owner/repo from
// `required` and agents legitimately omit them. The advisory is useful ONCE
// per scope, not per call, so it is now rate-limited per (owner, repo,
// session) with a fixed interval and a bounded key set.
const OWNER_WARN_INTERVAL_MS = 60_000;
/** Hard cap on retained dedup keys — bounds memory under many sessions. */
const OWNER_WARN_MAX_KEYS = 512;

/** key → epoch-ms of the last emitted advisory for that (owner,repo,session). */
const ownerWarnTimestamps = new Map<string, number>();

/**
 * Clears the owner-inference warning dedup state.
 *
 * Exported so long-lived daemons (and tests) can reset the rate-limiter
 * deterministically without waiting for the interval to elapse.
 */
export function resetOwnerWarnDedup(): void {
	ownerWarnTimestamps.clear();
	envScopeLogTimestamps.clear();
}

/**
 * Emits the owner-inference advisory at most once per
 * `OWNER_WARN_INTERVAL_MS` for a given `(owner, repo, sessionId)` triple.
 *
 * @param owner    the owner that was inferred from the session
 * @param repo     the (slash-less) repo the call was scoped to
 * @param session  current session context (its `sessionId` partitions keys)
 */
function warnOwnerInferred(owner: string, repo: string, session?: SessionContext): void {
	const key = `${owner}\u0000${repo}\u0000${session?.sessionId ?? ""}`;
	const now = Date.now();
	const last = ownerWarnTimestamps.get(key);
	if (last !== undefined && now - last < OWNER_WARN_INTERVAL_MS) return;

	// Bound the key set: evict the oldest entry when at capacity.
	if (!ownerWarnTimestamps.has(key) && ownerWarnTimestamps.size >= OWNER_WARN_MAX_KEYS) {
		const oldest = ownerWarnTimestamps.keys().next().value;
		if (oldest !== undefined) ownerWarnTimestamps.delete(oldest);
	}
	ownerWarnTimestamps.set(key, now);

	logger.warn(
		`[normalize-args] owner inferred from session (${owner}) — may be incorrect. Agents should pass explicit owner/repo.`
	);
}

// ── Env-default scope resolution (FIX-110-A) ─────────────────────────────
// A remote HTTP client that does NOT advertise MCP roots cannot supply a
// workspace root, and a daemon whose CWD is `/` derives no plausible scope —
// so resolution used to fail with "configure MCP workspace roots". This tier
// sits AFTER roots/session inference and BEFORE the CWD fallback:
//   explicit args > roots/session inference > LOCAL_MEMORY_DEFAULT_OWNER/REPO
//   > GITHUB_REPOSITORY ("owner/repo") > daemon cwd.
// Values are read at CALL TIME (live `process.env` via `envStr`, falling back
// to the module-load snapshot) so tests can stub the env without a reload.
export type EnvScopeDefaults = {
	owner?: string;
	repo?: string;
	source?: "local-memory-default" | "github-repository";
};

/** Resolve the env-default owner/repo tier (see {@link EnvScopeDefaults}). */
export function resolveEnvScopeDefaults(): EnvScopeDefaults {
	const owner = envStr("LOCAL_MEMORY_DEFAULT_OWNER", LOCAL_MEMORY_DEFAULT_OWNER);
	const repo = envStr("LOCAL_MEMORY_DEFAULT_REPO", LOCAL_MEMORY_DEFAULT_REPO);
	if (owner || repo) {
		return { owner, repo, source: "local-memory-default" };
	}
	const combined = envStr("GITHUB_REPOSITORY", GITHUB_REPOSITORY);
	if (combined && combined.includes("/")) {
		const idx = combined.indexOf("/");
		const ghOwner = combined.slice(0, idx).trim();
		const ghRepo = combined.slice(idx + 1).trim();
		if (ghOwner && ghRepo) return { owner: ghOwner, repo: ghRepo, source: "github-repository" };
	}
	return {};
}

/** Dedup keys for the env-scope debug log (mirrors the owner-warn limiter). */
const envScopeLogTimestamps = new Map<string, number>();

/**
 * Emits, at most once per `OWNER_WARN_INTERVAL_MS` per `(source, scope,
 * session)`, a debug line naming which env tier resolved the scope. Rate-
 * limited so a busy rootless daemon does not log on every tool call.
 */
function logEnvScopeResolved(env: EnvScopeDefaults, owner?: string, repo?: string, session?: SessionContext): void {
	const key = `${env.source}\u0000${owner ?? ""}\u0000${repo ?? ""}\u0000${session?.sessionId ?? ""}`;
	const now = Date.now();
	const last = envScopeLogTimestamps.get(key);
	if (last !== undefined && now - last < OWNER_WARN_INTERVAL_MS) return;

	if (!envScopeLogTimestamps.has(key) && envScopeLogTimestamps.size >= OWNER_WARN_MAX_KEYS) {
		const oldest = envScopeLogTimestamps.keys().next().value;
		if (oldest !== undefined) envScopeLogTimestamps.delete(oldest);
	}
	envScopeLogTimestamps.set(key, now);

	logger.debug(
		`[normalize-args] owner/repo resolved from env default (${env.source}): owner=${owner ?? "(none)"} repo=${repo ?? "(none)"}`
	);
}

/**
 * Identifier argument keys that, when carrying a UUID, make a write
 * self-scoping: the handler resolves the stored entity by id and inherits that
 * entity's owner/repo, so the daemon CWD is never consulted (TASK-420).
 */
const IDENTIFIER_KEYS = [
	"id",
	"ids",
	"task_id",
	"task_ids",
	"memory_id",
	"memory_ids",
	"handoff_id",
	"standard_id",
	"standard_ids"
] as const;

/** Whether any identifier argument carries a UUID (an entity-self-scoping write). */
function hasUuidIdentifier(args: Record<string, unknown>): boolean {
	for (const key of IDENTIFIER_KEYS) {
		const value = args[key];
		if (typeof value === "string" && UUID_REGEX.test(value)) return true;
		if (Array.isArray(value) && value.some((item) => typeof item === "string" && UUID_REGEX.test(item))) {
			return true;
		}
	}
	return false;
}

/**
 * Whether a write's scope is determinable WITHOUT the daemon CWD fallback:
 *   - the call addresses an existing entity by UUID (`id`/`ids`/…), whose own
 *     owner/repo is inherited by the handler; or
 *   - the call is interactive (`interactive: true`) — the scope is elicited
 *     from the user before any write.
 *
 * A code-addressed or pure-create write with no explicit owner/repo and no MCP
 * roots is NOT exempt: its target would silently fall back to the daemon CWD.
 */
function isScopeResolvableWithoutCwd(args: Record<string, unknown>): boolean {
	return args.interactive === true || hasUuidIdentifier(args);
}

/**
 * Validates that an absolute path value stays within the active MCP roots.
 * Throws if the path is absolute and not within any registered root.
 */
export function validateRootBoundPath(value: unknown, field: string, session?: SessionContext): void {
	if (typeof value !== "string" || !path.isAbsolute(value)) {
		return;
	}

	if (!isPathWithinRoots(value, session)) {
		throw new Error(`${field} must stay within the active MCP roots`);
	}
}

/**
 * Record-valued argument fields whose inner empty strings are legitimate stored
 * data — they must never be stripped or recursed into. Matched by field name AND
 * plain-object value: a string-valued `context` (memory/standard) is still an
 * empty-string parameter and is stripped like any other (FIX-EMPTY-PARAMS).
 */
const RECORD_VALUED_FIELDS = new Set(["metadata", "context", "args"]);

/**
 * Clones an argument value, deleting every object key whose value is exactly
 * the empty string and recursing into plain objects and array items.
 *
 * Empty strings are "not provided" for every tool parameter (universal policy,
 * FIX-EMPTY-PARAMS). Record-valued fields (`metadata`/`context`/`args`) are
 * copied verbatim — their inner empty strings are stored data, not parameters —
 * and array ELEMENTS are preserved (`tags: [""]` stays intact). The input value
 * is never mutated.
 *
 * @param value  Raw argument value (object, array, or primitive).
 * @returns A structurally-cloned value with empty-string object keys removed.
 */
function stripEmptyStringKeys(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => stripEmptyStringKeys(item));
	}
	if (value === null || typeof value !== "object") {
		return value;
	}

	const source = value as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(source)) {
		if (child === "") continue; // exact empty string → treat as not provided
		const isRecordValued =
			RECORD_VALUED_FIELDS.has(key) && child !== null && typeof child === "object" && !Array.isArray(child);
		out[key] = isRecordValued ? child : stripEmptyStringKeys(child);
	}
	return out;
}

/**
 * Normalizes tool call arguments by injecting owner/repo/scope from session
 * context when not explicitly provided. Handles string scope (JSON or plain
 * repo name), session-wide owner/repo preference, agent/model lazy capture,
 * and scope.folder derivation from current_file_path.
 *
 * Before any session fill, every empty-string parameter (at any nesting depth)
 * is stripped so it is treated as "not provided" (FIX-EMPTY-PARAMS).
 *
 * Used by both the upstream MCP router (router.ts) and the native MCP SDK
 * tool registration (tools/index.ts).
 *
 * SCOPE PRIORITY (TASK-420): explicit args always win, then roots-derived
 * values (`inferRepoFromSession`/`inferOwnerFromSession`), and only then the
 * CWD-derived `session.repo`/`session.owner`. This keeps a client that declared
 * MCP roots pinned to its project even when the daemon's CWD differs.
 *
 * WRITE FAIL-LOUD (TASK-420): when `options.isWrite` is true (or
 * `options.toolName` is in {@link WRITE_TOOLS}) and the scope is genuinely
 * undeterminable — no explicit owner/repo, no MCP roots — an HTTP/daemon
 * session (`session.transport === "http"`) throws rather than silently writing
 * to the daemon working directory. A stdio session stays permissive (its CWD IS
 * the client's project). Reads stay permissive and are tagged with a
 * `__scopeInferred` marker for observability.
 *
 * @param args  Raw tool arguments — may be `unknown` from params?.arguments.
 * @param session  Current session context (optional in router.ts path).
 * @param options  Optional call-site context (`toolName`/`isWrite`).
 * @returns Normalized args with owner/repo/scope/agent/model populated.
 */
export function normalizeToolArguments(
	args: unknown,
	session?: SessionContext,
	options?: NormalizeToolArgumentsOptions
): Record<string, unknown> {
	if (!args || typeof args !== "object") {
		return args as Record<string, unknown>;
	}

	const isWrite = options?.isWrite ?? (options?.toolName ? WRITE_TOOLS.has(options.toolName) : undefined);

	const anyArgs = args as Record<string, unknown>;
	const strippedArgs = stripEmptyStringKeys(anyArgs) as Record<string, unknown>;
	const scopeVal = strippedArgs.scope;
	const nextArgs: Record<string, unknown> = {
		...strippedArgs,
		// Handle string scope gracefully:
		//   "my-repo" → { repo: "my-repo" }
		//   '{"owner":"vheins","repo":"my-repo"}' → { owner: "vheins", repo: "my-repo" }
		scope:
			typeof scopeVal === "string"
				? (() => {
						try {
							const parsed = JSON.parse(scopeVal);
							if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
								return stripEmptyStringKeys(parsed) as Record<string, unknown>;
							}
						} catch {
							/* not JSON, treat as plain repo name */
						}
						return { repo: scopeVal };
					})()
				: scopeVal
					? (stripEmptyStringKeys(scopeVal) as Record<string, unknown>)
					: undefined
	};

	validateRootBoundPath(nextArgs.current_file_path, "current_file_path", session);
	validateRootBoundPath(nextArgs.doc_path, "doc_path", session);

	const scope = nextArgs.scope as Record<string, unknown> | undefined;

	// ── Explicit-scope detection (pre-injection) ─────────────────────────────
	// Captured before any session/roots fill so the write fail-loud guard and
	// the `__scopeInferred` marker can tell a caller-supplied scope from one we
	// derived from the session/CWD.
	const explicitScopeArg =
		isNonEmptyString(nextArgs.repo) ||
		isNonEmptyString(nextArgs.owner) ||
		isNonEmptyString(scope?.repo) ||
		isNonEmptyString(scope?.owner);
	const rootsEmpty = getFilesystemRoots(session).length === 0;

	// Env-default tier (FIX-110-A) — resolved once, applied only where the
	// roots/session inference above yielded nothing. `envRepoApplied` records
	// whether the WRITE DESTINATION (repo) came from env, which suppresses the
	// CWD-fallback write guard below (the scope is no longer CWD-derived).
	const envDefaults = resolveEnvScopeDefaults();
	let envRepoApplied = false;

	// ── Repo resolution: roots-derived, then env default, then CWD session ───
	// `inferRepoFromSession` reads the declared MCP roots (single-root →
	// basename). Only when it yields nothing do we consult the env-default tier
	// (LOCAL_MEMORY_DEFAULT_REPO > GITHUB_REPOSITORY), and only then the
	// session's CWD-derived `repo` (TASK-420 priority inversion + FIX-110-A).
	if (!nextArgs.repo) {
		nextArgs.repo = inferRepoFromSession(session);
	}
	if (!nextArgs.repo && envDefaults.repo) {
		nextArgs.repo = envDefaults.repo;
		envRepoApplied = true;
	}
	if (!nextArgs.repo && session?.repo) {
		nextArgs.repo = session.repo;
	}

	if (scope && !scope.repo) {
		scope.repo = (nextArgs.repo as string) ?? inferRepoFromSession(session);
	}

	// An owner is explicit only when it is a non-empty (after trim) string. An
	// empty or whitespace-only owner is treated as "not provided" and dropped so
	// the fallback chain below runs (FIX-OWNER-EMPTY). A non-empty owner stays
	// authoritative and is never re-inferred from the session or the repo string
	// (FIX-OWNER-INFER).
	const ownerValue = nextArgs.owner;
	const ownerExplicit = typeof ownerValue === "string" && ownerValue.trim().length > 0;
	if (typeof ownerValue === "string" && !ownerExplicit) {
		delete nextArgs.owner;
	}

	// Owner resolution mirrors the repo rule (TASK-420 + FIX-110-A): an explicit
	// `owner` (or the owner segment of an `owner/repo` string) wins, then the
	// roots-derived owner (`inferOwnerFromSession`), then the env-default owner
	// (LOCAL_MEMORY_DEFAULT_OWNER > GITHUB_REPOSITORY), and only then the
	// CWD-derived `session.owner`.
	if (!ownerExplicit && !nextArgs.owner) {
		const repoVal = (nextArgs.repo as string) || "";
		const parsed = parseRepoInput(repoVal, undefined);
		const inferredOwner = parsed.owner || inferOwnerFromSession(session) || envDefaults.owner || session?.owner;
		if (inferredOwner !== undefined) {
			nextArgs.owner = inferredOwner;
			if (!repoVal.includes("/")) {
				// Rate-limited per (owner, repo, session) — see warnOwnerInferred
				// (FIX-029). The advisory is emitted once per scope, not per call.
				warnOwnerInferred(inferredOwner, repoVal, session);
			}
		}
	}

	// Scope owner mirrors the top-level rule: an empty/whitespace-only
	// scope.owner is treated as "not provided" and dropped, then derived from
	// the scoped repo / resolved top-level owner (FIX-OWNER-EMPTY). A non-empty
	// scope.owner stays authoritative and is kept as-is (FIX-OWNER-INFER).
	const scopeOwnerValue = scope?.owner;
	const scopeOwnerExplicit = typeof scopeOwnerValue === "string" && scopeOwnerValue.trim().length > 0;
	if (scope && typeof scopeOwnerValue === "string" && !scopeOwnerExplicit) {
		delete scope.owner;
	}
	if (scope && !scopeOwnerExplicit) {
		const repoVal = (scope.repo as string) || (nextArgs.repo as string) || "";
		const parsed = parseRepoInput(repoVal, undefined);
		const inferredOwner =
			parsed.owner || (nextArgs.owner as string) || (ownerExplicit ? undefined : inferOwnerFromSession(session));
		if (inferredOwner !== undefined) {
			scope.owner = inferredOwner;
		}
	}

	// `nextArgs.owner` is already normalized above, so an empty/whitespace owner
	// can no longer shadow session inference here (FIX-OWNER-EMPTY).
	const ownerVal = (nextArgs.owner as string) ?? inferOwnerFromSession(session) ?? undefined;
	const repoVal = (nextArgs.repo as string) ?? inferRepoFromSession(session) ?? undefined;
	const memories = nextArgs.memories as Array<Record<string, unknown>> | undefined;
	if (memories) {
		for (const mem of memories) {
			const memScope = mem.scope as Record<string, unknown> | undefined;
			if (memScope) {
				// Empty/whitespace-only memory-scope owners are "not provided"
				// too, so they are filled from the resolved owner/repo
				// (FIX-OWNER-EMPTY).
				const memOwner = memScope.owner;
				if (memOwner == null || (typeof memOwner === "string" && memOwner.trim().length === 0)) {
					delete memScope.owner;
					const inferredMemOwner =
						ownerVal || parseRepoInput((memScope.repo as string) || repoVal || "", undefined).owner;
					if (inferredMemOwner) memScope.owner = inferredMemOwner;
				}
				if (!memScope.repo && repoVal) memScope.repo = repoVal;
			}
		}
	}

	if (typeof nextArgs.current_file_path === "string" && scope) {
		const containingRoot = path.isAbsolute(nextArgs.current_file_path)
			? findContainingRoot(nextArgs.current_file_path, session)
			: null;

		if (containingRoot) {
			const relativePath = path.relative(containingRoot, path.resolve(nextArgs.current_file_path));
			const relativeFolder = path.dirname(relativePath);
			if (relativeFolder && relativeFolder !== "." && !scope.folder) {
				scope.folder = relativeFolder;
			}
		}
	}

	// ── Scope-provenance guard (TASK-420 + FIX-110-A) ────────────────────────
	// The scope is "CWD-derived only" when the caller supplied no explicit
	// owner/repo, the session declared no MCP roots, AND the env-default tier
	// did not resolve the repo. When env resolved the repo, the destination is
	// operator-configured — not the daemon CWD — so the write guard must NOT
	// fire (FIX-110-A).
	const scopeFromCwdFallback = !explicitScopeArg && rootsEmpty && !envRepoApplied;

	// Emit the resolution provenance (rate-limited) so operators can see WHICH
	// tier supplied the scope when debugging a rootless client.
	if (envRepoApplied || (envDefaults.owner && nextArgs.owner === envDefaults.owner)) {
		logEnvScopeResolved(envDefaults, nextArgs.owner as string, nextArgs.repo as string, session);
	}

	// The fail-loud guard fires for HTTP/daemon serving ONLY. Under HTTP the
	// process CWD is the daemon's working directory, NOT the caller's project,
	// so a CWD-derived scope would silently write to the wrong repo. Under
	// stdio the process CWD IS the client's project (one client per process),
	// so the historical CWD-derived scope is correct and MUST stay permissive —
	// a stdio client that does not advertise MCP roots always has `roots === []`,
	// and failing loud there would be a backward-compatibility regression.
	if (
		isWrite === true &&
		scopeFromCwdFallback &&
		session?.transport === "http" &&
		!isScopeResolvableWithoutCwd(nextArgs)
	) {
		// FAIL-LOUD: refuse to silently write to the daemon CWD. The dispatch
		// layer wraps thrown errors into the canonical error envelope.
		//
		// Exemption: an id-addressed write (UUID `id`/`ids`/…) or an interactive
		// (elicitation) write resolves its scope from the stored entity or the
		// user, not the CWD, so it is not at risk of a silent cross-project
		// write. Only a genuinely undeterminable scope fails loud.
		throw new Error(
			"owner/repo could not be determined for a write operation — pass explicit owner/repo or connect from a " +
				"project root (MCP roots). Refusing to write to the daemon working directory."
		);
	}

	if (isWrite !== true && scopeFromCwdFallback) {
		// READ (or unknown) stays permissive, but is tagged so callers/tests can
		// observe that the scope was inferred rather than supplied. Handlers
		// ignore unknown keys (Zod objects strip them; the SDK JSON Schema keeps
		// additional properties open), so the marker never reaches persistence.
		nextArgs.__scopeInferred = true;
	}

	// Lazy capture model & agent — fall back to session-wide values when
	// args are not provided. lastSeenAgent/lastSeenModel are set once at
	// oninitialized and never mutated afterward.
	//
	// FIX-CLAIM-AGENT-INJECT: for tools where `agent` is caller-supplied
	// SEMANTICS (a filter or a mode discriminator — see AGENT_SEMANTIC_TOOLS),
	// an omitted `agent` MUST stay omitted. Filling it with the connected
	// client's name silently narrowed `claim-manage` RELEASE to the caller's
	// own claims and flipped `handoff-read` into LIST-CLAIMS. Attribution
	// tools keep the fallback: there `agent` records who wrote the row.
	if (!options?.toolName || !AGENT_SEMANTIC_TOOLS.has(options.toolName)) {
		nextArgs.agent ??= session?.lastSeenAgent ?? session?.clientName ?? process.env.MCP_CLIENT_NAME;
	}
	nextArgs.model ??= session?.lastSeenModel ?? process.env.MCP_MODEL;

	return nextArgs;
}
