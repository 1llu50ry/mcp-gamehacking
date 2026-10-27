import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";
import { getPrimaryTextContent } from "../utils/mcp-response";

// ─── BULK mixed operations ───────────────────────────────────────────────
// Split out from memory.write.test.ts to keep that file within the 500-line
// maintainability limit. Setup mirrors the original describe:
// createTestStore + StubVectorStore + json:true router wrapper.

describe("MCP Local Memory - memory-write BULK (memories[])", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: Record<string, unknown>) => Promise<any>;

	const REPO = "memory-write-test";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
		const rawRouter = createRouter(db, vectors);
		router = async (method, params) => {
			const args = (params as Record<string, unknown>)?.arguments as Record<string, unknown> | undefined;
			if (method === "tools/call" && args) {
				args.json = true;
			}
			return rawRouter(method, params);
		};
	});

	it("should BULK create multiple memories via memories[]", async () => {
		const bulkRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				owner: "test",
				repo: REPO,
				memories: [
					{
						type: "code_fact",
						title: "Bulk Memory A",
						content: "First memory in a bulk create operation.",
						importance: 3,
						agent: "test-agent",
						model: "test-model"
					},
					{
						type: "decision",
						title: "Bulk Memory B",
						content: "Second memory in a bulk create operation.",
						importance: 4,
						agent: "test-agent",
						model: "test-model"
					}
				]
			}
		});

		expect(bulkRes.structuredContent.success).toBe(true);
		expect(bulkRes.structuredContent.total).toBe(2);
		expect(bulkRes.structuredContent.processed).toBe(2);
		expect(getPrimaryTextContent(bulkRes)).toContain("Processed 2/2");

		const all = db.memories.getRecentMemories("test", REPO, 10);
		expect(all.length).toBe(2);
	});

	it("should BULK handle mixed create, update, and acknowledge operations", async () => {
		// First, create a memory to update and acknowledge
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Bulk Target",
				content: "Target memory for bulk update and acknowledge.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const targetId = createRes.structuredContent.id;

		const bulkRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				owner: "test",
				repo: REPO,
				memories: [
					// CREATE
					{
						type: "code_fact",
						title: "New Bulk Item C",
						content: "A fresh memory created in the bulk operation.",
						importance: 2,
						agent: "test-agent",
						model: "test-model"
					},
					// UPDATE
					{
						id: targetId,
						title: "Updated By Bulk",
						importance: 5
					},
					// ACKNOWLEDGE
					{
						id: targetId,
						acknowledge: "used"
					}
				]
			}
		});

		expect(bulkRes.structuredContent.success).toBe(true);
		expect(bulkRes.structuredContent.total).toBe(3);
		expect(bulkRes.structuredContent.processed).toBe(3);

		const updated = db.memories.getById(targetId);
		expect(updated!.title).toBe("Updated By Bulk");
		expect(updated!.importance).toBe(5);
		expect(updated!.recall_count).toBe(1);
	});

	it("should BULK handle partial failure — continue on individual item errors", async () => {
		const bulkRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				owner: "test",
				repo: REPO,
				memories: [
					// Valid create
					{
						type: "code_fact",
						title: "Valid Memory",
						content: "This memory should be created successfully.",
						importance: 3,
						agent: "test-agent",
						model: "test-model"
					},
					// Invalid — missing required fields
					{
						type: "code_fact"
					}
				]
			}
		});

		expect(bulkRes.isError).toBe(true);
		expect(bulkRes.structuredContent).toMatchObject({ schema: "tool-error", code: "PARTIAL_FAILURE" });
		expect(bulkRes.structuredContent.success).toBe(false);
		expect(bulkRes.structuredContent.total).toBe(2);
		expect(bulkRes.structuredContent.processed).toBe(1);
		expect(bulkRes.structuredContent.errors).toHaveLength(1);
		expect(bulkRes.structuredContent.errors[0].index).toBe(1);
		expect(getPrimaryTextContent(bulkRes)).toContain("1/2");
	});
});

// ─── Decision fields (context/rationale/alternatives) — flat, replaces old decision_log ──

describe("decision flat fields in memory-write", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: Record<string, unknown>) => Promise<any>;

	const REPO = "memory-write-test";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
		const rawRouter = createRouter(db, vectors);
		router = async (method, params) => {
			const args = (params as Record<string, unknown>)?.arguments as Record<string, unknown> | undefined;
			if (method === "tools/call" && args) {
				args.json = true;
			}
			return rawRouter(method, params);
		};
	});

	it("should auto-format content and set importance=4 when context/rationale provided with type=decision", async () => {
		const res = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "decision",
				title: "Choose Database",
				context: "We needed to pick a primary database for the new service.",
				rationale: "Postgres offers better JSON support and is more battle-tested for this workload.",
				tags: ["backend"],
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});

		expect(res.structuredContent.success).toBe(true);
		expect(res.structuredContent.type).toBe("decision");
		expect(res.structuredContent.importance).toBe(4);
		expect(res.structuredContent.title).toBe("Choose Database");

		// Content should have been auto-generated from context/rationale fields
		const stored = db.memories.getById(res.structuredContent.id);
		expect(stored?.content).toContain("## Context");
		expect(stored?.content).toContain("We needed to pick");
		expect(stored?.content).toContain("## Rationale");
		expect(stored?.content).toContain("Postgres offers better");
		expect(stored?.tags).toContain("decision");
	});

	it("should throw error if context/rationale provided without type=decision", async () => {
		const res = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Wrong Type",
				context: "This should not work.",
				rationale: "Because type is code_fact, not decision.",
				scope: { owner: "test", repo: REPO }
			}
		});
		expect(res.isError).toBe(true);
		expect(getPrimaryTextContent(res)).toMatch(/type.*decision/i);
	});

	it("should include alternatives in auto-generated content", async () => {
		const res = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "decision",
				title: "Framework Choice",
				context: "Evaluating frontend frameworks for the dashboard.",
				rationale: "React has the largest ecosystem and best tooling.",
				alternatives: ["Vue", "Svelte", "Solid"],
				tags: ["frontend", "architecture"],
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});

		expect(res.structuredContent.success).toBe(true);
		const stored = db.memories.getById(res.structuredContent.id);
		expect(stored?.content).toContain("## Alternatives");
		expect(stored?.content).toContain("- Vue");
		expect(stored?.content).toContain("- Svelte");
		expect(stored?.content).toContain("- Solid");
		expect(stored?.tags).toEqual(expect.arrayContaining(["decision", "frontend", "architecture"]));
	});
});

// ─── Session fields (key_decisions/next_steps) — flat, replaces old session_summary ──

describe("session flat fields in memory-write", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: Record<string, unknown>) => Promise<any>;

	const REPO = "memory-write-test";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
		const rawRouter = createRouter(db, vectors);
		router = async (method, params) => {
			const args = (params as Record<string, unknown>)?.arguments as Record<string, unknown> | undefined;
			if (method === "tools/call" && args) {
				args.json = true;
			}
			return rawRouter(method, params);
		};
	});

	it("should auto-format content when key_decisions/next_steps provided with type=task_archive", async () => {
		const res = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "task_archive",
				title: "Auth Refactor Session",
				key_decisions: ["Use JWT for tokens", "Extract auth to a service class"],
				next_steps: ["Add refresh token rotation", "Write integration tests"],
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});

		expect(res.structuredContent.success).toBe(true);
		expect(res.structuredContent.type).toBe("task_archive");

		const stored = db.memories.getById(res.structuredContent.id);
		expect(stored?.content).toContain("## Key Decisions");
		expect(stored?.content).toContain("Use JWT for tokens");
		expect(stored?.content).toContain("## Next Steps");
		expect(stored?.content).toContain("Add refresh token rotation");
		expect(stored?.tags).toContain("session-summary");
	});

	it("should throw error if key_decisions/next_steps provided without type=task_archive", async () => {
		const res = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Wrong Type",
				key_decisions: ["This should not work."],
				scope: { owner: "test", repo: REPO }
			}
		});
		expect(res.isError).toBe(true);
		expect(getPrimaryTextContent(res)).toMatch(/type.*task_archive/i);
	});
});
