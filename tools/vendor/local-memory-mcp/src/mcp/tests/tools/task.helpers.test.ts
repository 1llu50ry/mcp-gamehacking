import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleTaskWrite } from "../../tools/task.write";
import { resolveParentId, resolveDependsOn } from "../../tools/task.helpers";
import { createTestStore } from "../../storage/sqlite";
import { toErrorResponse } from "../../utils/mcp-error";
import { VectorStore } from "../../types";

// FIX-024 — task-write parent_id/depends_on must be pre-validated against the
// existing task set (same scope) BEFORE the INSERT/UPDATE, so a reference to a
// task that does not exist surfaces a caller-actionable VALIDATION_ERROR naming
// the missing reference instead of a raw SQLite `FOREIGN KEY constraint failed`.
// Mirrors src/mcp/tools/task.helpers.ts per .agents/documents/testing.md §2.1.

describe("task.helpers — resolveParentId / resolveDependsOn existence pre-check (FIX-024)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	const OWNER = "test";
	const REPO = "fix-024-helpers";

	beforeEach(async () => {
		db = await createTestStore();
	});

	async function seed(code: string) {
		const res = await handleTaskWrite(
			{ owner: OWNER, repo: REPO, code, phase: "p", title: `Task ${code}`, description: "d" },
			db,
			{ upsert: vi.fn(), remove: vi.fn(), search: vi.fn() } as unknown as VectorStore
		);
		expect(res.isError).toBeFalsy();
		return db.tasks.getTaskByCode(OWNER, REPO, code)!;
	}

	it("positive: resolves a valid task CODE reference to its UUID", async () => {
		const parent = await seed("REF-1");
		expect(resolveParentId("REF-1", OWNER, REPO, db)).toBe(parent.id);
		expect(resolveDependsOn("REF-1", OWNER, REPO, db)).toBe(parent.id);
	});

	it("positive: passes through a valid UUID reference and null/undefined unchanged", async () => {
		const parent = await seed("REF-2");
		expect(resolveParentId(parent.id, OWNER, REPO, db)).toBe(parent.id);
		expect(resolveDependsOn(parent.id, OWNER, REPO, db)).toBe(parent.id);
		expect(resolveParentId(null, OWNER, REPO, db)).toBeNull();
		expect(resolveDependsOn(undefined, OWNER, REPO, db)).toBeNull();
	});

	it("negative: a non-existent CODE throws the friendly parent_id error (VALIDATION_ERROR)", () => {
		let thrown: unknown;
		try {
			resolveParentId("FIX-559-2", OWNER, REPO, db);
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toBeInstanceOf(Error);
		const message = (thrown as Error).message;
		expect(message).toContain("parent_id references 'FIX-559-2' which does not exist in test/fix-024-helpers");
		const envelope = toErrorResponse(thrown);
		expect(envelope.structuredContent).toMatchObject({ code: "VALIDATION_ERROR", retryable: false });
	});

	it("negative: a well-formed but non-existent UUID is rejected before SQLite", () => {
		const ghost = "11111111-2222-3333-4444-555555555555";
		expect(() => resolveParentId(ghost, OWNER, REPO, db)).toThrow(
			`parent_id references '${ghost}' which does not exist in test/fix-024-helpers`
		);
		expect(() => resolveDependsOn(ghost, OWNER, REPO, db)).toThrow(
			`depends_on references '${ghost}' which does not exist in test/fix-024-helpers`
		);
		const envelope = toErrorResponse(
			new Error(`depends_on references '${ghost}' which does not exist in test/fix-024-helpers.`)
		);
		expect(envelope.structuredContent).toMatchObject({ code: "VALIDATION_ERROR" });
	});

	it("negative: a non-existent depends_on CODE throws the friendly depends_on error", () => {
		expect(() => resolveDependsOn("NOPE-9", OWNER, REPO, db)).toThrow(
			"depends_on references 'NOPE-9' which does not exist in test/fix-024-helpers"
		);
	});

	it("negative: an unsubstituted orchestrator placeholder keeps its actionable error (not the missing-reference error)", () => {
		expect(() => resolveParentId("T01", OWNER, REPO, db)).toThrow(/unsubstituted orchestrator template placeholder/);
	});
});

describe("task-write parent_id/depends_on pre-validation across create/update/bulk (FIX-024)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let mockVectors: VectorStore;
	const OWNER = "test";
	const REPO = "fix-024-write";

	beforeEach(async () => {
		db = await createTestStore();
		mockVectors = {
			upsert: vi.fn().mockResolvedValue(undefined),
			remove: vi.fn().mockResolvedValue(undefined),
			search: vi.fn().mockResolvedValue([])
		};
	});

	async function create(args: Record<string, unknown>) {
		return handleTaskWrite({ owner: OWNER, repo: REPO, ...args }, db, mockVectors);
	}

	async function expectValidationError(args: Record<string, unknown>): Promise<string> {
		let thrown: unknown;
		try {
			await create(args);
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toBeInstanceOf(Error);
		const envelope = toErrorResponse(thrown);
		expect(envelope.structuredContent).toMatchObject({ code: "VALIDATION_ERROR", retryable: false });
		return (thrown as Error).message;
	}

	it("positive: create with valid parent_id + depends_on references succeeds", async () => {
		const parent = await create({ code: "P-1", phase: "p", title: "Parent", description: "d" });
		expect(parent.isError).toBeFalsy();
		const parentId = db.tasks.getTaskByCode(OWNER, REPO, "P-1")!.id;

		const child = await create({
			code: "C-1",
			phase: "p",
			title: "Child",
			description: "d",
			parent_id: "P-1",
			depends_on: parentId
		});
		expect(child.isError).toBeFalsy();
		const stored = db.tasks.getTaskByCode(OWNER, REPO, "C-1")!;
		expect(stored.parent_id).toBe(parentId);
		expect(stored.depends_on).toBe(parentId);
	});

	it("negative: create with a non-existent parent_id CODE returns VALIDATION_ERROR naming the reference", async () => {
		const message = await expectValidationError({
			code: "C-2",
			phase: "p",
			title: "Child",
			description: "d",
			parent_id: "FIX-559-2"
		});
		expect(message).toContain("parent_id references 'FIX-559-2' which does not exist in test/fix-024-write");
		expect(message).not.toMatch(/FOREIGN KEY/i);
	});

	it("negative: create with a non-existent depends_on UUID returns VALIDATION_ERROR", async () => {
		const ghost = "11111111-2222-3333-4444-555555555555";
		const message = await expectValidationError({
			code: "C-3",
			phase: "p",
			title: "Child",
			description: "d",
			depends_on: ghost
		});
		expect(message).toContain(`depends_on references '${ghost}' which does not exist in test/fix-024-write`);
	});

	it("negative: update with a non-existent parent_id returns VALIDATION_ERROR", async () => {
		await create({ code: "U-1", phase: "p", title: "Updatable", description: "d" });
		const message = await expectValidationError({ code: "U-1", parent_id: "MISSING-PARENT" });
		expect(message).toContain("parent_id references 'MISSING-PARENT' which does not exist in test/fix-024-write");
	});

	it("negative: bulk create reports the failing item with the friendly message", async () => {
		const res = await create({
			tasks: [
				{ code: "B-1", phase: "p", title: "Sibling parent", description: "d" },
				{ code: "B-2", phase: "p", title: "Sibling child", description: "d", parent_id: "B-1" },
				{ code: "B-3", phase: "p", title: "Bad child", description: "d", depends_on: "GHOST-1" }
			]
		});
		expect(res.isError).toBe(true);
		const structured = res.structuredContent as {
			code: string;
			errors: { index: number; error: string }[];
		};
		expect(structured.code).toBe("PARTIAL_FAILURE");
		expect(structured.errors).toHaveLength(1);
		expect(structured.errors[0].index).toBe(2);
		expect(structured.errors[0].error).toContain(
			"depends_on references 'GHOST-1' which does not exist in test/fix-024-write"
		);
		// The two valid items (including the backward sibling reference) succeeded.
		expect(db.tasks.getTaskByCode(OWNER, REPO, "B-2")?.parent_id).toBe(db.tasks.getTaskByCode(OWNER, REPO, "B-1")?.id);
	});

	it("negative: bulk create where every item fails throws the friendly error", async () => {
		const message = await expectValidationError({
			tasks: [{ code: "ONLY-1", phase: "p", title: "Only item", description: "d", parent_id: "NO-SUCH" }]
		});
		expect(message).toContain("parent_id references 'NO-SUCH' which does not exist in test/fix-024-write");
	});
});
