import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { MemoryEntry, VectorStore } from "../types";

// ─── MemoryScope.branch — write→read round-trip and memory-read boost ────────
// Split out from memory.read.test.ts (TASK-440) to keep that file within the
// 500-line maintainability limit. Setup mirrors the original describe:
// createTestStore + StubVectorStore + json:true router wrapper.

describe("MemoryScope.branch — write→read round-trip and memory-read boost", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: Record<string, unknown>) => Promise<any>;

	const REPO = "branch-roundtrip-repo";

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

	const writeMemory = async (title: string, content: string, branch: string, importance = 3) => {
		const res = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title,
				content,
				importance,
				scope: { owner: "test", repo: REPO, branch },
				agent: "test-agent",
				model: "test-model"
			}
		});
		return res.structuredContent as { id: string; code: string };
	};

	it("persists scope.branch through memory-write and returns it via memory-read detail", async () => {
		const written = await writeMemory("Branch Roundtrip", "memory content for branch round trip", "feat/auth");

		const detailRes = await router("tools/call", {
			name: "memory-read",
			arguments: {
				id: written.id,
				owner: "test",
				repo: REPO
			}
		});

		const memory = detailRes.structuredContent.memory;
		expect(memory.id).toBe(written.id);
		expect(memory.scope.branch).toBe("feat/auth");
	});

	it("persists scope.branch via MemoryEntity.update (single update path)", async () => {
		const written = await writeMemory("Branch Update", "memory content for branch update path", "feat/old");

		db.memories.update(written.id, { scope: { owner: "test", repo: REPO, branch: "feat/new" } });

		const stored = db.memories.getById(written.id);
		expect(stored?.scope.branch).toBe("feat/new");
	});

	it("persists scope.branch via bulkInsertMemories and bulkUpdateMemories", async () => {
		const now = new Date().toISOString();
		const makeEntry = (id: string, branch?: string): MemoryEntry => ({
			id,
			code: `BR-${id}`,
			type: "code_fact",
			title: "Bulk branch entry",
			content: "bulk branch round trip content",
			importance: 3,
			agent: "test-agent",
			role: "test-role",
			model: "test-model",
			scope: { owner: "test", repo: REPO, ...(branch ? { branch } : {}) },
			created_at: now,
			updated_at: now,
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

		db.memories.bulkInsertMemories([makeEntry("bulk-a", "feat/bulk-a"), makeEntry("bulk-b")]);

		let byIds = db.memories.getByIds(["bulk-a", "bulk-b"]);
		expect(byIds.find((m) => m.id === "bulk-a")?.scope.branch).toBe("feat/bulk-a");
		expect(byIds.find((m) => m.id === "bulk-b")?.scope.branch).toBeUndefined();

		db.memories.bulkUpdateMemories(["bulk-a"], { scope: { owner: "test", repo: REPO, branch: "feat/bulk-updated" } });
		byIds = db.memories.getByIds(["bulk-a"]);
		expect(byIds[0]?.scope.branch).toBe("feat/bulk-updated");
	});

	it("boosts a same-branch match above an equal-relevance other-branch match", async () => {
		// Identical relevance (title, importance, term counts) except branch:
		// the +0.1 branch boost (memory.read.ts step 2) must break the tie in
		// favor of whichever branch the read scope points at.
		const mAlpha = await writeMemory("Shared branchtest topic", "branchtest shared zebra", "feat/alpha");
		const mBeta = await writeMemory("Shared branchtest topic", "branchtest shared alpha", "feat/beta");

		const searchScoped = async (branch: string) => {
			const res = await router("tools/call", {
				name: "memory-read",
				arguments: {
					query: "branchtest shared",
					owner: "test",
					repo: REPO,
					scope: { branch },
					limit: 10
				}
			});
			return res.structuredContent.rows as Array<[string, string, string, string, number]>;
		};

		// Rows are [id, code, title, type, importance]; first row = top-ranked.
		const rowsAlpha = await searchScoped("feat/alpha");
		expect(rowsAlpha[0][0]).toBe(mAlpha.id);

		const rowsBeta = await searchScoped("feat/beta");
		expect(rowsBeta[0][0]).toBe(mBeta.id);
	});
});
