import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";
import { getPrimaryTextContent } from "../utils/mcp-response";

describe("MCP Local Memory - memory-read (Search, Detail, Recap)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: Record<string, unknown>) => Promise<any>;

	const REPO = "memory-read-test";

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

	// ─── SEARCH mode ─────────────────────────────────────────────────────

	it("should SEARCH memories by query via memory-read", async () => {
		await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Search Target Alpha",
				content: "Alpha memory that should appear in search results.",
				importance: 4,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Search Target Beta",
				content: "Beta memory about something else entirely.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});

		const searchRes = await router("tools/call", {
			name: "memory-read",
			arguments: {
				query: "Alpha",
				owner: "test",
				repo: REPO,
				limit: 10
			}
		});

		const results = searchRes.structuredContent;
		expect(results.columns).toEqual(["id", "code", "title", "type", "importance", "acknowledged"]);
		expect(results.count).toBeGreaterThanOrEqual(1);
		expect(results.rows.some((r: string[]) => r[2] === "Search Target Alpha")).toBe(true);
	});

	it("should SEARCH with current_tags for affinity boost", async () => {
		await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "pattern",
				title: "Tagged Pattern",
				content: "Memory tagged with filament and laravel.",
				importance: 4,
				tags: ["filament", "laravel"],
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});

		const searchRes = await router("tools/call", {
			name: "memory-read",
			arguments: {
				query: "pattern",
				owner: "test",
				repo: REPO,
				current_tags: ["filament"],
				limit: 10
			}
		});

		const results = searchRes.structuredContent;
		expect(results.count).toBeGreaterThanOrEqual(1);
	});

	it("should SEARCH with current_file_path for workspace grounding", async () => {
		await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Auth Specific Rule",
				content: "Auth module requires PII masking in logs.",
				importance: 5,
				scope: { owner: "test", repo: REPO, folder: "src/auth" },
				agent: "test-agent",
				model: "test-model"
			}
		});

		const searchRes = await router("tools/call", {
			name: "memory-read",
			arguments: {
				query: "logging",
				owner: "test",
				repo: REPO,
				current_file_path: "src/auth/services/ldap/provider.ts",
				limit: 10
			}
		});

		const results = searchRes.structuredContent;
		expect(results.count).toBeGreaterThanOrEqual(1);
	});

	it("should return empty results when query matches nothing", async () => {
		const searchRes = await router("tools/call", {
			name: "memory-read",
			arguments: {
				query: "zzzzzznonexistent",
				owner: "test",
				repo: REPO,
				limit: 5
			}
		});

		const results = searchRes.structuredContent;
		expect(results.count).toBe(0);
		expect(results.rows).toHaveLength(0);
	});

	// ─── DETAIL mode ─────────────────────────────────────────────────────

	it("should get DETAIL by id via memory-read", async () => {
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Detail By Id",
				content: "Fetch this memory by its unique identifier.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const memoryId = createRes.structuredContent.id;

		const detailRes = await router("tools/call", {
			name: "memory-read",
			arguments: {
				id: memoryId,
				owner: "test",
				repo: REPO
			}
		});

		const memory = detailRes.structuredContent.memory;
		expect(memory.id).toBe(memoryId);
		expect(memory.title).toBe("Detail By Id");
		expect(memory.content).toBe("Fetch this memory by its unique identifier.");
	});

	it("should get DETAIL by code via memory-read", async () => {
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "decision",
				title: "Detail By Code",
				content: "Fetch this memory by its code.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const memoryCode = createRes.structuredContent.code;

		const detailRes = await router("tools/call", {
			name: "memory-read",
			arguments: {
				code: memoryCode,
				owner: "test",
				repo: REPO
			}
		});

		const memory = detailRes.structuredContent.memory;
		expect(memory.code).toBe(memoryCode);
		expect(memory.title).toBe("Detail By Code");
	});

	it("should get DETAIL bulk by ids[] via memory-read", async () => {
		const m1 = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Bulk Detail A",
				content: "Redis cache strategy for API response layer.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const m2 = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Bulk Detail B",
				content: "PostgreSQL query optimization for reporting queries.",
				importance: 4,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});

		const detailRes = await router("tools/call", {
			name: "memory-read",
			arguments: {
				ids: [m1.structuredContent.id, m2.structuredContent.id],
				owner: "test",
				repo: REPO
			}
		});

		expect(detailRes.structuredContent.memories).toHaveLength(2);
		expect(getPrimaryTextContent(detailRes)).toContain("Bulk detail — 2");
	});

	it("should get DETAIL bulk by codes[] via memory-read", async () => {
		const m1 = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Bulk Code Detail A",
				content: "Elasticsearch index mapping configuration.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const m2 = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Bulk Code Detail B",
				content: "Docker Compose multi-stage build setup.",
				importance: 4,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});

		const detailRes = await router("tools/call", {
			name: "memory-read",
			arguments: {
				codes: [m1.structuredContent.code, m2.structuredContent.code],
				owner: "test",
				repo: REPO
			}
		});

		expect(detailRes.structuredContent.memories).toHaveLength(2);
		expect(getPrimaryTextContent(detailRes)).toContain("Bulk detail — 2");
	});

	it("should return isError envelope for DETAIL of non-existent memory", async () => {
		const fakeId = "00000000-0000-0000-0000-000000000000";
		const res = await router("tools/call", {
			name: "memory-read",
			arguments: {
				id: fakeId,
				owner: "test",
				repo: REPO
			}
		});
		expect(res.isError).toBe(true);
		expect(getPrimaryTextContent(res)).toContain("Memory not found");
	});

	// ─── RECAP mode ──────────────────────────────────────────────────────

	it("should return RECAP (stats + top memories) when no query/id/code provided", async () => {
		await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Recap Memory Alpha",
				content: "Memory that should appear in recap stats.",
				importance: 5,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});

		const recapRes = await router("tools/call", {
			name: "memory-read",
			arguments: {
				owner: "test",
				repo: REPO,
				limit: 10
			}
		});

		const content = recapRes.structuredContent;
		expect(content.stats).toBeDefined();
		expect(content.stats.byType).toBeDefined();
		expect(content.top).toBeDefined();
		expect(content.top.columns).toEqual(["id", "code", "title", "type", "importance", "acknowledged"]);
		expect(content.total).toBeGreaterThanOrEqual(1);
	});

	it("should RECAP respect limit/offset pagination", async () => {
		for (let i = 1; i <= 5; i++) {
			await router("tools/call", {
				name: "memory-write",
				arguments: {
					type: "code_fact",
					title: `Recap Item ${i}`,
					content: `Memory number ${i} for pagination test.`,
					importance: 3,
					scope: { owner: "test", repo: REPO },
					agent: "test-agent",
					model: "test-model"
				}
			});
		}

		const recapRes = await router("tools/call", {
			name: "memory-read",
			arguments: {
				owner: "test",
				repo: REPO,
				limit: 2,
				offset: 0
			}
		});

		const content = recapRes.structuredContent;
		expect(content.top.rows.length).toBeLessThanOrEqual(2);
		expect(content.count).toBeLessThanOrEqual(2);
	});

	it("should return helpful message for RECAP on empty repo", async () => {
		const recapRes = await router("tools/call", {
			name: "memory-read",
			arguments: {
				owner: "test",
				repo: "empty-repo",
				limit: 5
			}
		});

		expect(getPrimaryTextContent(recapRes)).toContain("No memories found");
	});

	// ─── Mode auto-inference ─────────────────────────────────────────────

	it("should auto-infer SEARCH when query is present", async () => {
		const res = await router("tools/call", {
			name: "memory-read",
			arguments: {
				query: "anything",
				owner: "test",
				repo: REPO
			}
		});

		// Search returns pointer table with columns/rows
		expect(res.structuredContent.columns).toBeDefined();
	});

	it("should auto-infer DETAIL when id is present", async () => {
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Mode Inference",
				content: "Testing mode auto-inference in memory-read.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const memId = createRes.structuredContent.id;

		const res = await router("tools/call", {
			name: "memory-read",
			arguments: {
				id: memId,
				owner: "test",
				repo: REPO
			}
		});

		expect(res.structuredContent.memory).toBeDefined();
	});

	it("should auto-infer DETAIL when code is present alongside an empty query", async () => {
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Empty Query Detail",
				content: "Regression: an empty query must not hijack detail mode.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const memoryCode = createRes.structuredContent.code;

		const res = await router("tools/call", {
			name: "memory-read",
			arguments: { query: "", code: memoryCode, owner: "test", repo: REPO }
		});

		expect(res.isError).toBeFalsy();
		expect(res.structuredContent.memory).toBeDefined();
		expect(res.structuredContent.memory.code).toBe(memoryCode);
	});

	it("should auto-infer RECAP when only empty-string discriminators are sent", async () => {
		const res = await router("tools/call", {
			name: "memory-read",
			arguments: { query: "", id: "", code: "", owner: "test", repo: REPO }
		});

		expect(res.isError).toBeFalsy();
		expect(res.structuredContent.stats).toBeDefined();
		expect(res.structuredContent.columns).toBeUndefined();
	});

	it("should auto-infer RECAP when no query/id/code/ids/codes present", async () => {
		const res = await router("tools/call", {
			name: "memory-read",
			arguments: {
				owner: "test",
				repo: REPO
			}
		});

		expect(res.structuredContent.stats).toBeDefined();
	});
});
