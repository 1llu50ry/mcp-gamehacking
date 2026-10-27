/**
 * Unit tests for src/mcp/utils/action-log.ts — the unified action-log policy
 * (logAction / logActions / logToolAction) used by tool dispatch across both
 * transports and the dashboard controllers.
 *
 * POLICY under test (TASK-104): action_log INSERTs never acquire the file
 * lock; logging never throws — a logging failure must never break the request
 * it audits.
 *
 * POLICY under test (OPT-PERF-05): logToolAction emits a row ONLY for
 * mutating tools (ACTION_LOG_TOOLS) — read-only tools perform no DB write.
 *
 * Mock strategy: a minimal `db` shaped like SQLiteStore is injected, exactly
 * mirroring the router.test.ts mock convention. No real DB / proper-lockfile.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { extractActionLog, logAction, logActions, logToolAction, type ActionLogEntry } from "../utils/action-log";
import { logger } from "../utils/logger";
import type { SQLiteStore } from "../storage/sqlite";

function makeMockDb(actionsImpl?: () => void) {
	const logActionSpy = vi.fn(actionsImpl ?? (() => undefined));
	const db = {
		actions: { logAction: logActionSpy }
	} as unknown as SQLiteStore;
	return { db, logActionSpy };
}

describe("extractActionLog", () => {
	// OPT-DRY-05: metadata derivation is shared by both transports and MUST
	// read result.structuredContent — the field McpResponse exposes — not the
	// non-existent structuredData the old copy-pasted readers used.

	it("derives action type, repo and query from toolName/args", () => {
		const extracted = extractActionLog("memory-read", { repo: "acme/app", query: "hello" }, {});

		expect(extracted.action).toBe("read");
		expect(extracted.repo).toBe("acme/app");
		expect(extracted.options.query).toBe("hello");
	});

	it("reads repo from args.scope.repo when args.repo is absent", () => {
		const extracted = extractActionLog("task-write", { scope: { owner: "acme", repo: "app" } }, {});

		expect(extracted.repo).toBe("app");
	});

	it("populates memoryId/resultCount from memory-domain structuredContent; taskId stays empty (TASK-155)", () => {
		const result = {
			content: [],
			isError: false,
			structuredContent: { id: "mem-123", results: [{ id: "a" }, { id: "b" }, { id: "c" }] }
		};

		const extracted = extractActionLog("memory-read", { query: "x" }, result);

		expect(extracted.options.memoryId).toBe("mem-123");
		// A generic top-level id on a memory-domain tool must never leak into
		// the task_id column (wrong-entity corruption, the original bug).
		expect(extracted.options.taskId).toBeUndefined();
		expect(extracted.options.resultCount).toBe(3);
		// The McpResponse itself is preserved as the audit `response` payload.
		expect(extracted.options.response).toBe(result);
	});

	it("populates taskId for task-domain tools; memoryId stays empty (TASK-155)", () => {
		const extracted = extractActionLog("task-write", {}, { structuredContent: { id: "task-789", title: "Ship" } });

		expect(extracted.options.taskId).toBe("task-789");
		expect(extracted.options.memoryId).toBeUndefined();
		// task-read detail spreads task fields onto the top level.
		const detail = extractActionLog("task-read", {}, { structuredContent: { id: "task-uuid", phase: "x" } });
		expect(detail.options.taskId).toBe("task-uuid");
		expect(detail.options.memoryId).toBeUndefined();
	});

	it("prefers the domain-nested id key over the generic top-level id (memory detail)", () => {
		const extracted = extractActionLog(
			"memory-read",
			{},
			{ structuredContent: { memory: { id: "mem-nested", title: "t" }, id: "mem-generic" } }
		);

		expect(extracted.options.memoryId).toBe("mem-nested");
		expect(extracted.options.taskId).toBeUndefined();
	});

	it("maps handoff/claim domain tools to taskId via their nested keys (TASK-155)", () => {
		const handoff = extractActionLog("handoff-write", {}, { structuredContent: { handoff: { id: "ho-1" } } });
		expect(handoff.options.taskId).toBe("ho-1");
		expect(handoff.options.memoryId).toBeUndefined();

		// claim-manage spreads the claim row onto the top level (top-level id).
		const claimSpread = extractActionLog("claim-manage", {}, { structuredContent: { id: "claim-row-1" } });
		expect(claimSpread.options.taskId).toBe("claim-row-1");
		expect(claimSpread.options.memoryId).toBeUndefined();
	});

	it("does not map standard-domain ids to either entity column (TASK-155)", () => {
		const extracted = extractActionLog("standard-write", {}, { structuredContent: { id: "std-1" } });

		expect(extracted.options.memoryId).toBeUndefined();
		expect(extracted.options.taskId).toBeUndefined();
	});

	it("maps args.id only to the domain-matching column — never cross-leaks (TASK-157)", () => {
		// memory-domain: args.id → memoryId, taskId stays empty.
		const memory = extractActionLog(
			"memory-write",
			{ id: "args-id", memory_id: "args-memory-id" },
			{ structuredContent: { id: "sc-id" } }
		);

		expect(memory.options.memoryId).toBe("args-id");
		// The memory UUID in args.id must never leak into task_id.
		expect(memory.options.taskId).toBeUndefined();

		// task-domain mirror: args.id → taskId, memoryId stays empty.
		const task = extractActionLog("task-write", { id: "args-id", task_id: "args-task-id" }, {});

		expect(task.options.taskId).toBe("args-id");
		expect(task.options.memoryId).toBeUndefined();
	});

	it("falls back to resultCount via structuredContent.count", () => {
		const extracted = extractActionLog("task-read", {}, { structuredContent: { count: 7 } });

		expect(extracted.options.resultCount).toBe(7);
		expect(extracted.options.memoryId).toBeUndefined();
		expect(extracted.options.taskId).toBeUndefined();
	});

	it("reads resultCount from delete-tool count fields (TASK-156)", () => {
		const memDelete = extractActionLog(
			"memory-delete",
			{},
			{ structuredContent: { success: true, deletedCount: 2, skippedCount: 1, totalAttempted: 3 } }
		);
		expect(memDelete.options.resultCount).toBe(2);

		const taskDelete = extractActionLog("task-delete", {}, { structuredContent: { success: true, canceledCount: 1 } });
		expect(taskDelete.options.resultCount).toBe(1);
	});

	it("prefers createdCount over the results array length for bulk creates (TASK-156)", () => {
		const extracted = extractActionLog(
			"task-write",
			{},
			{
				structuredContent: {
					success: true,
					createdCount: 5,
					results: [{}, {}, {}, {}, {}, {}] // 6 processed, 5 created
				}
			}
		);

		expect(extracted.options.resultCount).toBe(5);
	});

	it("reads resultCount from a real buildTableResult envelope ({ schema, results: { columns, rows }, count })", () => {
		const extracted = extractActionLog(
			"task-read",
			{},
			{
				structuredContent: {
					schema: "task-read/search",
					results: {
						columns: ["id", "title"],
						rows: [
							["a", "A"],
							["b", "B"],
							["c", "C"]
						]
					},
					count: 3
				}
			}
		);

		expect(extracted.options.resultCount).toBe(3);
	});

	it("does NOT read the legacy structuredData key (silent-no-op regression guard)", () => {
		const extracted = extractActionLog("memory-read", {}, { structuredData: { id: "ghost", count: 9 } });

		expect(extracted.options.memoryId).toBeUndefined();
		expect(extracted.options.resultCount).toBe(0);
	});

	it("degrades gracefully: unknown repo, zero resultCount, no query when inputs are empty", () => {
		const extracted = extractActionLog("agent-context", {}, undefined);

		expect(extracted.action).toBe("context");
		expect(extracted.repo).toBe("unknown");
		expect(extracted.options.query).toBeUndefined();
		expect(extracted.options.memoryId).toBeUndefined();
		expect(extracted.options.taskId).toBeUndefined();
		expect(extracted.options.resultCount).toBe(0);
	});
});

describe("logAction", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("forwards action/owner/repo/options to db.actions.logAction", () => {
		const { db, logActionSpy } = makeMockDb();
		const options = { query: "search", resultCount: 3 };

		logAction(db, "memory-read", "owner-x", "repo-y", options);

		expect(logActionSpy).toHaveBeenCalledTimes(1);
		expect(logActionSpy).toHaveBeenCalledWith("memory-read", "owner-x", "repo-y", options);
	});

	it("passes options through unchanged (incl. response object + ids)", () => {
		const { db, logActionSpy } = makeMockDb();
		const options = {
			response: { structuredContent: { success: true } },
			memoryId: "mem-1",
			taskId: "task-1"
		};

		logAction(db, "task-write", "o", "r", options);

		expect(logActionSpy).toHaveBeenCalledWith("task-write", "o", "r", options);
	});

	it("passes undefined options when omitted", () => {
		const { db, logActionSpy } = makeMockDb();

		logAction(db, "memory-read", "o", "r");

		expect(logActionSpy).toHaveBeenCalledWith("memory-read", "o", "r", undefined);
	});

	it("never throws when the entity insert fails — logs via logger.error instead", () => {
		const { db } = makeMockDb(() => {
			throw new Error("db locked");
		});
		const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);

		expect(() => logAction(db, "memory-read", "o", "r")).not.toThrow();
		expect(errorSpy).toHaveBeenCalledWith("Failed to log action", {
			action: "memory-read",
			repo: "r",
			error: "Error: db locked"
		});
	});
});

describe("logToolAction (OPT-PERF-05 read-tool gate)", () => {
	it("writes no action_log row for read-only tools", () => {
		const { db, logActionSpy } = makeMockDb();

		logToolAction(db, "memory-read", { repo: "acme/app", query: "hello" }, { structuredContent: {} });
		logToolAction(db, "task-read", { repo: "acme/app" }, { structuredContent: {} });
		logToolAction(db, "standard-read", { repo: "acme/app" }, { structuredContent: {} });
		logToolAction(db, "handoff-read", { repo: "acme/app" }, { structuredContent: {} });
		logToolAction(db, "codebase-read", { repo: "acme/app" }, { structuredContent: {} });

		expect(logActionSpy).not.toHaveBeenCalled();
	});

	it("logs mutating tools with derived metadata", () => {
		const { db, logActionSpy } = makeMockDb();

		logToolAction(db, "task-write", { repo: "acme/app" }, { structuredContent: { id: "task-1" } });

		expect(logActionSpy).toHaveBeenCalledTimes(1);
		expect(logActionSpy).toHaveBeenCalledWith("write", "", "acme/app", expect.objectContaining({ taskId: "task-1" }));
	});

	it("keeps logging codebase-index (mutation excluded from WRITE_TOOLS for lock reasons)", () => {
		const { db, logActionSpy } = makeMockDb();

		logToolAction(db, "codebase-index", { repo: "acme/app" }, { structuredContent: {} });

		expect(logActionSpy).toHaveBeenCalledTimes(1);
		expect(logActionSpy).toHaveBeenCalledWith("index", "", "acme/app", expect.any(Object));
	});

	it("skips claim-manage LIST modes (agent-only or no-arg calls) — no action_log write (TASK-162)", () => {
		const { db, logActionSpy } = makeMockDb();

		// LIST claims by agent (agent, no task ref)
		logToolAction(db, "claim-manage", { repo: "acme/app", agent: "backend" }, { structuredContent: {} });
		// LIST all active claims (no args)
		logToolAction(db, "claim-manage", { repo: "acme/app" }, { structuredContent: {} });

		expect(logActionSpy).not.toHaveBeenCalled();
	});

	it("audits claim-manage CLAIM and RELEASE mutations (TASK-162)", () => {
		const { db, logActionSpy } = makeMockDb();

		// CLAIM: task_id + agent
		logToolAction(
			db,
			"claim-manage",
			{ repo: "acme/app", task_id: "task-1", agent: "backend" },
			{ structuredContent: {} }
		);
		// RELEASE: task_code + release:true
		logToolAction(db, "claim-manage", { repo: "acme/app", task_code: "T01", release: true }, { structuredContent: {} });

		expect(logActionSpy).toHaveBeenCalledTimes(2);
		expect(logActionSpy).toHaveBeenNthCalledWith(
			1,
			"manage",
			"",
			"acme/app",
			expect.objectContaining({ taskId: "task-1" })
		);
		expect(logActionSpy).toHaveBeenNthCalledWith(2, "manage", "", "acme/app", expect.any(Object));
	});

	it("never throws when the entity insert fails — same policy as logAction", () => {
		const { db } = makeMockDb(() => {
			throw new Error("db locked");
		});
		const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);

		expect(() => logToolAction(db, "task-write", { repo: "acme/app" }, { structuredContent: {} })).not.toThrow();
		expect(errorSpy).toHaveBeenCalled();
	});
});

describe("logActions (batch)", () => {
	let logActionSpy: ReturnType<typeof vi.fn>;
	let transactionBody: ((rows: ActionLogEntry[]) => void) | undefined;
	let db: SQLiteStore;

	beforeEach(() => {
		logActionSpy = vi.fn();
		// Mirror better-sqlite3's transaction(fn).immediate(rows) contract:
		// the wrapper captures the body and executes it synchronously.
		transactionBody = undefined;
		const transaction = vi.fn((body: (rows: ActionLogEntry[]) => void) => {
			transactionBody = body;
			return {
				immediate: (rows: ActionLogEntry[]) => {
					transactionBody?.(rows);
				}
			};
		});
		db = {
			db: { transaction } as unknown as SQLiteStore["db"],
			actions: { logAction: logActionSpy }
		} as unknown as SQLiteStore;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("logs every entry with its own options inside one transaction", () => {
		const entries: ActionLogEntry[] = [
			{ action: "memory-read", owner: "o", repo: "r", options: { resultCount: 2 } },
			{ action: "task-write", owner: "o", repo: "r" }
		];

		logActions(db, entries);

		expect(logActionSpy).toHaveBeenCalledTimes(2);
		expect(logActionSpy).toHaveBeenNthCalledWith(1, "memory-read", "o", "r", { resultCount: 2 });
		expect(logActionSpy).toHaveBeenNthCalledWith(2, "task-write", "o", "r", undefined);
	});

	it("is a no-op for an empty entry list (no transaction started)", () => {
		logActions(db, []);

		expect(db.db.transaction as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
		expect(logActionSpy).not.toHaveBeenCalled();
	});

	it("never throws on batch failure — logs via logger.error instead", () => {
		const failingDb = {
			db: {
				transaction: vi.fn(() => {
					throw new Error("tx failed");
				})
			} as unknown as SQLiteStore["db"],
			actions: { logAction: vi.fn() }
		} as unknown as SQLiteStore;
		const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);

		expect(() => logActions(failingDb, [{ action: "memory-read", owner: "o", repo: "r" }])).not.toThrow();
		expect(errorSpy).toHaveBeenCalledWith("Failed to log actions (batch)", {
			count: 1,
			error: "Error: tx failed"
		});
	});
});
