import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleTaskWrite } from "../../../tools/task.write";
import { createTestStore } from "../../../storage/sqlite";
import { VectorStore } from "../../../types";

// FIX-027 — handler-level coverage that bulk/inference rejections NAME the
// failing item (index + code) and state the corrective shape, while valid
// bulk create/update payloads remain unchanged. Mirrors
// src/mcp/tools/task-write/bulk-executor.ts + create.ts per
// .agents/documents/testing.md §2.1.

const OWNER = "test";
const REPO = "fix-027-bulk";

describe("task-write bulk/inference error shape (FIX-027)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let mockVectors: VectorStore;

	beforeEach(async () => {
		db = await createTestStore();
		mockVectors = {
			upsert: vi.fn().mockResolvedValue(undefined),
			remove: vi.fn().mockResolvedValue(undefined),
			search: vi.fn().mockResolvedValue([])
		};
	});

	async function write(args: Record<string, unknown>) {
		return handleTaskWrite({ owner: OWNER, repo: REPO, ...args }, db, mockVectors);
	}

	async function expectThrow(args: Record<string, unknown>): Promise<string> {
		let thrown: unknown;
		try {
			await write(args);
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toBeInstanceOf(Error);
		return (thrown as Error).message;
	}

	// ── id-vs-code hint ───────────────────────────────────────────────────

	it("positive: a short code passed to `id` returns the use-`code` hint", async () => {
		const message = await expectThrow({ id: "TASK-431", status: "in_progress" });
		expect(message).toContain("Invalid id format: 'TASK-431' looks like a task code; use 'code' instead of 'id'.");
		expect(message).toContain('task-write(code: "TASK-431", ...)');
	});

	it("negative: a non-code value in `id` keeps the generic invalid-id guidance", async () => {
		const message = await expectThrow({ id: "abc123", status: "in_progress" });
		expect(message).toContain("Invalid id format: 'abc123'.");
		expect(message).not.toContain("looks like a task code");
	});

	// ── missing-fields lists the exact absent fields ──────────────────────

	it("positive: bulk missing-fields error names the item and EXACTLY the absent fields", async () => {
		const message = await expectThrow({
			tasks: [{ code: "BAD-1", phase: "p" }]
		});
		expect(message).toContain("Missing required fields for create — missing: title, description.");
		// Item-scoped: the failing item's code is named.
		expect(message).toContain("[BAD-1]");
	});

	it("negative: a bulk item missing only `description` names just that field", async () => {
		const message = await expectThrow({
			tasks: [{ code: "BAD-2", phase: "p", title: "Has a title" }]
		});
		expect(message).toContain("missing: description.");
		expect(message).not.toContain("missing: title");
		expect(message).toContain("[BAD-2]");
	});

	// ── no updatable fields is item-scoped + names the field set ──────────

	it("positive: an update item with no updatable fields is rejected with the field list", async () => {
		await write({ code: "UPD-1", phase: "p", title: "Seed", description: "d" });
		const id = db.tasks.getTaskByCode(OWNER, REPO, "UPD-1")!.id;

		const message = await expectThrow({ tasks: [{ id }] });
		expect(message).toContain("No updatable fields provided for update item.");
		expect(message).toContain("Provide at least one of: phase, title, description, status");
		// Item-scoped by its id label.
		expect(message).toContain(`[id ${id}]`);
	});

	// ── duplicate code names the existing task ────────────────────────────

	it("positive: duplicate-code error names the existing task id + status", async () => {
		await write({ code: "DUP-9", phase: "p", title: "Seed", description: "d" });
		const existing = db.tasks.getTaskByCode(OWNER, REPO, "DUP-9")!;

		const message = await expectThrow({
			tasks: [{ code: "DUP-9", phase: "p", title: "Duplicate", description: "d" }]
		});
		expect(message).toContain("Task code 'DUP-9' already exists");
		expect(message).toContain(`(existing task id "${existing.id}", status "${existing.status}")`);
		expect(message).toContain('update instead of create: task-write(code: "DUP-9", ...)');
	});

	it("negative: single-create duplicate-code error also names the existing task", async () => {
		await write({ code: "DUP-10", phase: "p", title: "Seed", description: "d" });
		const existing = db.tasks.getTaskByCode(OWNER, REPO, "DUP-10")!;

		const message = await expectThrow({ code: "DUP-10", phase: "p", title: "Duplicate", description: "d" });
		expect(message).toContain("Task code 'DUP-10' already exists");
		expect(message).toContain(`existing task id "${existing.id}"`);
	});

	// ── partial failure names the failing item in the envelope ────────────

	it("positive: partial failure reports the failing item's index + label + reason", async () => {
		const res = await write({
			json: true,
			tasks: [
				{ code: "OK-1", phase: "p", title: "Good one", description: "d" },
				{ code: "BAD-3", phase: "p" }
			]
		});
		expect(res.isError).toBe(true);
		const data = res.structuredContent as {
			code: string;
			errors: { index: number; error: string }[];
		};
		expect(data.code).toBe("PARTIAL_FAILURE");
		expect(data.errors).toHaveLength(1);
		expect(data.errors[0].index).toBe(1);
		expect(data.errors[0].error).toContain("[BAD-3]");
		expect(data.errors[0].error).toContain("missing: title, description.");
	});

	// ── valid payloads unchanged ──────────────────────────────────────────

	it("negative/control: a valid bulk create still succeeds (unchanged)", async () => {
		const res = await write({
			tasks: [
				{ code: "V-1", phase: "p", title: "Valid one", description: "d" },
				{ code: "V-2", phase: "p", title: "Valid two", description: "d" }
			]
		});
		expect(res.isError).toBeFalsy();
		expect(db.tasks.getTaskByCode(OWNER, REPO, "V-1")).toBeTruthy();
		expect(db.tasks.getTaskByCode(OWNER, REPO, "V-2")).toBeTruthy();
	});

	it("negative/control: a valid bulk status update still succeeds (unchanged)", async () => {
		await write({ code: "V-3", phase: "p", title: "Updatable", description: "d" });
		const id = db.tasks.getTaskByCode(OWNER, REPO, "V-3")!.id;

		const res = await write({ tasks: [{ id, status: "in_progress", comment: "starting" }] });
		expect(res.isError).toBeFalsy();
		expect(db.tasks.getTaskById(id)?.status).toBe("in_progress");
	});

	// ── inference message names the received fields ───────────────────────

	it("positive: a no-op write names the received fields in the inference error", async () => {
		const message = await expectThrow({ priority: 3 });
		expect(message).toContain("Could not infer operation");
		expect(message).toContain("Received fields: priority.");
	});
});
