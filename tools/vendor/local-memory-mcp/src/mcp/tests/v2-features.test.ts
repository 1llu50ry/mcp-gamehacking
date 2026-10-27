import { describe, it, expect, vi } from "vitest";
import { createTestStore } from "../storage/sqlite";
import { handleMemoryWrite } from "../tools/memory.write";
import { handleMemoryRead } from "../tools/memory.read";
import { getPrimaryTextContent } from "../utils/mcp-response";
import type { MemoryEntry, VectorStore } from "../types";

const VALID_UUID_1 = "11111111-1111-4111-a111-111111111111";
const VALID_UUID_2 = "22222222-2222-4222-a222-222222222222";

const mockVectors: VectorStore = {
	upsert: vi.fn().mockResolvedValue(undefined),
	remove: vi.fn().mockResolvedValue(undefined),
	search: vi.fn().mockResolvedValue([])
};

function makeEntry(overrides: Partial<MemoryEntry> & { repo?: string }): MemoryEntry {
	return {
		id: overrides.id || VALID_UUID_1,
		type: overrides.type || "decision",
		title: overrides.title || "Test Title",
		content: overrides.content || "Test content for memory",
		importance: overrides.importance || 3,
		agent: overrides.agent || "test-agent",
		role: "unknown",
		model: overrides.model || "test-model",
		scope: { owner: "test", repo: overrides.repo || "test-repo" },
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		completed_at: null,
		hit_count: 0,
		recall_count: 0,
		last_used_at: null,
		expires_at: null,
		supersedes: overrides.supersedes || null,
		status: overrides.status || "active",
		tags: overrides.tags || [],
		metadata: overrides.metadata || {},
		is_global: overrides.is_global || false
	};
}

describe("V2 Enhanced Memory Features", () => {
	describe("1. Conflict Detection & Supersedes", () => {
		it("should reject legacy file_claim coordination memories", async () => {
			const db = await createTestStore();
			const repo = "file-claim-repo";

			await expect(
				handleMemoryWrite(
					{
						type: "file_claim",
						title: "Claim ownership of migration file",
						content: "Agent A is working on src/storage/sqlite.ts migration changes.",
						importance: 4,
						scope: { owner: "test", repo },
						agent: "test-agent",
						model: "test-model",
						json: true
					},
					db,
					mockVectors
				)
			).rejects.toThrow();
			db.close();
		});

		it("should store structured metadata on memories", async () => {
			const db = await createTestStore();
			const repo = "metadata-repo";

			const response = await handleMemoryWrite(
				{
					type: "decision",
					title: "JSON:API response standard restored",
					content: "Responses must use the JSON:API envelope for consistency.",
					importance: 4,
					scope: { owner: "test", repo },
					agent: "codex",
					role: "rules-optimizer",
					model: "gpt-5.4",
					metadata: {
						source_agent: "codex",
						source_role: "rules-optimizer",
						source_timestamp: "2026-04-03T00:00:00.000Z"
					},
					json: true
				},
				db,
				mockVectors
			);

			const stored = db.memories.getById((response.structuredContent as Record<string, unknown>).id as string);
			expect(stored?.metadata).toEqual({
				source_agent: "codex",
				source_role: "rules-optimizer",
				source_timestamp: "2026-04-03T00:00:00.000Z"
			});
			db.close();
		});

		it("should reject titles that look like embedded metadata", async () => {
			const db = await createTestStore();

			await expect(
				handleMemoryWrite(
					{
						type: "decision",
						title: "[agent: codex | role: rules-optimizer | 2026-04-03] JSON:API response standard restored",
						content: "Responses must use the JSON:API envelope for consistency.",
						importance: 4,
						scope: { owner: "test", repo: "metadata-guard-repo" },
						agent: "codex",
						role: "rules-optimizer",
						model: "gpt-5.4"
					},
					db,
					mockVectors
				)
			).rejects.toThrow("Title appears to contain metadata");

			db.close();
		});

		it("should reject a new memory if a similar one exists (>0.85) and no supersedes is provided", async () => {
			const db = await createTestStore();
			const repo = "conflict-repo";
			db.memories.insert(makeEntry({ id: VALID_UUID_1, repo, content: "React frontend" }));

			mockVectors.search = vi.fn().mockResolvedValue([{ id: VALID_UUID_1, score: 0.9 }]);

			const params = {
				type: "decision",
				title: "Conflict Test",
				content: "React frontend again",
				importance: 5,
				scope: { owner: "test", repo },
				agent: "test-agent",
				model: "test-model"
			};

			const response = await handleMemoryWrite(params, db, mockVectors);
			expect(getPrimaryTextContent(response)).toContain("conflict");
			db.close();
		});

		it("should archive old memory when superseded", async () => {
			const db = await createTestStore();
			const repo = "supersede-repo";
			db.memories.insert(makeEntry({ id: VALID_UUID_1, repo }));

			const params = {
				type: "decision",
				title: "New One",
				content: "Better content",
				importance: 5,
				scope: { owner: "test", repo },
				agent: "test-agent",
				model: "test-model",
				supersedes: VALID_UUID_1
			};

			await handleMemoryWrite(params, db, mockVectors);

			const old = db.memories.getById(VALID_UUID_1);
			expect(old?.status).toBe("archived");
			db.close();
		});
	});

	describe("2. Strict Search Threshold (0.72)", () => {
		it("should filter out results using dynamic threshold", async () => {
			const db = await createTestStore();
			const repo = "threshold-repo";
			db.memories.insert(makeEntry({ id: VALID_UUID_1, repo, content: "Target" }));
			db.memories.insert(makeEntry({ id: VALID_UUID_2, repo, content: "Noisy" }));

			// Adding more memories to force a stricter threshold (> 5 memories)
			for (let i = 0; i < 5; i++) {
				db.memories.insert(
					makeEntry({ id: `00000000-0000-4000-a000-00000000000${i + 3}`, repo, content: "Irrelevant" })
				);
			}

			mockVectors.search = vi.fn().mockResolvedValue([
				{ id: VALID_UUID_1, score: 0.8 },
				{ id: VALID_UUID_2, score: 0.2 }, // Should be filtered out if threshold is high
				{ id: "00000000-0000-4000-a000-000000000003", score: 0.1 }
			]);

			const params = { query: "Target", owner: "test", repo, json: true };
			const response = await handleMemoryRead(params, db, mockVectors);

			// Pointer table format
			const results = response.structuredContent as Record<string, unknown>;
			expect(results.count).toBe(1);
			expect(getPrimaryTextContent(response)).toContain("Use memory-read with id (or code) for full content.");
			db.close();
		});
	});

	describe("3. Vector Error Fallback", () => {
		it("should handle vector search failure gracefully by falling back to similarity only", async () => {
			const db = await createTestStore();
			const repo = "error-test-repo";

			db.memories.insert(makeEntry({ id: VALID_UUID_1, repo, content: "Test content", importance: 5 }));

			const errorMockVectors = {
				upsert: vi.fn().mockResolvedValue(undefined),
				remove: vi.fn().mockResolvedValue(undefined),
				search: vi.fn().mockRejectedValue(new Error("Vector store connection failed"))
			};

			const params = { query: "Test", owner: "test", repo, json: true };
			const response = await handleMemoryRead(params, db, errorMockVectors);

			// Should fallback to similarity and still return results
			const results = response.structuredContent as Record<string, unknown>;
			expect(results.count).toBe(1);
			expect(getPrimaryTextContent(response)).toContain("Use memory-read with id (or code) for full content.");
			db.close();
		});
	});

	describe("4. Feedback Loop", () => {
		it("should reject updating memory type to file_claim", async () => {
			const db = await createTestStore();
			db.memories.insert(makeEntry({ id: VALID_UUID_1, type: "decision" }));

			await expect(
				handleMemoryWrite(
					{
						id: VALID_UUID_1,
						owner: "test",
						repo: "test-repo",
						type: "file_claim"
					},
					db,
					mockVectors
				)
			).rejects.toThrow();

			const updated = db.memories.getById(VALID_UUID_1);
			expect(updated?.type).toBe("decision");
			db.close();
		});

		it("should allow updating memory metadata", async () => {
			const db = await createTestStore();
			db.memories.insert(makeEntry({ id: VALID_UUID_1, metadata: { source_agent: "old-agent" } }));

			await handleMemoryWrite(
				{
					id: VALID_UUID_1,
					owner: "test",
					repo: "test-repo",
					metadata: {
						source_agent: "codex",
						source_role: "rules-optimizer"
					}
				},
				db,
				mockVectors
			);

			const updated = db.memories.getById(VALID_UUID_1);
			expect(updated?.metadata).toEqual({
				source_agent: "codex",
				source_role: "rules-optimizer"
			});
			db.close();
		});

		it("should reject metadata-like titles on update", async () => {
			const db = await createTestStore();
			db.memories.insert(makeEntry({ id: VALID_UUID_1, title: "Clean title" }));

			await expect(
				handleMemoryWrite(
					{
						id: VALID_UUID_1,
						owner: "test",
						repo: "test-repo",
						title: "[agent: codex | role: rules-optimizer | 2026-04-03] Noisy title"
					},
					db,
					mockVectors
				)
			).rejects.toThrow("Title appears to contain metadata");

			db.close();
		});

		it("should increment recall_count on 'used'", async () => {
			const db = await createTestStore();
			db.memories.insert(makeEntry({ id: VALID_UUID_1 }));

			await handleMemoryWrite(
				{
					id: VALID_UUID_1,
					owner: "test",
					repo: "test-repo",
					acknowledge: "used"
				},
				db,
				mockVectors
			);

			const updated = db.memories.getById(VALID_UUID_1);
			expect(updated?.recall_count).toBe(1);
			db.close();
		});
	});

	describe("5. VALID_COLUMNS Whitelist", () => {
		it("should correctly whitelist valid columns, reject invalid columns, and handle scope", async () => {
			const db = await createTestStore();
			const repo = "whitelist-test-repo";
			db.memories.insert(makeEntry({ id: VALID_UUID_1, repo, title: "Original Title", type: "decision" }));

			db.memories.update(VALID_UUID_1, {
				title: "New Title",
				status: "archived",
				id: "should-be-rejected-id",
				created_at: "should-be-rejected-date",
				invalid_column: "should-be-rejected",
				scope: { repo: "new-repo", folder: "new-folder", language: "typescript" }
			} as any);

			const updated = db.memories.getById(VALID_UUID_1);
			expect(updated).toBeDefined();
			expect(updated?.title).toBe("New Title");
			expect(updated?.status).toBe("archived");
			expect(updated?.id).toBe(VALID_UUID_1);
			expect(updated?.created_at).not.toBe("should-be-rejected-date");
			expect((updated as any).invalid_column).toBeUndefined();
			expect(updated?.scope.repo).toBe("new-repo");
			expect(updated?.scope.folder).toBe("new-folder");
			expect(updated?.scope.language).toBe("typescript");

			db.memories.bulkUpdateMemories([VALID_UUID_1], {
				importance: 5,
				id: "bulk-rejected-id",
				scope: { folder: "bulk-folder" }
			} as any);

			const bulkUpdated = db.memories.getById(VALID_UUID_1);
			expect(bulkUpdated?.importance).toBe(5);
			expect(bulkUpdated?.id).toBe(VALID_UUID_1);
			expect(bulkUpdated?.scope.folder).toBe("bulk-folder");

			db.close();
		});
	});
});
