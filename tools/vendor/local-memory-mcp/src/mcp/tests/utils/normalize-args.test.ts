import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeToolArguments, resetOwnerWarnDedup, validateRootBoundPath } from "../../utils/normalize-args";
import { inferOwnerFromSession, inferRepoFromSession, type SessionContext } from "../../session";
import { logger } from "../../utils/logger";

vi.mock("../../session", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../session")>();
	return {
		...actual,
		inferOwnerFromSession: vi.fn(),
		inferRepoFromSession: vi.fn()
	};
});

// FIX-110-A: `utils/constants.ts` captures GITHUB_REPOSITORY /
// LOCAL_MEMORY_DEFAULT_* as MODULE-LOAD snapshot constants. GitHub Actions
// exports GITHUB_REPOSITORY=<owner>/<repo> for the repo being built, so in CI
// the snapshot is populated and would otherwise activate the env-default
// scope tier in EVERY test that does not stub the env explicitly, overriding
// the session/CWD scope these tests assert. Neutralize the snapshot to
// `undefined`; the env-tier tests below still stub `process.env` per-test via
// `vi.stubEnv`, which `envStr` reads at call time.
vi.mock("../../utils/constants", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../utils/constants")>();
	return {
		...actual,
		GITHUB_REPOSITORY: undefined,
		LOCAL_MEMORY_DEFAULT_OWNER: undefined,
		LOCAL_MEMORY_DEFAULT_REPO: undefined
	};
});

const ROOT = process.cwd();

function makeSession(overrides: Partial<SessionContext> = {}): SessionContext {
	return {
		roots: [{ uri: pathToFileURL(ROOT).href, name: "workspace" }],
		supportsRoots: true,
		supportsSampling: false,
		supportsSamplingTools: false,
		supportsElicitation: false,
		supportsElicitationForm: false,
		supportsElicitationUrl: false,
		...overrides
	};
}

beforeEach(() => {
	vi.mocked(inferOwnerFromSession).mockReset();
	vi.mocked(inferRepoFromSession).mockReset();
	// FIX-029: the owner-inference advisory is rate-limited per
	// (owner, repo, session) via module-level state; reset it between tests so
	// each test observes the first emission deterministically.
	// FIX-110-A: clear the ambient env so the (snapshot-neutralized) env-default
	// tier stays inert unless a test opts in via `vi.stubEnv`. `envStr` treats
	// "" as unset and returns the (now undefined) snapshot fallback.
	vi.stubEnv("GITHUB_REPOSITORY", "");
	vi.stubEnv("LOCAL_MEMORY_DEFAULT_OWNER", "");
	vi.stubEnv("LOCAL_MEMORY_DEFAULT_REPO", "");
	resetOwnerWarnDedup();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe("normalizeToolArguments", () => {
	it("returns non-object args as-is", () => {
		expect(normalizeToolArguments(null)).toBeNull();
		expect(normalizeToolArguments(undefined)).toBeUndefined();
		expect(normalizeToolArguments("raw")).toBe("raw");
		expect(normalizeToolArguments(42)).toBe(42);
	});

	it("parses a plain string scope as a repo name", () => {
		const result = normalizeToolArguments({ scope: "my-repo" });
		expect(result.scope).toEqual({ repo: "my-repo" });
	});

	it("parses a JSON-string scope object", () => {
		const result = normalizeToolArguments({ scope: '{"owner":"vheins","repo":"my-repo"}' });
		expect(result.scope).toEqual({ owner: "vheins", repo: "my-repo" });
	});

	it("treats a non-JSON string scope as a plain repo name", () => {
		const result = normalizeToolArguments({ scope: "{not-json}" });
		expect(result.scope).toEqual({ repo: "{not-json}" });
	});

	it("copies an object scope without mutating the caller's object", () => {
		const scope = { repo: "my-repo" };
		const result = normalizeToolArguments({ scope });
		expect(result.scope).toEqual({ repo: "my-repo" });
		expect(scope).toEqual({ repo: "my-repo" });
	});

	it("fills repo from session.repo and mirrors it into scope", () => {
		const result = normalizeToolArguments({ query: "q", scope: {} }, makeSession({ repo: "session-repo" }));
		expect(result.repo).toBe("session-repo");
		expect((result.scope as Record<string, unknown>).repo).toBe("session-repo");
	});

	it("treats an empty repo as not provided and fills it from session.repo (unchanged)", () => {
		const result = normalizeToolArguments({ repo: "", scope: {} }, makeSession({ repo: "session-repo" }));
		expect(result.repo).toBe("session-repo");
		expect((result.scope as Record<string, unknown>).repo).toBe("session-repo");
	});

	it("falls back to inferRepoFromSession when no repo is provided", () => {
		vi.mocked(inferRepoFromSession).mockReturnValue("inferred-repo");
		const result = normalizeToolArguments({ query: "q" }, makeSession());
		expect(result.repo).toBe("inferred-repo");
		expect(inferRepoFromSession).toHaveBeenCalled();
	});

	it("fills owner from session.owner", () => {
		const result = normalizeToolArguments({ query: "q" }, makeSession({ owner: "acme" }));
		expect(result.owner).toBe("acme");
	});

	it("derives owner from an owner/repo argument without warning", () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		const result = normalizeToolArguments({ repo: "vheins/my-repo" });
		expect(result.owner).toBe("vheins");
		expect(result.repo).toBe("vheins/my-repo");
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("infers owner from the session and warns for slash-less repos", () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		vi.mocked(inferOwnerFromSession).mockReturnValue("vheins");
		const result = normalizeToolArguments({ repo: "my-repo" });
		expect(result.owner).toBe("vheins");
		// FIX-029: exactly one advisory on the first inference for a scope.
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});

	it("treats an empty owner as not provided and fills it from session.owner", () => {
		const result = normalizeToolArguments({ owner: "", repo: "my-repo" }, makeSession({ owner: "acme" }));
		expect(result.owner).toBe("acme");
		expect(result.repo).toBe("my-repo");
		// TASK-420 priority inversion: the roots-derived owner is consulted
		// FIRST (inferOwnerFromSession), so it is always called even when a
		// CWD-derived session.owner exists. Here the mocked infer returns
		// undefined, so the session.owner fallback still fills the owner.
		expect(inferOwnerFromSession).toHaveBeenCalled();
	});

	it("treats a whitespace-only owner as not provided and fills it from session.owner", () => {
		const result = normalizeToolArguments({ owner: "   ", repo: "my-repo" }, makeSession({ owner: "acme" }));
		expect(result.owner).toBe("acme");
		expect(result.repo).toBe("my-repo");
		// See the empty-owner case above: roots-derived owner is tried first.
		expect(inferOwnerFromSession).toHaveBeenCalled();
	});

	it("infers an empty owner from the session when no session.owner is set", () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		vi.mocked(inferOwnerFromSession).mockReturnValue("vheins");
		const result = normalizeToolArguments({ owner: "", repo: "my-repo" });
		expect(result.owner).toBe("vheins");
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});

	it("never re-infers an explicit non-empty owner (FIX-OWNER-INFER regression guard)", () => {
		vi.mocked(inferOwnerFromSession).mockReturnValue("vheins");
		const result = normalizeToolArguments({ owner: "explicit", repo: "my-repo" }, makeSession({ owner: "acme" }));
		expect(result.owner).toBe("explicit");
		expect(inferOwnerFromSession).not.toHaveBeenCalled();
	});

	it("fills a memory scope's inferred owner when the top-level owner is empty", () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		vi.mocked(inferOwnerFromSession).mockReturnValue("vheins");
		const result = normalizeToolArguments({
			owner: "",
			repo: "my-repo",
			memories: [{ scope: { repo: "my-repo" } }]
		});
		const memories = result.memories as Array<{ scope: Record<string, unknown> }>;
		expect(result.owner).toBe("vheins");
		expect(memories[0].scope.repo).toBe("my-repo");
		expect(memories[0].scope.owner).toBe("vheins");
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});

	it("fills scope.owner from an owner/repo scoped repo when the top-level owner is empty", () => {
		const result = normalizeToolArguments({ owner: "", repo: "my-repo", scope: { repo: "vheins/scoped-repo" } });
		expect(result.owner).toBeUndefined();
		expect((result.scope as { owner?: string }).owner).toBe("vheins");
	});

	it("treats an empty scope.owner as not provided and fills it from the resolved owner", () => {
		vi.mocked(inferOwnerFromSession).mockReturnValue("vheins");
		const result = normalizeToolArguments({ scope: { repo: "my-repo", owner: "" } }, makeSession({ owner: "acme" }));
		// TASK-420 priority inversion: the roots-derived owner (vheins) now wins
		// over the CWD-derived session.owner (acme), so the resolved owner is
		// the roots value — see the dedicated precedence tests below.
		expect((result.scope as { owner?: string }).owner).toBe("vheins");
		expect(inferOwnerFromSession).toHaveBeenCalled();
	});

	it("treats a whitespace-only scope.owner as not provided and fills it from the resolved owner", () => {
		const result = normalizeToolArguments({ scope: { repo: "my-repo", owner: "   " } }, makeSession({ owner: "acme" }));
		expect((result.scope as { owner?: string }).owner).toBe("acme");
	});

	it("fills scope.owner from the scoped repo", () => {
		const result = normalizeToolArguments({ scope: { repo: "vheins/my-repo" } });
		expect((result.scope as { owner?: string }).owner).toBe("vheins");
	});

	it("fills owner/repo into memory scope objects", () => {
		const result = normalizeToolArguments({
			memories: [{ scope: { repo: "vheins/my-repo" } }, { scope: {} }]
		});
		const memories = result.memories as Array<{ scope: Record<string, unknown> }>;
		expect(memories[0].scope.owner).toBe("vheins");
		expect(memories[0].scope.repo).toBe("vheins/my-repo");
		// No repo context available for the second memory — scope stays untouched.
		expect(memories[1].scope).toEqual({});
	});

	it("derives scope.folder from an absolute current_file_path inside a root", () => {
		const filePath = path.join(ROOT, "src/mcp/utils/normalize-args.ts");
		const result = normalizeToolArguments({ scope: {}, current_file_path: filePath }, makeSession());
		expect((result.scope as { folder?: string }).folder).toBe("src/mcp/utils");
	});

	it("does not derive scope.folder from a relative current_file_path", () => {
		const result = normalizeToolArguments(
			{ scope: {}, current_file_path: "src/mcp/utils/normalize-args.ts" },
			makeSession()
		);
		expect((result.scope as { folder?: string }).folder).toBeUndefined();
	});

	it("throws when a path argument escapes the active roots", () => {
		expect(() => normalizeToolArguments({ scope: {}, current_file_path: "/tmp/outside.ts" }, makeSession())).toThrow(
			"current_file_path must stay within the active MCP roots"
		);
	});

	it("keeps explicit agent/model args", () => {
		const result = normalizeToolArguments({ agent: "custom", model: "m1" });
		expect(result.agent).toBe("custom");
		expect(result.model).toBe("m1");
	});

	it("falls back to session lastSeenAgent/lastSeenModel", () => {
		const result = normalizeToolArguments(
			{ query: "q" },
			makeSession({ lastSeenAgent: "sess-agent", lastSeenModel: "sess-model" })
		);
		expect(result.agent).toBe("sess-agent");
		expect(result.model).toBe("sess-model");
	});

	it("falls back to clientName and env vars for agent/model", () => {
		vi.stubEnv("MCP_CLIENT_NAME", "env-client");
		vi.stubEnv("MCP_MODEL", "env-model");
		const result = normalizeToolArguments({ query: "q" }, makeSession({ clientName: "client-x" }));
		expect(result.agent).toBe("client-x");
		expect(result.model).toBe("env-model");
	});

	// FIX-CLAIM-AGENT-INJECT: `agent` is a filter/discriminator for these tools,
	// not attribution metadata. Auto-filling it from the session silently
	// narrowed claim-manage RELEASE to the caller's own claims and flipped
	// handoff-read into LIST-CLAIMS.
	describe("agent-semantic tools skip the session agent fallback", () => {
		const session = makeSession({ lastSeenAgent: "opencode", clientName: "opencode" });

		it("claim-manage RELEASE without agent stays agent-free", () => {
			const result = normalizeToolArguments({ task_code: "X", release: true }, session, {
				toolName: "claim-manage"
			});
			expect(result.agent).toBeUndefined();
			expect(result.release).toBe(true);
		});

		it("handoff-read list without agent stays agent-free (no LIST-CLAIMS hijack)", () => {
			const result = normalizeToolArguments({ repo: "r", owner: "o" }, session, { toolName: "handoff-read" });
			expect(result.agent).toBeUndefined();
		});

		it("still keeps an EXPLICIT agent on an agent-semantic tool", () => {
			const result = normalizeToolArguments({ task_code: "X", release: true, agent: "backend" }, session, {
				toolName: "claim-manage"
			});
			expect(result.agent).toBe("backend");
		});

		it("attribution tools (memory-write) still receive the session agent", () => {
			const result = normalizeToolArguments({ repo: "r", owner: "o", content: "x" }, session, {
				toolName: "memory-write"
			});
			expect(result.agent).toBe("opencode");
		});

		it("a call with no toolName keeps the historical fallback", () => {
			const result = normalizeToolArguments({ query: "q" }, session);
			expect(result.agent).toBe("opencode");
		});
	});

	// ── TASK-420: roots-first scope priority + write fail-loud ─────────────
	describe("scope priority and write fail-loud (TASK-420)", () => {
		it("WRITE with no explicit scope and a rootless HTTP session THROWS", () => {
			// A rootless HTTP session whose repo/owner are CWD-derived only: a
			// write must refuse rather than silently target the daemon working
			// dir. The guard is HTTP-only — under stdio the CWD IS the client's
			// project (see the regression test below).
			const session = makeSession({ roots: [], repo: "cwd-repo", owner: "cwd-owner", transport: "http" });
			expect(() => normalizeToolArguments({ content: "x" }, session, { toolName: "memory-write" })).toThrow(
				/owner\/repo could not be determined for a write operation/
			);
		});

		it("WRITE with an explicit repo does NOT throw", () => {
			const session = makeSession({ roots: [], transport: "http" });
			const result = normalizeToolArguments({ content: "x", repo: "my-repo" }, session, {
				toolName: "memory-write"
			});
			expect(result.repo).toBe("my-repo");
		});

		it("WRITE with roots-derived owner/repo uses the roots values and does NOT throw", () => {
			// `inferRepoFromSession`/`inferOwnerFromSession` are the roots readers
			// (mocked here); a populated root set means the write has a real
			// project scope and must not fail loud.
			vi.mocked(inferRepoFromSession).mockReturnValue("rootrepo");
			vi.mocked(inferOwnerFromSession).mockReturnValue("alice");
			const root = path.resolve("/Users", "alice", "rootrepo");
			const session = makeSession({ roots: [{ uri: pathToFileURL(root).href }], transport: "http" });
			const result = normalizeToolArguments({ content: "x" }, session, { toolName: "memory-write" });
			expect(result.repo).toBe("rootrepo");
			expect(result.owner).toBe("alice");
		});

		it("WRITE addressed by UUID does NOT throw (scope inherited from the entity)", () => {
			const session = makeSession({ roots: [], transport: "http" });
			const result = normalizeToolArguments(
				{ id: "123e4567-e89b-12d3-a456-426614174000", status: "expired" },
				session,
				{ toolName: "handoff-write" }
			);
			expect(result.id).toBe("123e4567-e89b-12d3-a456-426614174000");
		});

		it("interactive WRITE does NOT throw (scope elicited before the write)", () => {
			const session = makeSession({ roots: [], transport: "http" });
			expect(() => normalizeToolArguments({ interactive: true }, session, { toolName: "task-write" })).not.toThrow();
		});

		it("READ with no scope does NOT throw and is tagged __scopeInferred", () => {
			const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
			const session = makeSession({ roots: [], repo: "cwd-repo", owner: "cwd-owner", transport: "http" });
			const result = normalizeToolArguments({ query: "q" }, session, { toolName: "memory-read" });
			expect(result.repo).toBe("cwd-repo");
			expect(result.owner).toBe("cwd-owner");
			expect(result.__scopeInferred).toBe(true);
			expect(warnSpy).toHaveBeenCalled();
		});

		it("does not tag __scopeInferred when an explicit scope is provided", () => {
			const session = makeSession({ roots: [] });
			const result = normalizeToolArguments({ query: "q", repo: "my-repo" }, session, { toolName: "memory-read" });
			expect(result.__scopeInferred).toBeUndefined();
		});

		it("roots-derived repo wins over session.repo (priority inversion)", () => {
			vi.mocked(inferRepoFromSession).mockReturnValue("rootrepo");
			const root = path.resolve("/Users", "alice", "rootrepo");
			const session = makeSession({ roots: [{ uri: pathToFileURL(root).href }], repo: "cwd-repo" });
			const result = normalizeToolArguments({ query: "q" }, session);
			expect(result.repo).toBe("rootrepo");
		});

		it("roots-derived owner wins over session.owner (priority inversion)", () => {
			vi.mocked(inferOwnerFromSession).mockReturnValue("alice");
			const root = path.resolve("/Users", "alice", "rootrepo");
			const session = makeSession({ roots: [{ uri: pathToFileURL(root).href }], owner: "cwd-owner" });
			const result = normalizeToolArguments({ query: "q" }, session);
			expect(result.owner).toBe("alice");
		});

		it("isWrite override (without a toolName) also fails loud for an HTTP session", () => {
			const session = makeSession({ roots: [], transport: "http" });
			expect(() => normalizeToolArguments({ content: "x" }, session, { isWrite: true })).toThrow(
				/owner\/repo could not be determined/
			);
		});

		// ── Regression: stdio CWD fallback MUST stay permissive ─────────────
		// A stdio client that does not advertise MCP roots always has
		// `roots === []`, and its CWD IS its project, so the historical
		// CWD-derived scope is correct. Failing loud here was a backward-compat
		// regression (the pre-TASK-420 behavior silently filled session.repo/
		// session.owner). The guard is therefore HTTP-only.
		it("WRITE with no explicit scope and a rootless stdio session does NOT throw (CWD fallback preserved)", () => {
			const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
			const session = makeSession({ roots: [], repo: "cwd-repo", owner: "cwd-owner", transport: "stdio" });
			const result = normalizeToolArguments({ content: "x" }, session, { toolName: "memory-write" });
			expect(result.repo).toBe("cwd-repo");
			expect(result.owner).toBe("cwd-owner");
			expect(warnSpy).toHaveBeenCalled();
		});

		it("WRITE with no explicit scope and an undefined transport does NOT throw (historical default)", () => {
			const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
			const session = makeSession({ roots: [], repo: "cwd-repo", owner: "cwd-owner" });
			// `transport` is intentionally left undefined to prove the guard
			// requires an EXPLICIT "http" (default/historical = permissive).
			expect(session.transport).toBeUndefined();
			const result = normalizeToolArguments({ content: "x" }, session, { toolName: "memory-write" });
			expect(result.repo).toBe("cwd-repo");
			expect(result.owner).toBe("cwd-owner");
			expect(warnSpy).toHaveBeenCalled();
		});
	});

	// ── FIX-110-A: env-default scope resolution tier ───────────────────────
	// A rootless HTTP client (no MCP roots) + a daemon whose CWD is `/` used to
	// fail with "configure MCP workspace roots". The env tier now sits AFTER
	// roots/session inference and BEFORE the CWD fallback:
	//   explicit args > roots/session inference > LOCAL_MEMORY_DEFAULT_* >
	//   GITHUB_REPOSITORY > daemon cwd.
	describe("env-default scope tier (FIX-110-A)", () => {
		it("resolves repo/owner from LOCAL_MEMORY_DEFAULT_* when roots are empty", () => {
			vi.stubEnv("LOCAL_MEMORY_DEFAULT_OWNER", "env-owner");
			vi.stubEnv("LOCAL_MEMORY_DEFAULT_REPO", "env-repo");
			const session = makeSession({ roots: [], transport: "http" });
			const result = normalizeToolArguments({ query: "q" }, session);
			expect(result.owner).toBe("env-owner");
			expect(result.repo).toBe("env-repo");
		});

		it("resolves from GITHUB_REPOSITORY (owner/repo) when LOCAL_MEMORY_DEFAULT_* are unset", () => {
			vi.stubEnv("GITHUB_REPOSITORY", "octo/widget");
			const session = makeSession({ roots: [], transport: "http" });
			const result = normalizeToolArguments({ query: "q" }, session);
			expect(result.owner).toBe("octo");
			expect(result.repo).toBe("widget");
		});

		it("LOCAL_MEMORY_DEFAULT_* wins over GITHUB_REPOSITORY", () => {
			vi.stubEnv("LOCAL_MEMORY_DEFAULT_OWNER", "local-owner");
			vi.stubEnv("LOCAL_MEMORY_DEFAULT_REPO", "local-repo");
			vi.stubEnv("GITHUB_REPOSITORY", "octo/widget");
			const session = makeSession({ roots: [], transport: "http" });
			const result = normalizeToolArguments({ query: "q" }, session);
			expect(result.owner).toBe("local-owner");
			expect(result.repo).toBe("local-repo");
		});

		it("explicit args win over the env tier", () => {
			vi.stubEnv("LOCAL_MEMORY_DEFAULT_OWNER", "env-owner");
			vi.stubEnv("LOCAL_MEMORY_DEFAULT_REPO", "env-repo");
			const session = makeSession({ roots: [], transport: "http" });
			const result = normalizeToolArguments({ repo: "explicit-repo", owner: "explicit-owner" }, session);
			expect(result.owner).toBe("explicit-owner");
			expect(result.repo).toBe("explicit-repo");
		});

		it("roots/session inference wins over the env tier", () => {
			vi.stubEnv("LOCAL_MEMORY_DEFAULT_OWNER", "env-owner");
			vi.stubEnv("LOCAL_MEMORY_DEFAULT_REPO", "env-repo");
			vi.mocked(inferRepoFromSession).mockReturnValue("rootrepo");
			vi.mocked(inferOwnerFromSession).mockReturnValue("root-owner");
			const root = path.resolve("/Users", "alice", "rootrepo");
			const session = makeSession({ roots: [{ uri: pathToFileURL(root).href }], transport: "http" });
			const result = normalizeToolArguments({ query: "q" }, session);
			expect(result.owner).toBe("root-owner");
			expect(result.repo).toBe("rootrepo");
		});

		it("env tier wins over the CWD-derived session defaults", () => {
			vi.stubEnv("LOCAL_MEMORY_DEFAULT_REPO", "env-repo");
			vi.stubEnv("LOCAL_MEMORY_DEFAULT_OWNER", "env-owner");
			const session = makeSession({ roots: [], repo: "cwd-repo", owner: "cwd-owner", transport: "http" });
			const result = normalizeToolArguments({ query: "q" }, session);
			expect(result.repo).toBe("env-repo");
			expect(result.owner).toBe("env-owner");
		});

		it("env-resolved repo suppresses the write fail-loud guard (rootless HTTP WRITE)", () => {
			vi.stubEnv("LOCAL_MEMORY_DEFAULT_OWNER", "env-owner");
			vi.stubEnv("LOCAL_MEMORY_DEFAULT_REPO", "env-repo");
			const session = makeSession({ roots: [], repo: "cwd-repo", owner: "cwd-owner", transport: "http" });
			const result = normalizeToolArguments({ content: "x" }, session, { toolName: "memory-write" });
			expect(result.repo).toBe("env-repo");
			expect(result.owner).toBe("env-owner");
		});

		it("WRITE with no env and no roots still fails loud (guard preserved)", () => {
			// No env tier resolves → the CWD fallback guard MUST still fire.
			const session = makeSession({ roots: [], repo: "cwd-repo", owner: "cwd-owner", transport: "http" });
			expect(() => normalizeToolArguments({ content: "x" }, session, { toolName: "memory-write" })).toThrow(
				/owner\/repo could not be determined for a write operation/
			);
		});

		it("logs the resolving env source at debug level, rate-limited", () => {
			const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
			vi.stubEnv("LOCAL_MEMORY_DEFAULT_OWNER", "env-owner");
			vi.stubEnv("LOCAL_MEMORY_DEFAULT_REPO", "env-repo");
			const session = makeSession({ roots: [], transport: "http", sessionId: "sess-env" });
			normalizeToolArguments({ query: "q" }, session);
			normalizeToolArguments({ query: "q" }, session);
			// Rate-limited: the same (source, scope, session) logs once.
			const envCalls = debugSpy.mock.calls.filter((c) => String(c[0]).includes("local-memory-default"));
			expect(envCalls).toHaveLength(1);
		});

		it("ignores an empty LOCAL_MEMORY_DEFAULT_REPO and falls through to GITHUB_REPOSITORY", () => {
			vi.stubEnv("LOCAL_MEMORY_DEFAULT_OWNER", "");
			vi.stubEnv("LOCAL_MEMORY_DEFAULT_REPO", "");
			vi.stubEnv("GITHUB_REPOSITORY", "octo/widget");
			const session = makeSession({ roots: [], transport: "http" });
			const result = normalizeToolArguments({ query: "q" }, session);
			expect(result.owner).toBe("octo");
			expect(result.repo).toBe("widget");
		});
	});
});

describe("owner-inference warning is rate-limited per (owner, repo, session) (FIX-029)", () => {
	it("emits the advisory once, then suppresses repeats for the same scope", () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		vi.mocked(inferOwnerFromSession).mockReturnValue("vheins");
		const session = makeSession({ sessionId: "sess-1" });

		// 52-in-a-minute burst scenario from the incident: 50 identical calls.
		for (let i = 0; i < 50; i++) {
			const result = normalizeToolArguments({ repo: "my-repo" }, session);
			expect(result.owner).toBe("vheins");
		}

		expect(warnSpy).toHaveBeenCalledTimes(1);
	});

	it("warns again for a different repo scope", () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		vi.mocked(inferOwnerFromSession).mockReturnValue("vheins");
		const session = makeSession({ sessionId: "sess-1" });

		normalizeToolArguments({ repo: "repo-a" }, session);
		normalizeToolArguments({ repo: "repo-b" }, session);

		expect(warnSpy).toHaveBeenCalledTimes(2);
	});

	it("warns again for a different session on the same scope", () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		vi.mocked(inferOwnerFromSession).mockReturnValue("vheins");

		normalizeToolArguments({ repo: "my-repo" }, makeSession({ sessionId: "sess-1" }));
		normalizeToolArguments({ repo: "my-repo" }, makeSession({ sessionId: "sess-2" }));

		expect(warnSpy).toHaveBeenCalledTimes(2);
	});

	it("emits again after the dedup state is reset", () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		vi.mocked(inferOwnerFromSession).mockReturnValue("vheins");
		const session = makeSession({ sessionId: "sess-1" });

		normalizeToolArguments({ repo: "my-repo" }, session);
		expect(warnSpy).toHaveBeenCalledTimes(1);

		resetOwnerWarnDedup();
		normalizeToolArguments({ repo: "my-repo" }, session);
		expect(warnSpy).toHaveBeenCalledTimes(2);
	});

	it("never warns when the owner is explicit", () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		normalizeToolArguments({ owner: "explicit", repo: "my-repo" }, makeSession({ sessionId: "sess-1" }));
		expect(warnSpy).not.toHaveBeenCalled();
	});
});

describe("empty-string parameters are treated as not provided (FIX-EMPTY-PARAMS)", () => {
	it("removes top-level empty-string keys", () => {
		const result = normalizeToolArguments({ query: "", status: "" });
		expect("query" in result).toBe(false);
		expect("status" in result).toBe(false);
	});

	it("removes nested empty-string keys inside plain objects", () => {
		const result = normalizeToolArguments({ scope: { branch: "" } });
		expect("branch" in (result.scope as Record<string, unknown>)).toBe(false);
	});

	it("removes empty-string keys inside array-of-object items", () => {
		const result = normalizeToolArguments({ memories: [{ content: "", title: "keep" }] });
		const memories = result.memories as Array<Record<string, unknown>>;
		expect("content" in memories[0]).toBe(false);
		expect(memories[0].title).toBe("keep");
	});

	it("preserves empty-string values inside record-valued fields", () => {
		const result = normalizeToolArguments({
			metadata: { k: "" },
			context: { note: "" },
			args: { variable: "" }
		});
		expect((result.metadata as Record<string, unknown>).k).toBe("");
		expect((result.context as Record<string, unknown>).note).toBe("");
		expect((result.args as Record<string, unknown>).variable).toBe("");
	});

	it("strips a string-valued context (not a record)", () => {
		const result = normalizeToolArguments({ context: "" });
		expect("context" in result).toBe(false);
	});

	it("preserves array elements even when they are empty strings", () => {
		const result = normalizeToolArguments({ tags: [""], signals: ["", "x"] });
		expect(result.tags).toEqual([""]);
		expect(result.signals).toEqual(["", "x"]);
	});

	it("does not mutate the caller's object", () => {
		const args = { query: "", scope: { branch: "" }, metadata: { k: "" }, tags: [""] };
		const snapshot = structuredClone(args);
		normalizeToolArguments(args);
		expect(args).toEqual(snapshot);
	});

	it("passes non-empty values through unchanged", () => {
		const result = normalizeToolArguments({ query: "q", status: "pending" });
		expect(result.query).toBe("q");
		expect(result.status).toBe("pending");
	});
});

describe("validateRootBoundPath", () => {
	it("accepts relative and in-root absolute paths", () => {
		const session = makeSession();
		expect(() => validateRootBoundPath("src/foo.ts", "current_file_path", session)).not.toThrow();
		expect(() => validateRootBoundPath(path.join(ROOT, "src/foo.ts"), "current_file_path", session)).not.toThrow();
	});

	it("ignores non-string values", () => {
		expect(() => validateRootBoundPath(undefined, "doc_path")).not.toThrow();
		expect(() => validateRootBoundPath(42, "doc_path")).not.toThrow();
	});

	it("throws for absolute paths outside the roots", () => {
		expect(() => validateRootBoundPath("/tmp/outside", "doc_path", makeSession())).toThrow(
			"doc_path must stay within the active MCP roots"
		);
	});

	it("allows any absolute path when no roots are registered", () => {
		const session = makeSession({ roots: [] });
		expect(() => validateRootBoundPath("/tmp/anything", "current_file_path", session)).not.toThrow();
	});
});
