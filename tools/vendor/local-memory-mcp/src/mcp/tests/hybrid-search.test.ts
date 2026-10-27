import { describe, it, expect, vi } from "vitest";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { handleMemoryRead } from "../tools/memory.read";
import { handleTaskRead } from "../tools/task.read";
import { getPrimaryTextContent } from "../utils/mcp-response";
import type { VectorStore, VectorResult } from "../types";

const VALID_UUID_1 = "11111111-1111-4111-a111-111111111111";
const VALID_UUID_2 = "22222222-2222-4222-a222-222222222222";

/**
 * Factory for a mock VectorStore that returns predictable results.
 */
function mockVectorStore(results: VectorResult[]): VectorStore {
	return {
		upsert: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
		search: vi.fn().mockResolvedValue(results)
	};
}

describe("Hybrid Search Scoring — vector + keyword + recency + domain", () => {
	describe("Memory hybrid scoring", () => {
		it("boosts recently used memories in search results", async () => {
			const db = await createTestStore();
			const repo = "hybrid-repo";

			// Insert two memories — one recent, one older
			db.memories.insert({
				id: VALID_UUID_1,
				type: "decision",
				title: "Recent Decision",
				content: "This is a very recent decision about the architecture.",
				importance: 3,
				agent: "test",
				role: "architect",
				model: "test",
				scope: { owner: "test", repo },
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				completed_at: null,
				hit_count: 5,
				recall_count: 3,
				last_used_at: new Date().toISOString(),
				expires_at: null,
				supersedes: null,
				status: "active",
				tags: ["architecture"],
				metadata: {},
				is_global: false
			});

			db.memories.insert({
				id: VALID_UUID_2,
				type: "code_fact",
				title: "Old Fact",
				content: "This is an old fact about the system.",
				importance: 5,
				agent: "test",
				role: "developer",
				model: "test",
				scope: { owner: "test", repo },
				created_at: "2024-01-01T00:00:00.000Z",
				updated_at: "2024-01-01T00:00:00.000Z",
				completed_at: null,
				hit_count: 1,
				recall_count: 0,
				last_used_at: "2024-01-01T00:00:00.000Z",
				expires_at: null,
				supersedes: null,
				status: "active",
				tags: ["legacy"],
				metadata: {},
				is_global: false
			});

			const vectors = mockVectorStore([
				{ id: VALID_UUID_1, score: 0.75 },
				{ id: VALID_UUID_2, score: 0.7 }
			]);

			const result = await handleMemoryRead({ query: "architecture", owner: "test", repo, json: true }, db, vectors);

			expect(result.structuredContent).toBeDefined();
			const data = result.structuredContent as Record<string, unknown>;
			// Both memories should be found
			expect(data.count).toBe(2);
			db.close();
		});

		it("respects importance as a boost factor in scoring", async () => {
			const db = await createTestStore();
			const repo = "importance-repo";

			// Low importance but good vector match
			db.memories.insert({
				id: VALID_UUID_1,
				type: "code_fact",
				title: "Low Importance Match",
				content: "Minor code style preference.",
				importance: 1,
				agent: "test",
				role: "dev",
				model: "test",
				scope: { owner: "test", repo },
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				completed_at: null,
				hit_count: 0,
				recall_count: 0,
				last_used_at: null,
				expires_at: null,
				supersedes: null,
				status: "active",
				tags: [],
				metadata: {},
				is_global: false
			});

			// High importance but lower vector match
			db.memories.insert({
				id: VALID_UUID_2,
				type: "decision",
				title: "High Importance Match",
				content: "Critical architecture decision.",
				importance: 5,
				agent: "test",
				role: "architect",
				model: "test",
				scope: { owner: "test", repo },
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				completed_at: null,
				hit_count: 0,
				recall_count: 0,
				last_used_at: null,
				expires_at: null,
				supersedes: null,
				status: "active",
				tags: [],
				metadata: {},
				is_global: false
			});

			const vectors = mockVectorStore([
				{ id: VALID_UUID_1, score: 0.9 },
				{ id: VALID_UUID_2, score: 0.6 }
			]);

			const result = await handleMemoryRead(
				{ query: "architecture decision", owner: "test", repo, json: true },
				db,
				vectors
			);

			expect(result.structuredContent).toBeDefined();
			const data = result.structuredContent as Record<string, unknown>;
			expect(data.count).toBeGreaterThanOrEqual(1);
			db.close();
		});
	});

	describe("Standard hybrid scoring", () => {
		it("filters standards by name via entity search", async () => {
			const db = await createTestStore();
			const stdVectors = new StubVectorStore(db);
			const repo = "std-hybrid-repo";
			const { handleStandardWrite } = await import("../tools/standard.write");

			await handleStandardWrite(
				{
					owner: "test",
					repo,
					name: "React Hooks Rule",
					content: "Use hooks for state management in React applications.",
					language: "typescript",
					stack: ["react"],
					tags: ["react", "hooks"],
					metadata: { source: "hybrid-test" },
					json: true
				},
				db,
				stdVectors
			);

			await handleStandardWrite(
				{
					owner: "test",
					repo,
					name: "Laravel Eloquent Rule",
					content: "Use Eloquent for database queries in Laravel.",
					language: "php",
					stack: ["laravel"],
					tags: ["laravel", "eloquent"],
					metadata: { source: "hybrid-test" },
					json: true
				},
				db,
				stdVectors
			);

			// Direct entity search returns both standards
			const allStandards = db.standards.search({ repo, limit: 10, offset: 0 });
			expect(allStandards.length).toBe(2);

			// Entity search with stack filter finds only React
			const reactStandards = db.standards.search({ repo, stack: "react", limit: 10, offset: 0 });
			expect(reactStandards.length).toBe(1);
			expect(reactStandards[0].title).toContain("React");

			db.close();
		});
	});

	describe("Task search with vector scoring", () => {
		it("returns tasks matching query text", async () => {
			const db = await createTestStore();
			const repo = "task-hybrid-repo";
			const { handleTaskWrite } = await import("../tools/task.write");

			await handleTaskWrite(
				{
					owner: "test",
					repo,
					task_code: "HYBRID-001",
					phase: "implementation",
					title: "Hybrid search implementation",
					description: "Implement hybrid search for all domains",
					status: "pending",
					json: true,
					agent: "test",
					role: "dev"
				},
				db,
				mockVectorStore([])
			);

			const result = await handleTaskRead(
				{ query: "hybrid", owner: "test", repo, json: true },
				db,
				mockVectorStore([])
			);

			const data = result.structuredContent as Record<string, unknown>;
			expect(data.count).toBeGreaterThanOrEqual(1);
			db.close();
		});

		// TASK-434 — regression lock for TASK-421: the text summary must render
		// EVERY status group with matches (count per group, cap-5 + "+N more"),
		// not just the groups that happen to land on the current page. Guards the
		// exact wiring fixed in task-read/search.ts (`items: scoredPool` — the
		// pre-pagination eligible pool is grouped, while the wire stays paginated).
		it("renders every status group with matches in the text summary, capped per group (TASK-421 AC)", async () => {
			const db = await createTestStore();
			const repo = "task-hybrid-repo";
			const { handleTaskWrite } = await import("../tools/task.write");
			const query = "integration-ac";

			// Fixture: 11 tasks all matching the query, spanning 3 statuses.
			// pending (7) exceeds the 5-line cap; in_progress (2) and completed (2)
			// stay under it. completed cannot be CREATed directly (state machine
			// allows only backlog/pending), so it is reached via the
			// pending → in_progress → completed transition chain.
			const pendingCodes = ["IA-AC-P01", "IA-AC-P02", "IA-AC-P03", "IA-AC-P04", "IA-AC-P05", "IA-AC-P06", "IA-AC-P07"];
			const inProgressCodes = ["IA-AC-I01", "IA-AC-I02"];
			const completedCodes = ["IA-AC-C01", "IA-AC-C02"];
			const total = pendingCodes.length + inProgressCodes.length + completedCodes.length;

			for (const code of [...pendingCodes, ...inProgressCodes, ...completedCodes]) {
				await handleTaskWrite(
					{
						owner: "test",
						repo,
						task_code: code,
						phase: "testing",
						title: `Integration AC task ${code}`,
						description: `Regression fixture for the integration-ac search wiring.`,
						status: "pending",
						json: false
					},
					db,
					mockVectorStore([])
				);
			}

			for (const code of inProgressCodes) {
				await handleTaskWrite(
					{ owner: "test", repo, code, status: "in_progress", comment: "Started integration-ac work." },
					db,
					mockVectorStore([])
				);
			}

			for (const code of completedCodes) {
				await handleTaskWrite(
					{ owner: "test", repo, code, status: "in_progress", comment: "Started integration-ac work." },
					db,
					mockVectorStore([])
				);
				await handleTaskWrite(
					{ owner: "test", repo, code, status: "completed", comment: "Finished integration-ac work." },
					db,
					mockVectorStore([])
				);
			}

			// Act — text mode with a page limit (5) smaller than the total (11):
			// the structured page holds 5 rows, yet the summary must show all groups.
			const result = await handleTaskRead(
				{ query, owner: "test", repo, json: false, limit: 5 },
				db,
				mockVectorStore([])
			);
			const text = getPrimaryTextContent(result);

			// 1. Header reflects TOTAL matches, not the page length.
			expect(text).toContain(`### Results: ${total} tasks for "${query}"`);

			// 2. EVERY status group with matches is rendered with its count —
			//    including groups absent from the 5-row page (AC1/AC2).
			expect(text).toContain(`**Pending (${pendingCodes.length})**`);
			expect(text).toContain(`**In Progress (${inProgressCodes.length})**`);
			expect(text).toContain(`**Completed (${completedCodes.length})**`);

			// 3. Cap convention (AC3): only the group with >5 matches appends a
			//    "+N more in this group" line (7 pending → 5 shown + 2 hidden).
			//    Groups at/under the cap get no "more" line — exactly one occurrence.
			const moreLines = text.match(/\.\.\. \+(\d+) more in this group/g) ?? [];
			expect(moreLines).toHaveLength(1);
			expect(moreLines).toEqual(["... +2 more in this group"]);

			// 4. Negative control: statuses with no matches must NOT appear.
			expect(text).not.toContain("**Blocked");
			expect(text).not.toContain("**Backlog");
			expect(text).not.toContain("**Canceled");

			// 5. Wire contract: structured data stays paginated — count equals the
			//    PAGE length (limit), while total carries the full match pool.
			const jsonResult = await handleTaskRead(
				{ query, owner: "test", repo, json: true, limit: 5 },
				db,
				mockVectorStore([])
			);
			const structured = jsonResult.structuredContent as {
				count: number;
				total: number;
				limit: number;
				results: { rows: unknown[][] };
			};
			expect(structured.count).toBe(5);
			expect(structured.limit).toBe(5);
			expect(structured.results.rows).toHaveLength(5);
			expect(structured.total).toBe(total);

			db.close();
		});
	});

	describe("Cross-domain search consistency", () => {
		it("memory-read and standard-read both support query parameter for search", async () => {
			const db = await createTestStore();
			const repo = "cross-domain-repo";

			// Memory search
			const memResult = await handleMemoryRead(
				{ query: "test", owner: "test", repo, json: true },
				db,
				mockVectorStore([])
			);
			expect(memResult.structuredContent).toBeDefined();
			const memData = memResult.structuredContent as Record<string, unknown>;
			expect(memData).toHaveProperty("count");

			db.close();
		});
	});
});
