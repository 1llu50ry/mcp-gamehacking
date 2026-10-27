import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { inferOwnerFromGitRemote } from "./utils/owner";

export type McpRoot = {
	uri: string;
	name?: string;
};

export type SessionContext = {
	clientInfo?: {
		name?: string;
		version?: string;
	};
	clientCapabilities?: Record<string, unknown>;
	roots: McpRoot[];
	supportsRoots: boolean;
	supportsSampling: boolean;
	supportsSamplingTools: boolean;
	supportsElicitation: boolean;
	supportsElicitationForm: boolean;
	supportsElicitationUrl: boolean;

	// Session-wide resolved defaults (populated once at startup)
	owner?: string;
	repo?: string;
	projectPath?: string;

	// Opaque process-local correlation identifier; never derived from prompt text.
	sessionId?: string;

	// From initialize handshake (per-connection)
	clientName?: string;
	clientVersion?: string;

	// Lazy-captured from args — fallback for subsequent tool calls
	lastSeenModel?: string;
	lastSeenAgent?: string;

	// Serving transport that created this session. "stdio" means the process CWD
	// IS the client's project (one client per process), so a CWD-derived scope is
	// safe. "http" means the process serves MANY clients from the daemon's own
	// CWD, so a CWD-derived scope is NOT the caller's project. Defaults to
	// "stdio" for backward compatibility with every existing caller.
	transport?: "stdio" | "http";
};

/**
 * Structural OS/XDG path segments that can NEVER be a real GitHub owner or
 * repository name. `inferOwnerFromSession`/`inferRepoFromSession` (and the
 * CWD-derived defaults in {@link createSessionContext}) used to fall back to
 * the parent-directory / basename of the working directory, which produced
 * spurious owners such as `home` (from `/home/<user>`) and `.config`
 * (FIX-029) — writes scoped to those wrong-scope owners silently mis-filed
 * data. A segment on this list — or any dotfile — is a path artifact, not a
 * project scope.
 */
const RESERVED_PATH_SEGMENTS = new Set([
	"home",
	"users",
	"root",
	"tmp",
	"var",
	"usr",
	"opt",
	"etc",
	"mnt",
	"media",
	"srv",
	"bin",
	"sbin",
	"lib",
	"lib64",
	"boot",
	"dev",
	"proc",
	"sys",
	"run",
	"applications",
	"library",
	"system",
	"volumes",
	"private",
	"windows",
	"program files",
	"programdata"
]);

/**
 * Whether a raw path segment is a plausible owner/repo identifier.
 *
 * Rejects (FIX-029): empty/whitespace segments, dotfiles / hidden dirs
 * (`.config`, `.cache`, …) and reserved OS/XDG structural directories
 * (`home`, `tmp`, `usr`, …). Legitimate project directories pass.
 */
export function isPlausibleScopeSegment(segment: string | undefined): segment is string {
	if (!segment) return false;
	const trimmed = segment.trim();
	if (trimmed.length === 0) return false;
	if (trimmed.startsWith(".")) return false;
	return !RESERVED_PATH_SEGMENTS.has(trimmed.toLowerCase());
}

export function createSessionContext(transport: "stdio" | "http" = "stdio"): SessionContext {
	const cwd = process.cwd();
	const repo = path.basename(cwd);
	const projectPath = cwd;

	let owner: string | undefined = inferOwnerFromGitRemote(cwd);
	if (!owner) {
		const parts = cwd.split(path.sep).filter(Boolean);
		if (parts.length >= 2) {
			const candidate = parts[parts.length - 2];
			if (isPlausibleScopeSegment(candidate)) {
				owner = candidate;
			}
		}
	}

	return {
		roots: [],
		supportsRoots: false,
		supportsSampling: false,
		supportsSamplingTools: false,
		supportsElicitation: false,
		supportsElicitationForm: false,
		supportsElicitationUrl: false,
		// NEW
		owner,
		repo,
		projectPath,
		sessionId: randomUUID(),
		clientName: undefined,
		clientVersion: undefined,
		lastSeenModel: undefined,
		lastSeenAgent: undefined,
		transport
	};
}

export function updateSessionFromInitialize(session: SessionContext, params: Record<string, unknown>): void {
	const capabilities = (params?.capabilities || {}) as Record<string, unknown>;
	session.clientInfo = params?.clientInfo as { name?: string; version?: string };
	session.clientCapabilities = capabilities;
	session.supportsRoots = Boolean(capabilities.roots);
	session.supportsSampling = Boolean(capabilities.sampling);
	const sampling = capabilities.sampling as Record<string, unknown> | undefined;
	session.supportsSamplingTools = Boolean(sampling?.tools);
	session.supportsElicitation = Boolean(capabilities.elicitation);
	session.supportsElicitationForm = supportsElicitationMode(capabilities.elicitation, "form");
	session.supportsElicitationUrl = supportsElicitationMode(capabilities.elicitation, "url");
}

function supportsElicitationMode(capability: unknown, mode: "form" | "url"): boolean {
	if (!capability || typeof capability !== "object") {
		return false;
	}

	const cap = capability as Record<string, unknown>;

	if (mode === "form") {
		return Object.keys(cap).length === 0 || typeof cap.form === "object";
	}

	return typeof cap.url === "object";
}

export function updateSessionRoots(session: SessionContext, roots: McpRoot[]): boolean {
	const normalized = normalizeRoots(roots);
	const previous = JSON.stringify(session.roots);
	const next = JSON.stringify(normalized);
	session.roots = normalized;
	return previous !== next;
}

/**
 * Applies the client's MCP roots to a session and recomputes the session-wide
 * scoping defaults (`repo`, `owner`, `projectPath`) from them.
 *
 * Derivation:
 *   - `repo` / `owner` are recomputed via `inferRepoFromSession` /
 *     `inferOwnerFromSession`, which already understand the single-root vs.
 *     rootless (CWD fallback) cases. Values are only assigned when inference
 *     produces one — a multi-root session yields `undefined` and deliberately
 *     leaves any prior value intact rather than blanking it.
 *   - `projectPath` is set to the first filesystem root when one exists; when
 *     the session is rootless the CWD-derived default is left untouched.
 *
 * @returns Whether the stored root set actually changed.
 */
export function applySessionRoots(session: SessionContext, roots: unknown): boolean {
	const changed = updateSessionRoots(session, normalizeRoots(roots));

	const repo = inferRepoFromSession(session);
	if (repo !== undefined) {
		session.repo = repo;
	}

	const owner = inferOwnerFromSession(session);
	if (owner !== undefined) {
		session.owner = owner;
	}

	const filesystemRoots = getFilesystemRoots(session);
	if (filesystemRoots.length > 0) {
		session.projectPath = filesystemRoots[0];
	}

	return changed;
}

export function normalizeRoots(roots: unknown): McpRoot[] {
	if (!Array.isArray(roots)) return [];

	const seen = new Set<string>();
	const normalized: McpRoot[] = [];

	for (const root of roots) {
		if (!root || typeof root !== "object") continue;

		const r = root as Record<string, unknown>;
		const uri = typeof r.uri === "string" ? r.uri : undefined;
		const name = typeof r.name === "string" ? r.name : undefined;

		if (!uri || seen.has(uri)) continue;
		seen.add(uri);
		normalized.push({ uri, name });
	}

	return normalized;
}

export function extractRootsFromResult(result: unknown): McpRoot[] {
	return normalizeRoots((result as Record<string, unknown>)?.roots);
}

export function getFilesystemRoots(session?: SessionContext): string[] {
	if (!session) return [];

	const resolved: string[] = [];
	for (const root of session.roots) {
		if (!root.uri.startsWith("file://")) continue;
		try {
			resolved.push(path.resolve(fileURLToPath(root.uri)));
		} catch {
			// Ignore malformed file URIs.
		}
	}
	return resolved;
}

export function isPathWithinRoots(targetPath: string, session?: SessionContext): boolean {
	const roots = getFilesystemRoots(session);
	if (roots.length === 0) return true;

	const normalizedTarget = path.resolve(targetPath);
	return roots.some((rootPath) => {
		const relative = path.relative(rootPath, normalizedTarget);
		return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
	});
}

export function findContainingRoot(targetPath: string, session?: SessionContext): string | null {
	const roots = getFilesystemRoots(session);
	if (roots.length === 0) return null;

	const normalizedTarget = path.resolve(targetPath);
	for (const rootPath of roots) {
		const relative = path.relative(rootPath, normalizedTarget);
		if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
			return rootPath;
		}
	}

	return null;
}

export function inferRepoFromSession(session?: SessionContext): string | undefined {
	const roots = getFilesystemRoots(session);
	if (roots.length === 1) {
		const candidate = path.basename(roots[0]);
		// FIX-029: a basename that is a path artifact (dotfile / reserved OS dir)
		// is never a repository name — do not fabricate one.
		return isPlausibleScopeSegment(candidate) ? candidate : undefined;
	}
	if (roots.length === 0) {
		if (!session) return undefined;
		const cwd = process.cwd();
		const candidate = path.basename(cwd);
		// FIX-029: the rootless CWD fallback must not yield `home`, `.config`, …
		return isPlausibleScopeSegment(candidate) ? candidate : undefined;
	}
	return undefined;
}

/**
 * Resolves the owner for a session, when one can be determined.
 *
 * Inference order:
 *   1. GitHub remote origin of the active root (or the CWD when the session
 *      has no file roots) — via the shared `inferOwnerFromGitRemote` helper;
 *   2. parent directory name of a single explicit file root (a deterministic
 *      signal the client chose that root — e.g. /Users/alice/myrepo → "alice").
 *
 * No owner is fabricated when the session is rootless: with no explicit root
 * and no git remote, the CWD's parent directory is NOT treated as an owner
 * (FIX-OWNER-INFER — it previously produced spurious owners such as the
 * dashboard's working directory for repo-only scoped calls).
 */
export function inferOwnerFromSession(session?: SessionContext): string | undefined {
	const roots = getFilesystemRoots(session);

	// Determine the working directory to check git remote
	let cwd: string | undefined;
	if (roots.length === 1) {
		cwd = roots[0];
	} else if (roots.length === 0 && session) {
		cwd = process.cwd();
	}

	// Primary: infer from git remote origin
	if (cwd) {
		const gitOwner = inferOwnerFromGitRemote(cwd);
		if (gitOwner) return gitOwner;
	}

	// Fallback: infer from the parent directory name of a single explicit root
	// (git remote absent). Deliberately NOT applied to the rootless CWD case.
	if (roots.length === 1) {
		const parts = roots[0].split(path.sep).filter(Boolean);
		if (parts.length >= 2) {
			const candidate = parts[parts.length - 2];
			// FIX-029: reject path-basename owners (`home`, `.config`, dotfiles,
			// reserved OS dirs) — a structural path segment is not a real owner.
			if (isPlausibleScopeSegment(candidate)) {
				return candidate;
			}
		}
	}
	return undefined;
}
