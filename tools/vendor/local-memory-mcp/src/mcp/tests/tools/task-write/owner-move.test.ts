import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleTaskWrite } from "../../../tools/task.write";
import { createTestStore } from "../../../storage/sqlite";
import { VectorStore } from "../../../types";

// FEAT-007 — explicit opt-in task owner move (`new_owner`). `owner` stays a
// scope/identity SELECTOR (never implicitly mutable); `new_owner` is the only
// way to re-scope a row. Mirrors src/mcp/tools/task-write/update.ts +
// update-field.ts (validateNewOwner) + entities/task-comment.ts per
// .agents/documents/testing.md §2.1.

const OWNER_A = "alice";
const OWNER_B = "bob";
const REPO = "feat-007-owner-move";

describe("task-write explicit owner move (FEAT-007)", () => {
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

	async function write(owner: string, args: Record<string, unknown>) {
		return handleTaskWrite({ owner, repo: REPO, ...args }, db, mockVectors);
	}

	async function create(owner: string, code: string, status?: string) {
		return write(owner, {
			code,
			phase: "p",
			title: `Task ${code}`,
			description: "d",
			...(status ? { status } : {})
		});
	}

	async function expectThrow(owner: string, args: Record<string, unknown>): Promise<string> {
		let thrown: unknown;
		try {
			await write(owner, args);
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toBeInstanceOf(Error);
		return (thrown as Error).message;
	}

	// ── acceptance #1: move + `owner` reported in updatedFields ────────────

	it("moves a task from owner A to owner B and reports `owner` in updatedFields", async () => {
		await create(OWNER_A, "MOVE-1");
		const id = db.tasks.getTaskByCode(OWNER_A, REPO, "MOVE-1")!.id;

		const res = await write(OWNER_A, { code: "MOVE-1", new_owner: OWNER_B, json: true });

		expect(res.isError).toBeFalsy();
		expect((res.structuredContent as { updatedFields: string[] }).updatedFields).toContain("owner");
		expect(db.tasks.getTaskById(id)?.owner).toBe(OWNER_B);
		// Resolvable under the new owner, invisible under the old scope.
		expect(db.tasks.getTaskByCode(OWNER_B, REPO, "MOVE-1")).toBeTruthy();
		expect(db.tasks.getTaskByCode(OWNER_A, REPO, "MOVE-1")).toBeNull();
	});

	// ── acceptance #3: task_comments.owner synced in the same transaction ──

	it("re-scopes task_comments.owner in the same transaction as the move", async () => {
		await create(OWNER_A, "MOVE-2");
		const id = db.tasks.getTaskByCode(OWNER_A, REPO, "MOVE-2")!.id;
		// Produce a comment row via a status transition under owner A.
		await write(OWNER_A, { code: "MOVE-2", status: "in_progress", agent: "tester" });
		const before = db.taskComments.getTaskCommentsByTaskId(id);
		expect(before.length).toBeGreaterThan(0);
		expect(before.every((c) => c.owner === OWNER_A)).toBe(true);

		await write(OWNER_A, { code: "MOVE-2", new_owner: OWNER_B, json: true });

		const after = db.taskComments.getTaskCommentsByTaskId(id);
		expect(after.length).toBe(before.length);
		expect(after.every((c) => c.owner === OWNER_B)).toBe(true);
		// Visible in the new owner's comment scope.
		expect(db.taskComments.getAllTaskCommentsByRepo(OWNER_B, REPO).some((c) => c.task_id === id)).toBe(true);
		expect(db.taskComments.getAllTaskCommentsByRepo(OWNER_A, REPO).some((c) => c.task_id === id)).toBe(false);
	});

	// ── acceptance #2: identity-key collision fails with no partial write ──

	it("fails with an actionable error and no partial write on identity collision", async () => {
		await create(OWNER_A, "COLLIDE-1");
		await create(OWNER_B, "COLLIDE-1");
		const aId = db.tasks.getTaskByCode(OWNER_A, REPO, "COLLIDE-1")!.id;
		const bId = db.tasks.getTaskByCode(OWNER_B, REPO, "COLLIDE-1")!.id;

		const message = await expectThrow(OWNER_A, { code: "COLLIDE-1", new_owner: OWNER_B });

		expect(message).toContain("Cannot move task 'COLLIDE-1' to owner 'bob'");
		expect(message).toContain(`(owner "bob", repo "${REPO}", task_code "COLLIDE-1") already exists`);
		expect(message).toContain(`existing task id "${bId}"`);
		expect(message).toContain("rename-and-move");

		// No partial write: both rows keep their original owner + code.
		expect(db.tasks.getTaskById(aId)?.owner).toBe(OWNER_A);
		expect(db.tasks.getTaskById(bId)?.owner).toBe(OWNER_B);
		expect(db.tasks.getTaskByCode(OWNER_A, REPO, "COLLIDE-1")?.id).toBe(aId);
	});

	it("supports an optional rename in the same call to resolve a collision", async () => {
		await create(OWNER_A, "RM-1");
		await create(OWNER_B, "RM-1");
		const aId = db.tasks.getTaskByCode(OWNER_A, REPO, "RM-1")!.id;

		const res = await write(OWNER_A, { code: "RM-1", new_owner: OWNER_B, task_code: "RM-1B", json: true });

		expect(res.isError).toBeFalsy();
		expect((res.structuredContent as { updatedFields: string[] }).updatedFields).toContain("owner");
		const moved = db.tasks.getTaskById(aId)!;
		expect(moved.owner).toBe(OWNER_B);
		expect(moved.task_code).toBe("RM-1B");
		expect(db.tasks.getTaskByCode(OWNER_B, REPO, "RM-1B")?.id).toBe(aId);
	});

	// ── acceptance #4: invalid owners rejected ─────────────────────────────

	it("rejects an empty new_owner", async () => {
		await create(OWNER_A, "BAD-EMPTY");
		const message = await expectThrow(OWNER_A, { code: "BAD-EMPTY", new_owner: "" });
		expect(message).toContain("Invalid new_owner");
		expect(db.tasks.getTaskByCode(OWNER_A, REPO, "BAD-EMPTY")?.owner).toBe(OWNER_A);
	});

	it("rejects a whitespace-only new_owner", async () => {
		await create(OWNER_A, "BAD-WS");
		const message = await expectThrow(OWNER_A, { code: "BAD-WS", new_owner: "   " });
		expect(message).toContain("Invalid new_owner");
		expect(db.tasks.getTaskByCode(OWNER_A, REPO, "BAD-WS")?.owner).toBe(OWNER_A);
	});

	it("rejects a dotfile new_owner", async () => {
		await create(OWNER_A, "BAD-DOT");
		const message = await expectThrow(OWNER_A, { code: "BAD-DOT", new_owner: ".config" });
		expect(message).toContain("Invalid new_owner: '.config' is a reserved OS/path segment");
		expect(db.tasks.getTaskByCode(OWNER_A, REPO, "BAD-DOT")?.owner).toBe(OWNER_A);
	});

	it("rejects a reserved OS-segment new_owner (home)", async () => {
		await create(OWNER_A, "BAD-HOME");
		const message = await expectThrow(OWNER_A, { code: "BAD-HOME", new_owner: "home" });
		expect(message).toContain("Invalid new_owner: 'home' is a reserved OS/path segment");
		expect(db.tasks.getTaskByCode(OWNER_A, REPO, "BAD-HOME")?.owner).toBe(OWNER_A);
	});

	it("rejects a malformed username new_owner", async () => {
		await create(OWNER_A, "BAD-FMT");
		const message = await expectThrow(OWNER_A, { code: "BAD-FMT", new_owner: "-bad-" });
		expect(message).toContain("Invalid new_owner: '-bad-'");
		expect(message).toContain("valid GitHub username");
	});

	// ── acceptance #5: ordinary updates never mutate owner/repo ────────────

	it("never mutates owner on an ordinary update and does not report it", async () => {
		await create(OWNER_A, "PLAIN-1");
		const id = db.tasks.getTaskByCode(OWNER_A, REPO, "PLAIN-1")!.id;

		const res = await write(OWNER_A, { code: "PLAIN-1", title: "Renamed title", json: true });

		expect(res.isError).toBeFalsy();
		const fields = (res.structuredContent as { updatedFields: string[] }).updatedFields;
		expect(fields).toContain("title");
		expect(fields).not.toContain("owner");
		const row = db.tasks.getTaskById(id)!;
		expect(row.owner).toBe(OWNER_A);
		expect(row.repo).toBe(REPO);
	});

	it("never mutates owner on a status transition", async () => {
		await create(OWNER_A, "PLAIN-2");
		const id = db.tasks.getTaskByCode(OWNER_A, REPO, "PLAIN-2")!.id;

		const res = await write(OWNER_A, { code: "PLAIN-2", status: "in_progress", json: true });

		expect(res.isError).toBeFalsy();
		expect((res.structuredContent as { updatedFields: string[] }).updatedFields).not.toContain("owner");
		expect(db.tasks.getTaskById(id)?.owner).toBe(OWNER_A);
	});

	// ── bulk guard: owner move is single-task only ─────────────────────────

	it("rejects new_owner on the bulk-by-ids path", async () => {
		await create(OWNER_A, "BULK-1");
		const id = db.tasks.getTaskByCode(OWNER_A, REPO, "BULK-1")!.id;
		const message = await expectThrow(OWNER_A, { ids: [id], new_owner: OWNER_B });
		expect(message).toContain("Invalid new_owner for bulk update");
		expect(message).toContain("single-task only");
		expect(db.tasks.getTaskById(id)?.owner).toBe(OWNER_A);
	});

	it("rejects new_owner on the tasks[] bulk path", async () => {
		await create(OWNER_A, "BULK-2");
		const message = await expectThrow(OWNER_A, {
			new_owner: OWNER_B,
			tasks: [{ code: "BULK-2", title: "Valid bulk title" }]
		});
		expect(message).toContain("Invalid new_owner for bulk update");
	});
});
