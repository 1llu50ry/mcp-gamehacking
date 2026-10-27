import { describe, it, expect, beforeEach } from "vitest";
import { createTestStore, type SQLiteStore } from "../storage/sqlite";
import { resolveEntityRef } from "../utils/entity-ref";
import { resolveTaskByRef } from "../utils/coordination";

/**
 * TASK-426: task codes are unique per (owner, repo). A bare "Task not found: X"
 * hid which namespace was searched, so the same code resolving differently per
 * path (dashboard owner="" vs MCP session-inferred owner) was confusing. These
 * tests assert the richer message surfaces the exact scope used.
 */
describe("task not-found scope (TASK-426)", () => {
	let store: SQLiteStore;

	beforeEach(async () => {
		store = await createTestStore();
	});

	it("resolveEntityRef includes owner/repo in the task not-found message", () => {
		expect(() => resolveEntityRef(store, "task", "MISSING-CODE", "acme", "widgets")).toThrow(
			'Task not found: MISSING-CODE (owner="acme", repo="widgets")'
		);
	});

	it("resolveEntityRef surfaces an empty owner namespace (dashboard path)", () => {
		expect(() => resolveEntityRef(store, "task", "MISSING-CODE", "", "widgets")).toThrow(
			'Task not found: MISSING-CODE (owner="", repo="widgets")'
		);
	});

	it("resolveTaskByRef (code in task_id slot) includes owner/repo", () => {
		expect(() => resolveTaskByRef("acme", "widgets", "MISSING-CODE", undefined, store)).toThrow(
			'Task not found: MISSING-CODE (owner="acme", repo="widgets")'
		);
	});

	it("resolveTaskByRef (explicit task_code) includes owner/repo", () => {
		expect(() => resolveTaskByRef("acme", "widgets", undefined, "MISSING-CODE", store)).toThrow(
			'Task not found: MISSING-CODE (owner="acme", repo="widgets")'
		);
	});
});
