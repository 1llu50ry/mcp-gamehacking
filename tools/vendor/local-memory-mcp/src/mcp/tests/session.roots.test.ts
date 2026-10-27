// Feature: mcp-session-roots
// Unit tests for applySessionRoots() and the advertised roots capability
// (TASK-418 — wire MCP roots for per-session repo/owner scoping).

import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { applySessionRoots, createSessionContext } from "../session";
import { CAPABILITIES } from "../capabilities";

beforeEach(() => {
	vi.spyOn(process, "cwd").mockReturnValue("/test/path/mockrepo");
});

/** Build a file:// URI from an absolute path — ensures proper triple-slash format. */
function fileUri(absPath: string): string {
	return `file://${absPath.startsWith("/") ? "" : "/"}${absPath}`;
}

// ─── applySessionRoots ────────────────────────────────────────────────────────

describe("applySessionRoots()", () => {
	it("recomputes repo/owner/projectPath from a single root", () => {
		const session = createSessionContext();
		const root = path.resolve("/Users", "alice", "myrepo");

		const changed = applySessionRoots(session, [{ uri: fileUri(root) }]);

		expect(changed).toBe(true);
		expect(session.repo).toBe("myrepo");
		expect(session.owner).toBe("alice");
		expect(session.projectPath).toBe(root);
	});

	it("derives distinct (owner, repo) for two different roots", () => {
		const first = createSessionContext();
		applySessionRoots(first, [{ uri: fileUri(path.resolve("/Users", "alice", "repo1")) }]);

		const second = createSessionContext();
		applySessionRoots(second, [{ uri: fileUri(path.resolve("/Users", "bob", "repo2")) }]);

		expect([first.owner, first.repo]).toEqual(["alice", "repo1"]);
		expect([second.owner, second.repo]).toEqual(["bob", "repo2"]);
		expect([first.owner, first.repo]).not.toEqual([second.owner, second.repo]);
	});

	it("keeps CWD-derived values when the session is rootless", () => {
		const session = createSessionContext();
		const prior = { repo: session.repo, owner: session.owner, projectPath: session.projectPath };

		const changed = applySessionRoots(session, []);

		expect(changed).toBe(false);
		// Rootless sessions retain the CWD-derived defaults — never blanked.
		expect(session.repo).toBe(prior.repo);
		expect(session.repo).toBe("mockrepo");
		expect(session.owner).toBe(prior.owner);
		expect(session.projectPath).toBe(prior.projectPath);
		expect(session.projectPath).toBe("/test/path/mockrepo");
	});

	it("does not blank an inferred owner/projectPath when roots disappear", () => {
		const session = createSessionContext();
		applySessionRoots(session, [{ uri: fileUri(path.resolve("/Users", "alice", "myrepo")) }]);
		expect(session.owner).toBe("alice");
		expect(session.projectPath).toBe(path.resolve("/Users", "alice", "myrepo"));

		applySessionRoots(session, []);

		// owner/projectPath are only assigned when a value is produced, so the
		// previously inferred values are retained rather than overwritten.
		expect(session.owner).toBe("alice");
		expect(session.projectPath).toBe(path.resolve("/Users", "alice", "myrepo"));
		// repo falls back to the CWD basename on the rootless path.
		expect(session.repo).toBe("mockrepo");
	});

	it("returns false when the root set is unchanged", () => {
		const session = createSessionContext();
		const root = fileUri(path.resolve("/Users", "alice", "myrepo"));

		expect(applySessionRoots(session, [{ uri: root }])).toBe(true);
		expect(applySessionRoots(session, [{ uri: root }])).toBe(false);
	});

	it("ignores malformed root entries and empty input safely", () => {
		const session = createSessionContext();
		expect(applySessionRoots(session, undefined)).toBe(false);
		expect(applySessionRoots(session, [null, 42, { notUri: true }])).toBe(false);
	});
});

// ─── CAPABILITIES.roots ───────────────────────────────────────────────────────

describe("CAPABILITIES.capabilities.roots", () => {
	it("is advertised by the server", () => {
		expect(CAPABILITIES.capabilities.roots).toBeDefined();
	});
});
