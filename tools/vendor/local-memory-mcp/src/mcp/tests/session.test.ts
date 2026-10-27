// Feature: mcp-session
// Unit tests for session context functions
// Covers: inferOwnerFromSession, inferRepoFromSession

import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { createSessionContext, inferOwnerFromSession, inferRepoFromSession } from "../session";

beforeEach(() => {
	vi.spyOn(process, "cwd").mockReturnValue("/test/path/mockrepo");
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sessionWithRoots(uris: string[]) {
	const session = createSessionContext();
	session.roots = uris.map((uri) => ({ uri }));
	return session;
}

/** Build a file:// URI from an absolute path — ensures proper triple-slash format. */
function fileUri(absPath: string): string {
	return `file://${absPath.startsWith("/") ? "" : "/"}${absPath}`;
}

// ─── inferOwnerFromSession ────────────────────────────────────────────────────

describe("inferOwnerFromSession()", () => {
	it("returns the parent directory name when a single root exists with >= 2 path components", () => {
		const root = path.resolve("/Users", "alice", "myrepo");
		const session = sessionWithRoots([fileUri(root)]);
		expect(inferOwnerFromSession(session)).toBe("alice");
	});

	it("returns undefined when session has no roots (no owner fabricated from cwd)", () => {
		const session = createSessionContext();
		expect(inferOwnerFromSession(session)).toBeUndefined();
	});

	it("returns undefined when session has a root with fewer than 2 path components", () => {
		const root = path.resolve("/myrepo");
		const session = sessionWithRoots([fileUri(root)]);
		expect(inferOwnerFromSession(session)).toBeUndefined();
	});

	it("returns undefined when session is undefined", () => {
		expect(inferOwnerFromSession()).toBeUndefined();
	});

	it("returns undefined when roots exist but none are file:// URIs (no cwd fallback)", () => {
		const session = sessionWithRoots(["not-a-file-uri://some/path"]);
		expect(inferOwnerFromSession(session)).toBeUndefined();
	});

	it("returns undefined with clientInfo.name set and no roots (regression guard)", () => {
		const session = createSessionContext();
		session.clientInfo = { name: "claude-desktop", version: "1.0.0" };
		expect(inferOwnerFromSession(session)).toBeUndefined();
	});

	it("returns undefined when multiple roots exist", () => {
		const root1 = fileUri(path.resolve("/Users", "alice", "repo1"));
		const root2 = fileUri(path.resolve("/Users", "bob", "repo2"));
		const session = sessionWithRoots([root1, root2]);
		expect(inferOwnerFromSession(session)).toBeUndefined();
	});

	// ── FIX-029: reject path-basename owners ────────────────────────────────
	it("rejects a parent segment that is the OS 'home' directory (spurious owner)", () => {
		const root = path.resolve("/home", "vheins", "myrepo");
		const session = sessionWithRoots([fileUri(root)]);
		// parent = "vheins" is plausible → still inferred (positive guard).
		expect(inferOwnerFromSession(session)).toBe("vheins");
	});

	it("returns undefined when the parent segment is a reserved OS directory", () => {
		// /home/vheins → parent "home" is structural, not an owner.
		const root = path.resolve("/home", "myrepo");
		const session = sessionWithRoots([fileUri(root)]);
		expect(inferOwnerFromSession(session)).toBeUndefined();
	});

	it("returns undefined when the parent segment is a dotfile/.config", () => {
		const root = path.resolve("/Users", "alice", ".config", "myrepo");
		const session = sessionWithRoots([fileUri(root)]);
		expect(inferOwnerFromSession(session)).toBeUndefined();
	});

	it("returns undefined when the parent segment is a reserved dir like 'tmp'", () => {
		const root = path.resolve("/tmp", "myrepo");
		const session = sessionWithRoots([fileUri(root)]);
		expect(inferOwnerFromSession(session)).toBeUndefined();
	});
});

// ─── inferRepoFromSession ─────────────────────────────────────────────────────

describe("inferRepoFromSession()", () => {
	it("returns the basename of a single root", () => {
		const root = path.resolve("/Users", "alice", "myrepo");
		const session = sessionWithRoots([fileUri(root)]);
		expect(inferRepoFromSession(session)).toBe("myrepo");
	});

	it("returns cwd basename when session has no roots", () => {
		const session = createSessionContext();
		expect(inferRepoFromSession(session)).toBe("mockrepo");
	});

	it("returns undefined when session is undefined", () => {
		expect(inferRepoFromSession()).toBeUndefined();
	});

	it("returns undefined when multiple roots exist", () => {
		const root1 = fileUri(path.resolve("/Users", "alice", "repo1"));
		const root2 = fileUri(path.resolve("/Users", "bob", "repo2"));
		const session = sessionWithRoots([root1, root2]);
		expect(inferRepoFromSession(session)).toBeUndefined();
	});

	// ── FIX-029: reject path-artifact repo basenames ────────────────────────
	it("returns undefined for a single root whose basename is a reserved dir", () => {
		const session = sessionWithRoots([fileUri(path.resolve("/Users", "alice", "tmp"))]);
		expect(inferRepoFromSession(session)).toBeUndefined();
	});

	it("returns undefined for a single root whose basename is a dotfile", () => {
		const session = sessionWithRoots([fileUri(path.resolve("/Users", "alice", ".config"))]);
		expect(inferRepoFromSession(session)).toBeUndefined();
	});

	it("returns undefined for a rootless session whose cwd basename is reserved", () => {
		// /home → basename "home" is structural, not a repo name (FIX-029).
		const spy = vi.spyOn(process, "cwd").mockReturnValue("/home");
		const session = createSessionContext();
		expect(inferRepoFromSession(session)).toBeUndefined();
		spy.mockRestore();
	});
});

// ─── createSessionContext CWD-derived defaults (FIX-029) ──────────────────────

describe("createSessionContext() path-basename hardening (FIX-029)", () => {
	it("keeps a plausible parent-dir owner when there is no git remote", () => {
		const spy = vi.spyOn(process, "cwd").mockReturnValue(path.resolve("/Users", "alice", "myrepo"));
		const session = createSessionContext();
		expect(session.owner).toBe("alice");
		expect(session.repo).toBe("myrepo");
		spy.mockRestore();
	});

	it("does NOT fabricate a 'home' owner from /home/<user> (spurious-owner guard)", () => {
		const spy = vi.spyOn(process, "cwd").mockReturnValue(path.resolve("/home", "vheins"));
		const session = createSessionContext();
		// parent segment "home" is structural — never a real GitHub owner.
		expect(session.owner).toBeUndefined();
		spy.mockRestore();
	});
});
