import { describe, it, expect, beforeEach } from "vitest";
import { handleAgentContext } from "../tools/agent-context";
import {
	estimateTokens,
	rankAndPackContext,
	ESTIMATE_CHARS_PER_TOKEN_CODE,
	ESTIMATE_CHARS_PER_TOKEN_DEFAULT,
	ESTIMATE_TOKEN_FLOOR,
	ESTIMATE_TOKEN_OVERHEAD,
	type ContextCandidate,
	type AgentContextSource
} from "../tools/agent-context-compiler";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore, MemoryEntry, CodingStandardEntry } from "../types";
import type { McpResponse } from "../utils/mcp-response";

/** Shape of handleAgentContext's structuredContent (see tools/agent-context.ts). */
interface AgentContextResult {
	schema: string;
	repo: string;
	query: string | null;
	memories: Array<{
		id: string;
		code: string | null;
		title: string;
		type: string;
		importance: number;
	}>;
	decisions: Array<{
		id: string;
		code: string | null;
		title: string;
		importance: number;
	}>;
	tasks: Array<{
		task_code: string;
		title: string;
		status: string;
		priority: number;
	}>;
	context: Array<{ source: string; id: string; estimated_tokens: number }>;
	estimated_tokens: number;
	allocation: { included_items: number };
	exclusions: Array<{ source: string; id: string; reason: string }>;
}

/** Narrow McpResponse.structuredContent (unknown) to the agent-context result shape. */
function getStructured(res: McpResponse): AgentContextResult {
	return res.structuredContent as AgentContextResult;
}

describe("Agent Context - handleAgentContext", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;

	const REPO = "agent-context-test";
	const OWNER = "test";

	function seedMemory(overrides: Partial<MemoryEntry> & { title: string; content: string }): MemoryEntry {
		const entry: MemoryEntry = {
			id: overrides.id ?? crypto.randomUUID(),
			type: overrides.type ?? "code_fact",
			title: overrides.title,
			content: overrides.content,
			importance: overrides.importance ?? 3,
			agent: "test-agent",
			role: "unknown",
			model: "test-model",
			scope: { owner: OWNER, repo: REPO },
			created_at: overrides.created_at ?? new Date().toISOString(),
			updated_at: new Date().toISOString(),
			completed_at: null,
			hit_count: 0,
			recall_count: 0,
			last_used_at: null,
			expires_at: null,
			supersedes: null,
			status: "active",
			tags: overrides.tags ?? [],
			metadata: overrides.metadata ?? {},
			is_global: false,
			code: overrides.code
		};
		db.memories.insert(entry);
		return entry;
	}

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
	});

	it("should return memories matching the query param", async () => {
		seedMemory({ title: "Auth Setup", content: "JWT tokens with 1h expiry." });
		seedMemory({ title: "Payment Gateway", content: "Stripe integration for checkout." });

		const res = await handleAgentContext(
			{ owner: OWNER, repo: REPO, query: "auth", limit: 5, json: true },
			db,
			vectors
		);

		expect(res.structuredContent).toBeDefined();
		expect(getStructured(res).schema).toBe("agent-context");
		expect(getStructured(res).query).toBe("auth");
		expect(getStructured(res).memories.length).toBeGreaterThan(0);
		const titles = getStructured(res).memories.map((m: { title: string }) => m.title);
		expect(titles).toContain("Auth Setup");
	});

	it("should return recent memories when no query is provided", async () => {
		seedMemory({ title: "Alpha", content: "First memory content." });
		seedMemory({ title: "Beta", content: "Second memory content." });

		const res = await handleAgentContext({ owner: OWNER, repo: REPO, limit: 10, json: true }, db, vectors);

		expect(getStructured(res).memories.length).toBeGreaterThanOrEqual(2);
	});

	// ─── backward compat: objective still works ──────────────────────────

	it("should accept query param for searching", async () => {
		seedMemory({ title: "DB Schema", content: "Database schema: Users table with UUID primary key." });

		const res = await handleAgentContext(
			{ owner: OWNER, repo: REPO, query: "database", limit: 5, json: true },
			db,
			vectors
		);

		expect(getStructured(res).query).toBe("database");
		expect(getStructured(res).memories.length).toBeGreaterThan(0);
	});

	it("query param takes precedence over other params", async () => {
		seedMemory({ title: "Cache Strategy", content: "Redis caching for API responses." });
		seedMemory({ title: "Old Config", content: "Legacy config loader." });

		const res = await handleAgentContext(
			{ owner: OWNER, repo: REPO, query: "cache", limit: 5, json: true },
			db,
			vectors
		);

		expect(getStructured(res).query).toBe("cache");
		const titles = getStructured(res).memories.map((m: { title: string }) => m.title);
		expect(titles).toContain("Cache Strategy");
	});

	// ─── vector search via query param ───────────────────────────────────

	it("should attempt vector search when query is provided and fall back to keyword", async () => {
		// Seed a memory and ensure it gets a vector embedding
		seedMemory({
			title: "Vector Search Test",
			content: "This memory is about vector similarity searches in the agent context."
		});

		// Wait for vector upsert (StubVectorStore is sync-ish)
		await vectors.upsert(
			db.memories.searchByRepo(OWNER, REPO, "vector", undefined, 1)[0]?.id ?? "",
			"vector similarity searches"
		);

		const res = await handleAgentContext(
			{ owner: OWNER, repo: REPO, query: "vector similarity", limit: 5, json: true },
			db,
			vectors
		);

		expect(getStructured(res).memories.length).toBeGreaterThan(0);
	});

	it("vector search returns empty gracefully when repo has no memories", async () => {
		const res = await handleAgentContext(
			{ owner: OWNER, repo: "never", query: "anything", limit: 5, json: true },
			db,
			vectors
		);

		expect(getStructured(res).memories).toEqual([]);
	});

	// ─── type_filter ─────────────────────────────────────────────────────

	it("should filter by type_filter when provided", async () => {
		seedMemory({ type: "code_fact", title: "Code Rule", content: "Always use strict typing." });
		seedMemory({ type: "pattern", title: "Pattern Match", content: "Observer pattern for events." });

		const res = await handleAgentContext(
			{ owner: OWNER, repo: REPO, type_filter: "pattern", limit: 5, json: true },
			db,
			vectors
		);

		const types = getStructured(res).memories.map((m: { type: string }) => m.type);
		expect(types.every((t: string) => t === "pattern")).toBe(true);
	});

	// ─── decisions and tasks in output ───────────────────────────────────

	it("should include separate decisions section when decision memories exist", async () => {
		seedMemory({ type: "decision", title: "Use Postgres", content: "Chose Postgres over MySQL." });

		const res = await handleAgentContext({ owner: OWNER, repo: REPO, limit: 5, json: true }, db, vectors);

		expect(getStructured(res).decisions.length).toBeGreaterThan(0);
	});

	it("should include active tasks in the response", async () => {
		const now = new Date().toISOString();
		db.tasks.insertTask({
			id: crypto.randomUUID(),
			task_code: "AC-001",
			owner: OWNER,
			repo: REPO,
			phase: "test",
			title: "Agent Context Test Task",
			description: "A task for testing agent-context output.",
			status: "in_progress",
			priority: 3,
			agent: "test-agent",
			role: "tester",
			doc_path: null,
			created_at: now,
			updated_at: now,
			in_progress_at: now,
			finished_at: null,
			canceled_at: null,
			est_tokens: 0,
			commit_id: null,
			changed_files: [],
			tags: [],
			suggested_skills: [],
			metadata: {},
			parent_id: null,
			depends_on: null
		});

		const res = await handleAgentContext({ owner: OWNER, repo: REPO, limit: 5, json: true }, db, vectors);

		expect(getStructured(res).tasks.length).toBeGreaterThan(0);
		const taskCodes = getStructured(res).tasks.map((t: { task_code: string }) => t.task_code);
		expect(taskCodes).toContain("AC-001");
	});

	// ─── token-budgeted multi-source compiler ────────────────────────────

	it("compiles deterministic context within the requested token and item budgets", async () => {
		for (let i = 0; i < 8; i++) {
			seedMemory({
				title: `Compiler memory ${i}`,
				content: `Deterministic compiler evidence ${i} `.repeat(20),
				importance: i === 0 ? 5 : 3
			});
		}

		const args = {
			owner: OWNER,
			repo: REPO,
			objective: "deterministic compiler",
			budget: { tokens: 256, max_items: 3, code_depth: 1 },
			json: true
		};
		const first = getStructured(await handleAgentContext(args, db, vectors));
		const second = getStructured(await handleAgentContext(args, db, vectors));

		expect(first.context).toEqual(second.context);
		expect(first.context.length).toBeLessThanOrEqual(3);
		expect(first.estimated_tokens).toBeLessThanOrEqual(256);
		expect(first.allocation.included_items).toBe(first.context.length);
		expect(first.exclusions.some((entry) => entry.reason === "token_budget" || entry.reason === "item_budget")).toBe(
			true
		);
	});

	it("prioritizes an explicitly requested task and supports source selection", async () => {
		const now = new Date().toISOString();
		db.tasks.insertTask({
			id: crypto.randomUUID(),
			task_code: "AC-CRITICAL",
			owner: OWNER,
			repo: REPO,
			phase: "implementation",
			title: "Critical compiler task",
			description: "Preserve the requested task under a constrained context budget.",
			status: "in_progress",
			priority: 5,
			agent: "test-agent",
			role: "implementation",
			doc_path: null,
			created_at: now,
			updated_at: now,
			in_progress_at: now,
			finished_at: null,
			canceled_at: null,
			est_tokens: 100,
			commit_id: null,
			changed_files: [],
			tags: [],
			suggested_skills: [],
			metadata: {},
			parent_id: null,
			depends_on: null
		});
		seedMemory({ title: "Noise", content: "Unrelated memory that must not leak through source selection." });

		const result = getStructured(
			await handleAgentContext(
				{
					owner: OWNER,
					repo: REPO,
					task_code: "AC-CRITICAL",
					sources: ["tasks"],
					budget: { tokens: 256, max_items: 1, code_depth: 0 },
					json: true
				},
				db,
				vectors
			)
		);

		expect(result.context).toHaveLength(1);
		expect(result.context[0].source).toBe("tasks");
		expect(result.context[0].id).toBe("AC-CRITICAL");
		expect(result.memories).toEqual([]);
		expect(result.tasks.map((task) => task.task_code)).toEqual(["AC-CRITICAL"]);
	});

	it("retrieves handoffs, standards, fresh observations, and indexed code pointers", async () => {
		const now = new Date().toISOString();
		db.handoffs.createHandoff({
			owner: OWNER,
			repo: REPO,
			from_agent: "scout",
			summary: "Inspect the compiler contract."
		});
		const standard: CodingStandardEntry = {
			id: crypto.randomUUID(),
			code: "STD-COMPILER",
			title: "Compiler standard",
			content: "Keep context compilation deterministic and bounded.",
			parent_id: null,
			context: "agent context",
			version: "1.0.0",
			language: "typescript",
			stack: [],
			is_global: false,
			owner: OWNER,
			repo: REPO,
			tags: [],
			metadata: {},
			created_at: now,
			updated_at: now,
			hit_count: 0,
			last_used_at: null,
			agent: "test-agent",
			model: "test-model"
		};
		db.standards.insert(standard);
		db.codebaseFiles.upsertFile({
			repo: REPO,
			file_path: "src/compiler.ts",
			language: "typescript",
			checksum: "compiler-checksum",
			lines: 10,
			size_bytes: 100
		});
		db.codebaseFiles.upsertFile({
			repo: REPO,
			file_path: "src/budget.ts",
			language: "typescript",
			checksum: "budget-checksum",
			lines: 6,
			size_bytes: 60
		});
		db.codebaseSymbols.bulkUpsertSymbols([
			{
				id: "123e4567-e89b-42d3-a456-426614174101",
				repo: REPO,
				file_path: "src/compiler.ts",
				name: "compileContext",
				kind: "function",
				exported: true,
				start_line: 1,
				end_line: 8,
				signature: "compileContext(): Context"
			},
			{
				id: "123e4567-e89b-42d3-a456-426614174102",
				repo: REPO,
				file_path: "src/budget.ts",
				name: "estimateBudget",
				kind: "function",
				exported: true,
				start_line: 1,
				end_line: 5,
				signature: "estimateBudget(): number"
			}
		]);
		db.codebaseReferences.bulkUpsertReferences(REPO, [
			{
				repo: REPO,
				symbol_name: "estimateBudget",
				caller_file: "src/compiler.ts",
				caller_line: 4,
				caller_name: "compileContext",
				kind: "call",
				target_file: "src/budget.ts",
				target_symbol_id: "123e4567-e89b-42d3-a456-426614174102"
			}
		]);
		db.explorationObservations.upsertMany(OWNER, REPO, [
			{
				subject: "Compiler evidence",
				fact: "Context is packed under a deterministic token budget.",
				confidence: 0.95,
				evidence: [{ file_path: "src/compiler.ts", symbol_id: "123e4567-e89b-42d3-a456-426614174101" }]
			}
		]);

		const result = getStructured(
			await handleAgentContext(
				{
					owner: OWNER,
					repo: REPO,
					objective: "compiler",
					current_file_path: "src/compiler.ts",
					sources: ["handoffs", "standards", "observations", "code"],
					budget: { tokens: 2000, max_items: 20, code_depth: 1 },
					json: true
				},
				db,
				vectors
			)
		);

		expect(new Set(result.context.map((item) => item.source))).toEqual(
			new Set(["handoffs", "standards", "observations", "code"])
		);
		expect(result.context.filter((item) => item.source === "code").map((item) => item.id)).toContain(
			"123e4567-e89b-42d3-a456-426614174102"
		);
	});

	// ─── TASK-028: restrict the code-graph BFS to real dependency edges ──

	it("does not pull unrelated barrel re-export symbols through the code BFS (TASK-028)", async () => {
		const FILE_A = "src/a.ts";
		const FILE_REAL = "src/real.ts";
		const FILE_BARREL = "src/barrel.ts";
		const FILE_UNRELATED = "src/unrelated.ts";

		for (const [file_path, checksum] of [
			[FILE_A, "a"],
			[FILE_REAL, "real"],
			[FILE_BARREL, "barrel"],
			[FILE_UNRELATED, "unrelated"]
		] as const) {
			db.codebaseFiles.upsertFile({
				repo: REPO,
				file_path,
				language: "typescript",
				checksum,
				lines: 5,
				size_bytes: 50
			});
		}

		db.codebaseSymbols.bulkUpsertSymbols([
			// Seed file A — the file the agent is editing.
			{
				id: "aaaaaaaa-0000-4000-8000-000000000001",
				repo: REPO,
				file_path: FILE_A,
				name: "mainFn",
				kind: "function",
				exported: true,
				start_line: 1,
				end_line: 5,
				signature: "mainFn(): void"
			},
			// Real dependency C, reached through a genuine import edge from A.
			{
				id: "cccccccc-0000-4000-8000-000000000001",
				repo: REPO,
				file_path: FILE_REAL,
				name: "realDep",
				kind: "function",
				exported: true,
				start_line: 1,
				end_line: 3,
				signature: "realDep(): number"
			},
			// Barrel file B — an export hub (its own symbol is harmless).
			{
				id: "bbbbbbbb-0000-4000-8000-000000000001",
				repo: REPO,
				file_path: FILE_BARREL,
				name: "barrelMarker",
				kind: "variable",
				exported: true,
				start_line: 1,
				end_line: 1,
				signature: "barrelMarker"
			},
			// Unrelated global symbols the barrel re-exports (the noise).
			{
				id: "dddddddd-0000-4000-8000-000000000001",
				repo: REPO,
				file_path: FILE_UNRELATED,
				name: "UnrelatedOne",
				kind: "class",
				exported: true,
				start_line: 1,
				end_line: 2,
				signature: "class UnrelatedOne"
			},
			{
				id: "dddddddd-0000-4000-8000-000000000002",
				repo: REPO,
				file_path: FILE_UNRELATED,
				name: "UnrelatedTwo",
				kind: "class",
				exported: true,
				start_line: 3,
				end_line: 4,
				signature: "class UnrelatedTwo"
			},
			{
				id: "dddddddd-0000-4000-8000-000000000003",
				repo: REPO,
				file_path: FILE_UNRELATED,
				name: "UnrelatedThree",
				kind: "interface",
				exported: true,
				start_line: 5,
				end_line: 6,
				signature: "interface UnrelatedThree"
			}
		]);

		db.codebaseReferences.bulkUpsertReferences(REPO, [
			// A imports the real dependency (a genuine edge — must survive).
			{
				repo: REPO,
				symbol_name: "realDep",
				caller_file: FILE_A,
				caller_line: 2,
				caller_name: "mainFn",
				kind: "import",
				target_file: FILE_REAL,
				target_symbol_id: "cccccccc-0000-4000-8000-000000000001"
			},
			// A imports the barrel (real edge; barrel file enters the frontier).
			{
				repo: REPO,
				symbol_name: "barrelMarker",
				caller_file: FILE_A,
				caller_line: 3,
				caller_name: "mainFn",
				kind: "import",
				target_file: FILE_BARREL,
				target_symbol_id: "bbbbbbbb-0000-4000-8000-000000000001"
			},
			// The barrel re-exports unrelated globals — barrel-only edges that
			// must NOT be traversed (the TASK-028 noise source).
			{
				repo: REPO,
				symbol_name: "UnrelatedOne",
				caller_file: FILE_BARREL,
				caller_line: 1,
				caller_name: null,
				kind: "reexport",
				target_file: FILE_UNRELATED,
				target_symbol_id: "dddddddd-0000-4000-8000-000000000001",
				import_kind: "named"
			},
			{
				repo: REPO,
				symbol_name: "UnrelatedTwo",
				caller_file: FILE_BARREL,
				caller_line: 1,
				caller_name: null,
				kind: "reexport",
				target_file: FILE_UNRELATED,
				target_symbol_id: "dddddddd-0000-4000-8000-000000000002",
				import_kind: "named"
			},
			{
				// Wildcard `export *` — import_kind "wildcard", still kind "reexport".
				repo: REPO,
				symbol_name: "./unrelated",
				caller_file: FILE_BARREL,
				caller_line: 1,
				caller_name: null,
				kind: "reexport",
				target_file: FILE_UNRELATED,
				target_symbol_id: "dddddddd-0000-4000-8000-000000000003",
				import_kind: "wildcard"
			}
		]);

		const result = getStructured(
			await handleAgentContext(
				{
					owner: OWNER,
					repo: REPO,
					current_file_path: FILE_A,
					sources: ["code"],
					budget: { tokens: 2000, max_items: 20, code_depth: 2 },
					json: true
				},
				db,
				vectors
			)
		);

		const codeIds = result.context.filter((item) => item.source === "code").map((item) => item.id);
		// Seed symbol of A is always kept.
		expect(codeIds).toContain("aaaaaaaa-0000-4000-8000-000000000001");
		// The genuine import edge is followed.
		expect(codeIds).toContain("cccccccc-0000-4000-8000-000000000001");
		// Barrel re-export targets are NOT dragged in.
		expect(codeIds).not.toContain("dddddddd-0000-4000-8000-000000000001");
		expect(codeIds).not.toContain("dddddddd-0000-4000-8000-000000000002");
		expect(codeIds).not.toContain("dddddddd-0000-4000-8000-000000000003");
	});

	it("keeps seed-only semantics at code_depth 0 (TASK-028 regression)", async () => {
		// Guard the seed contract: with code_depth 0 the seed file's own symbols
		// are returned and no BFS runs at all — re-export filtering must not
		// change that.
		db.codebaseSymbols.bulkUpsertSymbols([
			{
				id: "eeeeeeee-0000-4000-8000-000000000001",
				repo: REPO,
				file_path: "src/seed-only.ts",
				name: "seedOnly",
				kind: "function",
				exported: true,
				start_line: 1,
				end_line: 1,
				signature: "seedOnly(): void"
			},
			{
				id: "eeeeeeee-0000-4000-8000-000000000002",
				repo: REPO,
				file_path: "src/other.ts",
				name: "otherSym",
				kind: "function",
				exported: true,
				start_line: 1,
				end_line: 1,
				signature: "otherSym(): void"
			}
		]);
		db.codebaseReferences.bulkUpsertReferences(REPO, [
			{
				repo: REPO,
				symbol_name: "otherSym",
				caller_file: "src/seed-only.ts",
				caller_line: 1,
				caller_name: "seedOnly",
				kind: "call",
				target_file: "src/other.ts",
				target_symbol_id: "eeeeeeee-0000-4000-8000-000000000002"
			}
		]);

		const result = getStructured(
			await handleAgentContext(
				{
					owner: OWNER,
					repo: REPO,
					current_file_path: "src/seed-only.ts",
					sources: ["code"],
					budget: { tokens: 2000, max_items: 20, code_depth: 0 },
					json: true
				},
				db,
				vectors
			)
		);

		const codeIds = result.context.filter((item) => item.source === "code").map((item) => item.id);
		expect(codeIds).toEqual(["eeeeeeee-0000-4000-8000-000000000001"]);
	});

	it("ranks objective matches found in an observation fact, not only its subject", async () => {
		db.explorationObservations.upsertMany(OWNER, REPO, [
			{
				subject: "Unrelated heading",
				fact: "The compiler uses a needle-fact token allocator.",
				confidence: 0.9,
				evidence: [{ file_path: "src/not-indexed.ts" }]
			}
		]);

		const result = getStructured(
			await handleAgentContext(
				{
					owner: OWNER,
					repo: REPO,
					objective: "needle-fact",
					sources: ["observations"],
					include_stale: true,
					json: true
				},
				db,
				vectors
			)
		);

		expect(result.context.map((item) => item.source)).toEqual(["observations"]);
	});

	// ─── limit param ─────────────────────────────────────────────────────

	it("should respect the limit parameter", async () => {
		for (let i = 0; i < 10; i++) {
			seedMemory({ title: `Limit Test ${i}`, content: `Content for memory ${i}.` });
		}

		const res = await handleAgentContext({ owner: OWNER, repo: REPO, limit: 3, json: true }, db, vectors);

		expect(getStructured(res).memories.length).toBeLessThanOrEqual(3);
	});

	// ─── TASK-025: minimum relevance threshold ───────────────────────────

	it("excludes irrelevant candidates as below_relevance when min_relevance is set", async () => {
		const relevant = seedMemory({
			title: "Compiler budget plan",
			content: "Compiler budget allocation details for the build."
		});
		const irrelevant = seedMemory({
			title: "Unrelated topic",
			content: "Something else entirely about cooking."
		});
		// Vector search is the path that admits lexically-irrelevant candidates.
		await vectors.upsert(relevant.id, `${relevant.title} ${relevant.content}`);
		await vectors.upsert(irrelevant.id, `${irrelevant.title} ${irrelevant.content}`);

		const res = await handleAgentContext(
			{
				owner: OWNER,
				repo: REPO,
				objective: "compiler budget",
				sources: ["memories"],
				budget: { tokens: 2000, max_items: 20, code_depth: 0, min_relevance: 0.5 },
				json: true
			},
			db,
			vectors
		);

		const excluded = getStructured(res).exclusions.filter((entry) => entry.reason === "below_relevance");
		expect(excluded.map((entry) => entry.id)).toContain(irrelevant.id);
		expect(excluded.every((entry) => entry.source === "memories")).toBe(true);
		const includedIds = new Set(getStructured(res).context.map((item) => item.id));
		expect(includedIds.has(irrelevant.id)).toBe(false);
		expect(includedIds.has(relevant.id)).toBe(true);
	});

	it("does not apply min_relevance filtering at the default value of 0", async () => {
		const relevant = seedMemory({ title: "Compiler budget plan", content: "Compiler budget allocation details." });
		const irrelevant = seedMemory({ title: "Unrelated topic", content: "Something else entirely about cooking." });
		await vectors.upsert(relevant.id, `${relevant.title} ${relevant.content}`);
		await vectors.upsert(irrelevant.id, `${irrelevant.title} ${irrelevant.content}`);

		const res = await handleAgentContext(
			{
				owner: OWNER,
				repo: REPO,
				objective: "compiler budget",
				sources: ["memories"],
				budget: { tokens: 2000, max_items: 20, code_depth: 0 },
				json: true
			},
			db,
			vectors
		);

		expect(getStructured(res).exclusions.some((entry) => entry.reason === "below_relevance")).toBe(false);
		// With filtering disabled the irrelevant candidate is still admitted.
		expect(getStructured(res).context.map((item) => item.id)).toContain(irrelevant.id);
	});

	it("keeps a pinned task critical and included even when min_relevance is set and it does not match", async () => {
		const now = new Date().toISOString();
		db.tasks.insertTask({
			id: crypto.randomUUID(),
			task_code: "AC-PINNED-NOMATCH",
			owner: OWNER,
			repo: REPO,
			phase: "implementation",
			title: "Pinned task with unrelated wording",
			description: "No lexical overlap with the objective at all.",
			status: "in_progress",
			priority: 3,
			agent: "test-agent",
			role: "implementation",
			doc_path: null,
			created_at: now,
			updated_at: now,
			in_progress_at: now,
			finished_at: null,
			canceled_at: null,
			est_tokens: 50,
			commit_id: null,
			changed_files: [],
			tags: [],
			suggested_skills: [],
			metadata: {},
			parent_id: null,
			depends_on: null
		});

		const res = await handleAgentContext(
			{
				owner: OWNER,
				repo: REPO,
				task_code: "AC-PINNED-NOMATCH",
				objective: "compiler budget",
				sources: ["tasks"],
				budget: { tokens: 256, max_items: 1, code_depth: 0, min_relevance: 0.9 },
				json: true
			},
			db,
			vectors
		);

		expect(getStructured(res).context.map((item) => item.id)).toContain("AC-PINNED-NOMATCH");
		expect(getStructured(res).exclusions.some((entry) => entry.id === "AC-PINNED-NOMATCH")).toBe(false);
	});

	// ─── TASK-029: legacy block dedup + accounting ───────────────────────

	/** Extract the primary text content from an McpResponse. */
	function textOf(res: McpResponse): string {
		const item = (res.content ?? []).find((entry) => entry.type === "text");
		return item?.type === "text" ? item.text : "";
	}

	it("does not repeat a compiled memory in the legacy Relevant Memories block (TASK-029)", async () => {
		const memory = seedMemory({
			title: "Compiled dedup memory",
			content: "This memory is packed by the compiler and must not be duplicated."
		});

		const res = await handleAgentContext(
			{ owner: OWNER, repo: REPO, objective: "compiled dedup", limit: 5, json: true },
			db,
			vectors
		);

		// The memory won a slot in the compiled pack.
		expect(getStructured(res).context.map((item) => item.id)).toContain(memory.id);

		// The rendered legacy block must not contain its bullet again.
		const text = textOf(res);
		const legacyBlock = text.split("== Compiled Context ==")[0] ?? "";
		expect(legacyBlock).not.toContain(memory.title);
		// Header + placeholder are preserved when dedup empties the block.
		expect(legacyBlock).toContain("== Relevant Memories ==");
		expect(legacyBlock).toContain("(No relevant memories selected)");
		// Structured projection keeps the full row (contract preserved).
		expect(getStructured(res).memories.map((m) => m.id)).toContain(memory.id);
	});

	it("reports the legacy memory block cost in the summary (TASK-029)", async () => {
		// No objective → memories are not lexically matched. With max_items 1 only
		// one memory wins the compiled pack; the other stays in the legacy block,
		// so the accounting line reports a real (non-zero) legacy cost.
		seedMemory({ title: "Legacy alpha", content: "First legacy memory." });
		seedMemory({ title: "Legacy beta", content: "Second legacy memory." });

		const res = await handleAgentContext(
			{ owner: OWNER, repo: REPO, limit: 5, budget: { tokens: 2000, max_items: 1, code_depth: 0 }, json: true },
			db,
			vectors
		);

		const text = textOf(res);
		expect(text).toMatch(/Legacy memory block: ~\d+ tokens \(1 items\)\./);
		expect(text).toContain("Estimated ");
		// The compiled pack holds exactly the one packed memory.
		expect(getStructured(res).context).toHaveLength(1);
	});

	it("keeps the legacy accounting line and empty placeholder when nothing is selected (TASK-029)", async () => {
		const res = await handleAgentContext({ owner: OWNER, repo: "empty-repo", limit: 5, json: true }, db, vectors);

		const text = textOf(res);
		expect(text).toContain("(No relevant memories selected)");
		expect(text).toContain("(No candidates fit the requested budget)");
		expect(text).toContain("Legacy memory block: ~0 tokens (0 items).");
	});

	// ─── TASK-431: code-first reference labels in the compiled block ─────

	it("renders the short memory code (not the UUID) in the compiled reference label", async () => {
		const memory = seedMemory({
			code: "MEM-189",
			title: "Compiled code label memory",
			content: "Compiled code label content used to prove token-saving labels."
		});

		const res = await handleAgentContext(
			{
				owner: OWNER,
				repo: REPO,
				objective: "compiled code label",
				sources: ["memories"],
				json: true
			},
			db,
			vectors
		);

		// The memory still wins a slot (retrieval/ranking unchanged).
		expect(getStructured(res).context.map((item) => item.id)).toContain(memory.id);

		const text = textOf(res);
		expect(text).toContain("[memories/MEM-189]");
		expect(text).not.toContain(memory.id);
	});

	it("falls back to the UUID reference label when a memory has no code (TASK-431)", async () => {
		const memory = seedMemory({
			title: "Codeless label memory",
			content: "Codeless label content used to prove the UUID fallback path."
		});

		const res = await handleAgentContext(
			{
				owner: OWNER,
				repo: REPO,
				objective: "codeless label",
				sources: ["memories"],
				json: true
			},
			db,
			vectors
		);

		expect(getStructured(res).context.map((item) => item.id)).toContain(memory.id);

		const text = textOf(res);
		expect(text).toContain(`[memories/${memory.id}]`);
	});

	it("renders the short decision code in the compiled reference label (TASK-431)", async () => {
		const decision = seedMemory({
			type: "decision",
			code: "DEC-042",
			title: "Decision code label",
			content: "Decision code label content for the compiled decisions block."
		});

		const res = await handleAgentContext(
			{
				owner: OWNER,
				repo: REPO,
				objective: "decision code label",
				sources: ["decisions"],
				json: true
			},
			db,
			vectors
		);

		expect(getStructured(res).context.map((item) => item.id)).toContain(decision.id);

		const text = textOf(res);
		expect(text).toContain("[decisions/DEC-042]");
		expect(text).not.toContain(decision.id);
	});
});

// ─── pure compiler ranking (TASK-025 / TASK-026) ─────────────────────────

describe("Agent Context - rankAndPackContext relevance + criticality", () => {
	function makeCandidate(
		source: AgentContextSource,
		id: string,
		title: string,
		text: string,
		opts: { priority?: number; critical?: boolean } = {}
	): ContextCandidate {
		return {
			source,
			id,
			reference: id,
			title,
			text,
			provenance: {},
			priority: opts.priority ?? 3,
			critical: opts.critical ?? false,
			estimated_tokens: 50
		};
	}

	it("drops non-matching candidates as below_relevance when min_relevance > 0", () => {
		const relevant = makeCandidate("memories", "a", "Compiler budget", "Compiler budget allocation.");
		const irrelevant = makeCandidate("memories", "b", "Cooking", "Recipes for dinner.");

		const result = rankAndPackContext([relevant, irrelevant], "compiler budget", {
			tokens: 2000,
			max_items: 20,
			min_relevance: 0.5
		});

		expect(result.included.map((item) => item.id)).toEqual(["a"]);
		expect(result.exclusions).toEqual([
			{ source: "memories", id: "b", reason: "below_relevance", estimated_tokens: 50 }
		]);
	});

	it("does not filter when the objective is empty even if min_relevance > 0", () => {
		const a = makeCandidate("memories", "a", "Anything", "No objective basis.");
		const b = makeCandidate("memories", "b", "Something", "Also unrelated.");

		const result = rankAndPackContext([a, b], "", { tokens: 2000, max_items: 20, min_relevance: 0.9 });

		expect(result.included.map((item) => item.id).sort()).toEqual(["a", "b"]);
		expect(result.exclusions).toEqual([]);
	});

	it("does not mark an irrelevant decision critical (TASK-026)", () => {
		const decision = makeCandidate("decisions", "d1", "Cooking", "Recipes for dinner.", { priority: 5 });

		const result = rankAndPackContext([decision], "compiler budget", { tokens: 2000, max_items: 20 });

		expect(result.included).toHaveLength(1);
		expect(result.included[0].critical).toBe(false);
	});

	it("marks a decision critical only when it matches the objective at/above the threshold", () => {
		const matching = makeCandidate("decisions", "d1", "Compiler budget", "Compiler budget decision.", {
			priority: 1
		});
		const nonMatching = makeCandidate("decisions", "d2", "Cooking", "Recipes for dinner.", { priority: 5 });

		const result = rankAndPackContext([matching, nonMatching], "compiler budget", { tokens: 2000, max_items: 20 });

		const byId = new Map(result.included.map((item) => [item.id, item.critical]));
		expect(byId.get("d1")).toBe(true);
		expect(byId.get("d2")).toBe(false);
	});

	it("never marks decisions critical when the objective is empty", () => {
		const decision = makeCandidate("decisions", "d1", "Compiler budget", "Compiler budget decision.", { priority: 5 });

		const result = rankAndPackContext([decision], "", { tokens: 2000, max_items: 20 });

		expect(result.included[0].critical).toBe(false);
	});

	it("keeps a task candidate unconditionally critical", () => {
		const pinned = makeCandidate("tasks", "t1", "Unrelated task", "No overlap with objective.", { critical: true });

		const result = rankAndPackContext([pinned], "compiler budget", {
			tokens: 2000,
			max_items: 20,
			min_relevance: 0.9
		});

		expect(result.included.map((item) => item.id)).toEqual(["t1"]);
		expect(result.included[0].critical).toBe(true);
		expect(result.exclusions).toEqual([]);
	});
});

// ─── TASK-030: source-aware token estimation ─────────────────────────────

describe("Agent Context - estimateTokens (TASK-030)", () => {
	it("estimates code text HIGHER than prose for the same input", () => {
		// Identical length, different source → the code divisor is smaller, so the
		// estimate is larger (the safe direction: over-estimate code, never overflow).
		const text = "a".repeat(120);
		const prose = estimateTokens(text);
		const code = estimateTokens(text, "code");
		expect(code).toBeGreaterThan(prose);
		expect(prose).toBe(Math.ceil(text.length / ESTIMATE_CHARS_PER_TOKEN_DEFAULT) + ESTIMATE_TOKEN_OVERHEAD);
		expect(code).toBe(Math.ceil(text.length / ESTIMATE_CHARS_PER_TOKEN_CODE) + ESTIMATE_TOKEN_OVERHEAD);
	});

	it("uses the prose divisor when no source is given and for non-code sources", () => {
		const text = "b".repeat(200);
		const expected = Math.ceil(text.length / ESTIMATE_CHARS_PER_TOKEN_DEFAULT) + ESTIMATE_TOKEN_OVERHEAD;
		expect(estimateTokens(text)).toBe(expected);
		expect(estimateTokens(text, "memories")).toBe(expected);
		expect(estimateTokens(text, "observations")).toBe(expected);
	});

	it("applies the floor to tiny strings", () => {
		expect(estimateTokens("")).toBe(ESTIMATE_TOKEN_FLOOR);
		expect(estimateTokens("hi")).toBe(ESTIMATE_TOKEN_FLOOR);
		expect(estimateTokens("hi", "code")).toBe(ESTIMATE_TOKEN_FLOOR);
	});

	it("is monotonic non-decreasing in text length (prose and code)", () => {
		let previousProse = 0;
		let previousCode = 0;
		for (let length = 0; length <= 400; length += 7) {
			const text = "x".repeat(length);
			const prose = estimateTokens(text);
			const code = estimateTokens(text, "code");
			expect(prose).toBeGreaterThanOrEqual(previousProse);
			expect(code).toBeGreaterThanOrEqual(previousCode);
			previousProse = prose;
			previousCode = code;
		}
	});
});
