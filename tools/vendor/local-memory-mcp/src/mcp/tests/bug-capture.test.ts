import { describe, it, expect, afterEach } from "vitest";
import os from "os";
import { bugCapture, computeFingerprint, redact } from "../utils/bug-capture";
import { createTestStore } from "../storage/sqlite";

afterEach(() => {
	bugCapture.reset();
});

describe("computeFingerprint", () => {
	it("is stable across differing line/column numbers in the stack", () => {
		const a = computeFingerprint("tool", "boom", "Error: boom\n    at foo (a.ts:1:1)\n    at bar (b.ts:2:2)");
		const b = computeFingerprint("tool", "boom", "Error: boom\n    at foo (a.ts:99:42)\n    at bar (b.ts:7:8)");
		expect(a).toBe(b);
	});

	it("differs across messages", () => {
		const a = computeFingerprint("tool", "boom", "at foo (a.ts:1:1)");
		const b = computeFingerprint("tool", "bang", "at foo (a.ts:1:1)");
		expect(a).not.toBe(b);
	});

	it("differs across sources", () => {
		const a = computeFingerprint("tool", "boom", "at foo (a.ts:1:1)");
		const b = computeFingerprint("dashboard", "boom", "at foo (a.ts:1:1)");
		expect(a).not.toBe(b);
	});
});

describe("redact", () => {
	it("replaces the home-dir prefix with ~", () => {
		const home = os.homedir();
		const out = redact(`${home}/projects/secret/file.ts`);
		expect(out).toBe("~/projects/secret/file.ts");
	});

	it("masks secret-named keys", () => {
		const out = redact({ token: "abc123", password: "hunter2", ok: "keep" }) as Record<string, unknown>;
		expect(out.token).toBe("***");
		expect(out.password).toBe("***");
		expect(out.ok).toBe("keep");
	});

	it("masks Bearer tokens", () => {
		const out = redact("Authorization: Bearer abc.def.ghi");
		expect(out).toBe("Authorization: Bearer ***");
	});
});

describe("bugCapture end-to-end", () => {
	it("dedupes repeated captures by fingerprint and bumps count", async () => {
		const store = await createTestStore();
		bugCapture.bind(store);

		bugCapture.capture({ source: "tool", message: "boom", stack: "at foo (a.ts:1:1)" });
		bugCapture.capture({ source: "tool", message: "boom", stack: "at foo (a.ts:1:1)" });

		const rows = store.bugReports.list();
		expect(rows).toHaveLength(1);
		expect(rows[0].count).toBe(2);
		expect(rows[0].source).toBe("tool");
	});

	it("reopens a resolved report on recurrence", async () => {
		const store = await createTestStore();
		bugCapture.bind(store);

		bugCapture.capture({ source: "tool", message: "boom", stack: "at foo (a.ts:1:1)" });
		const [row] = store.bugReports.list();
		expect(store.bugReports.resolve(row.id)).toBe(true);
		expect(store.bugReports.list()).toHaveLength(0);

		bugCapture.capture({ source: "tool", message: "boom", stack: "at foo (a.ts:1:1)" });

		const reopened = store.bugReports.list({ includeResolved: true });
		expect(reopened).toHaveLength(1);
		expect(reopened[0].resolved_at).toBeNull();
		expect(reopened[0].count).toBe(2);
	});
});

describe("bugCapture scope attribution (TASK-421)", () => {
	it("persists explicit owner/repo/sessionId from context", async () => {
		const store = await createTestStore();
		bugCapture.bind(store);

		bugCapture.capture({
			source: "tool",
			message: "boom",
			context: { owner: "vheins", repo: "local-memory-mcp", sessionId: "sess-1" }
		});

		const [row] = store.bugReports.list();
		expect(row.context.owner).toBe("vheins");
		expect(row.context.repo).toBe("local-memory-mcp");
		expect(row.context.sessionId).toBe("sess-1");
	});

	it("still redacts secret-named context keys alongside scope", async () => {
		const store = await createTestStore();
		bugCapture.bind(store);

		bugCapture.capture({
			source: "tool",
			message: "boom",
			context: { owner: "vheins", repo: "local-memory-mcp", sessionId: "sess-1", token: "example-token" }
		});

		const [row] = store.bugReports.list();
		expect(row.context.token).toBe("***");
		expect(row.context.owner).toBe("vheins");
		expect(row.context.repo).toBe("local-memory-mcp");
		expect(row.context.sessionId).toBe("sess-1");
	});

	it("fills owner/repo/sessionId from the scope provider when absent", async () => {
		const store = await createTestStore();
		bugCapture.bind(store);
		bugCapture.setScopeProvider(() => ({ owner: "prov-owner", repo: "prov-repo", sessionId: "prov-session" }));

		bugCapture.capture({ source: "uncaught", message: "boom" });

		const [row] = store.bugReports.list();
		expect(row.context.owner).toBe("prov-owner");
		expect(row.context.repo).toBe("prov-repo");
		expect(row.context.sessionId).toBe("prov-session");
	});

	it("prefers explicit context over the scope provider and only fills non-empty keys", async () => {
		const store = await createTestStore();
		bugCapture.bind(store);
		bugCapture.setScopeProvider(() => ({ owner: "prov-owner", repo: "prov-repo", sessionId: "prov-session" }));

		bugCapture.capture({
			source: "tool",
			message: "boom",
			context: { owner: "explicit-owner", sessionId: "" }
		});

		const [row] = store.bugReports.list();
		// Explicit non-empty owner wins; empty sessionId is treated as absent and filled.
		expect(row.context.owner).toBe("explicit-owner");
		expect(row.context.repo).toBe("prov-repo");
		expect(row.context.sessionId).toBe("prov-session");
	});
});

describe("bugCapture.logSink", () => {
	it("persists error-level entries", async () => {
		const store = await createTestStore();
		bugCapture.bind(store);

		bugCapture.logSink({ level: "error", logger: "tool", data: { message: "x" } });

		const rows = store.bugReports.list();
		expect(rows).toHaveLength(1);
		expect(rows[0].source).toBe("tool");
	});

	it("ignores below-error entries", async () => {
		const store = await createTestStore();
		bugCapture.bind(store);

		bugCapture.logSink({ level: "info", logger: "tool", data: { message: "x" } });

		expect(store.bugReports.list()).toHaveLength(0);
	});

	it("persists owner/repo/sessionId carried in the log data", async () => {
		const store = await createTestStore();
		bugCapture.bind(store);

		bugCapture.logSink({
			level: "error",
			logger: "tool",
			data: { message: "x", owner: "vheins", repo: "local-memory-mcp", sessionId: "sess-1" }
		});

		const [row] = store.bugReports.list();
		expect(row.context.owner).toBe("vheins");
		expect(row.context.repo).toBe("local-memory-mcp");
		expect(row.context.sessionId).toBe("sess-1");
	});
});
