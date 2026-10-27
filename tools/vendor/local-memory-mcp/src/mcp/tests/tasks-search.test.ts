import { describe, it, expect, beforeEach } from "vitest";
import { handleTaskWrite } from "../tools/task.write";
import { handleTaskRead } from "../tools/task.read";
import { createTestStore } from "../storage/sqlite";
import { VectorStore } from "../types";

describe("Consolidated Task Read — Search and Filtering", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let mockVectors: VectorStore;
	const REPO = "test-search-repo";

	beforeEach(async () => {
		// Use in-memory database for testing
		db = await createTestStore();
		mockVectors = {
			upsert: async () => {},
			remove: async () => {},
			search: async () => []
		} as unknown as VectorStore;

		// Seed some test data
		// handleTaskCreate only allows 'backlog' or 'pending'
		// To get other statuses, we create as pending and then update

		// TASK-001: in_progress
		await handleTaskWrite(
			{
				repo: REPO,
				owner: "test",
				task_code: "TASK-001",
				phase: "Development",
				title: "Implement authentication",
				description: "Setup JWT and OAuth2",
				status: "pending",
				json: true,
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);
		const task1 = db.tasks.getTaskByCode("test", REPO, "TASK-001");
		if (!task1) throw new Error("Task 1 seed failed");
		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				id: task1.id,
				status: "in_progress",
				comment: "Starting work",
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		// TASK-002: pending
		await handleTaskWrite(
			{
				repo: REPO,
				owner: "test",
				task_code: "TASK-002",
				phase: "Testing",
				title: "Write unit tests",
				description: "Cover all auth edge cases",
				status: "pending",
				json: true,
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		// DB-FIX-003: blocked
		await handleTaskWrite(
			{
				repo: REPO,
				owner: "test",
				task_code: "DB-FIX-003",
				phase: "Maintenance",
				title: "Fix database leak",
				description: "Connections not closing properly",
				status: "pending",
				json: true,
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);
		const task3 = db.tasks.getTaskByCode("test", REPO, "DB-FIX-003");
		if (!task3) throw new Error("Task 3 seed failed");
		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				id: task3.id,
				status: "blocked",
				comment: "Missing DB access",
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);
	});

	it("should search tasks by title", async () => {
		const result = await handleTaskRead(
			{
				repo: REPO,
				owner: "test",
				query: "authentication",
				json: true
			},
			db,
			mockVectors
		);

		const tasks = (result.structuredContent as { results: { rows: unknown[][] } }).results;
		expect(tasks.rows).toHaveLength(1);
		expect(tasks.rows[0][1]).toBe("TASK-001");
	});

	it("should search tasks by description", async () => {
		const result = await handleTaskRead(
			{
				repo: REPO,
				owner: "test",
				query: "edge cases",
				json: true
			},
			db,
			mockVectors
		);

		const tasks = (result.structuredContent as { results: { rows: unknown[][] } }).results;
		expect(tasks.rows).toHaveLength(1);
		expect(tasks.rows[0][1]).toBe("TASK-002");
	});

	it("should search tasks by task code", async () => {
		const result = await handleTaskRead(
			{
				repo: REPO,
				owner: "test",
				query: "DB-FIX",
				json: true
			},
			db,
			mockVectors
		);

		const tasks = (result.structuredContent as { results: { rows: unknown[][] } }).results;
		expect(tasks.rows).toHaveLength(1);
		expect(tasks.rows[0][1]).toBe("DB-FIX-003");
	});

	it("should filter by multiple statuses", async () => {
		const result = await handleTaskRead(
			{
				repo: REPO,
				owner: "test",
				status: "in_progress,blocked",
				json: true
			},
			db,
			mockVectors
		);

		const tasks = (result.structuredContent as { tasks: { rows: unknown[][] } }).tasks;
		expect(tasks.rows).toHaveLength(2);
		const codes = tasks.rows.map((r: unknown[]) => r[1]);
		expect(codes).toContain("TASK-001");
		expect(codes).toContain("DB-FIX-003");
	});

	it("should support 'all' status to include everything", async () => {
		const result = await handleTaskRead(
			{
				repo: REPO,
				owner: "test",
				status: "all",
				json: true
			},
			db,
			mockVectors
		);

		const tasks = (result.structuredContent as { tasks: { rows: unknown[][] } }).tasks;
		expect(tasks.rows).toHaveLength(3);
	});

	it("should combine search and status filtering", async () => {
		const result = await handleTaskRead(
			{
				repo: REPO,
				owner: "test",
				query: "auth",
				status: "pending",
				json: true
			},
			db,
			mockVectors
		);

		const tasks = (result.structuredContent as { results: { rows: unknown[][] } }).results;
		expect(tasks.rows).toHaveLength(1);
		expect(tasks.rows[0][1]).toBe("TASK-002");
	});

	it("should return empty list if no matches found", async () => {
		const result = await handleTaskRead(
			{
				repo: REPO,
				owner: "test",
				query: "non-existent-task",
				json: true
			},
			db,
			mockVectors
		);

		const tasks = (result.structuredContent as { results: { rows: unknown[][] } }).results;
		expect(tasks.rows).toHaveLength(0);
	});

	describe("Unified task-read discovery", () => {
		it("should provide same discovery as old task-search", async () => {
			const args = { repo: REPO, owner: "test", query: "authentication", status: "all", json: true };
			const result = await handleTaskRead(args, db, mockVectors);
			const tasks = (result.structuredContent as { results: { rows: unknown[][] } }).results;
			expect(tasks.rows).toHaveLength(1);
			expect(tasks.rows[0][1]).toBe("TASK-001");
			// TASK-001 has one comment added in handleTaskUpdate
			// Search mode columns: id, task_code, title, status, priority, updated_at, phase
		});
	});

	// issue #108 (secondary #4): the same task must not appear twice. Root cause:
	// the keyword fetch is OWNER-scoped while the vector store is REPO-scoped, so
	// a same-code task under a DIFFERENT owner in the same repo leaked in as a
	// vector-only supplement (keyword 1.0 vs vector-only 0.0 → two rows).
	describe("search result dedup (issue #108)", () => {
		it("does not return a same-code task belonging to a different owner as a vector-only supplement", async () => {
			const DEDUP_REPO = "test-dedup-repo";
			// Owner "test" row (the in-scope one).
			await handleTaskWrite(
				{
					repo: DEDUP_REPO,
					owner: "test",
					task_code: "XL-AI-EXIT-4",
					phase: "research",
					title: "XL AI exit probe",
					description: "probe description",
					status: "pending",
					json: true,
					agent: "test-agent",
					role: "test-role"
				},
				db,
				mockVectors
			);
			// Same code under a DIFFERENT owner in the same repo.
			await handleTaskWrite(
				{
					repo: DEDUP_REPO,
					owner: "other",
					task_code: "XL-AI-EXIT-4",
					phase: "research",
					title: "XL AI exit probe",
					description: "probe description",
					status: "pending",
					json: true,
					agent: "other-agent",
					role: "other-role"
				},
				db,
				mockVectors
			);

			const inScope = db.tasks.getTaskByCode("test", DEDUP_REPO, "XL-AI-EXIT-4")!;
			const outOfScope = db.tasks.getTaskByCode("other", DEDUP_REPO, "XL-AI-EXIT-4")!;

			// The vector store is repo-scoped — it surfaces BOTH ids (this is the
			// leak the fix must contain at the owner boundary).
			const repoScopedVectors = {
				upsert: async () => {},
				remove: async () => {},
				search: async () => [
					{ id: inScope.id, score: 0.72, content: "", metadata: {} },
					{ id: outOfScope.id, score: 0.42, content: "", metadata: {} }
				]
			} as unknown as VectorStore;

			const result = await handleTaskRead(
				{ repo: DEDUP_REPO, owner: "test", query: "XL-AI-EXIT-4", json: true },
				db,
				repoScopedVectors
			);

			const rows = (result.structuredContent as { results: { rows: unknown[][] } }).results.rows;
			const codes = rows.map((r) => r[1]);
			expect(codes).toContain("XL-AI-EXIT-4");
			// The out-of-scope owner's row must NOT be appended.
			const ids = rows.map((r) => r[0]);
			expect(ids).toContain(inScope.id);
			expect(ids).not.toContain(outOfScope.id);
			// Exactly one row for the single in-scope task.
			expect(rows).toHaveLength(1);
		});

		it("never emits duplicate task ids in the result rows", async () => {
			const result = await handleTaskRead(
				{ repo: REPO, owner: "test", query: "task", status: "all", json: true },
				db,
				mockVectors
			);
			const rows = (result.structuredContent as { results: { rows: unknown[][] } }).results.rows;
			const ids = rows.map((r) => r[0]);
			expect(new Set(ids).size).toBe(ids.length);
		});
	});
});
