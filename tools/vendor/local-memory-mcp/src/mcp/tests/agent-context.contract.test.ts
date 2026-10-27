import { beforeEach, describe, it, expect } from "vitest";
import { AgentContextSchema } from "../tools/schemas/index";
import { MemoryWriteSchema } from "../tools/schemas/memory";
import { handleAgentContext, AGENT_CONTEXT_BLEND, deriveCandidateLimit } from "../tools/agent-context";
import { DECISION_CRITICAL_MIN_SCORE } from "../tools/agent-context-compiler";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { MemoryEntry, VectorStore } from "../types";
import { AGENT_TOOL_DEFINITIONS } from "../types/tool-definitions/agent";

describe("Agent Context - Schema Validation (AgentContextSchema)", () => {
	it("should reject empty owner", () => {
		expect(() => AgentContextSchema.parse({ owner: "", repo: "test" })).toThrow();
	});

	it("should reject empty repo", () => {
		expect(() => AgentContextSchema.parse({ owner: "test", repo: "" })).toThrow();
	});

	it("should accept query as optional string", () => {
		const result = AgentContextSchema.parse({ owner: "test", repo: "test", query: "search term" });
		expect(result.query).toBe("search term");
	});

	it("should accept search via query field", () => {
		const result = AgentContextSchema.parse({
			owner: "test",
			repo: "test",
			query: "old search"
		});
		expect(result.query).toBe("old search");
	});

	it("should apply default limit of 5", () => {
		const result = AgentContextSchema.parse({ owner: "test", repo: "test" });
		expect(result.limit).toBe(5);
	});

	it("should apply default json false", () => {
		const result = AgentContextSchema.parse({ owner: "test", repo: "test" });
		expect(result.json).toBe(false);
	});

	it("accepts compiler inputs and applies bounded defaults", () => {
		const result = AgentContextSchema.parse({ owner: "test", repo: "test", objective: "ship feature" });
		expect(result.budget).toEqual({ tokens: 2000, max_items: 20, code_depth: 1, min_relevance: 0 });
		expect(result.sources).toEqual(["memories", "decisions", "tasks", "handoffs", "standards", "observations", "code"]);
	});

	it("defaults min_relevance to 0 and rejects out-of-range values", () => {
		const result = AgentContextSchema.parse({ owner: "test", repo: "test" });
		expect(result.budget.min_relevance).toBe(0);
		expect(
			AgentContextSchema.parse({ owner: "test", repo: "test", budget: { min_relevance: 0.5 } }).budget.min_relevance
		).toBe(0.5);
		expect(() => AgentContextSchema.parse({ owner: "test", repo: "test", budget: { min_relevance: -0.1 } })).toThrow();
		expect(() => AgentContextSchema.parse({ owner: "test", repo: "test", budget: { min_relevance: 1.5 } })).toThrow();
	});

	it("rejects unsafe compiler budgets and unknown sources", () => {
		expect(() => AgentContextSchema.parse({ owner: "test", repo: "test", budget: { tokens: 255 } })).toThrow();
		expect(() => AgentContextSchema.parse({ owner: "test", repo: "test", sources: ["internet"] })).toThrow();
	});
});

describe("Agent Context - blend + candidate pool constants (TASK-027 / TASK-031)", () => {
	it("weights relevance above importance in AGENT_CONTEXT_BLEND", () => {
		expect(AGENT_CONTEXT_BLEND).toEqual({ vector: 0.6, importance: 0.4 });
		expect(AGENT_CONTEXT_BLEND.vector).toBeGreaterThan(AGENT_CONTEXT_BLEND.importance);
	});

	it("derives the candidate pool primarily from max_items, using limit only as a floor", () => {
		// Default legacy limit (5) no longer starves a larger item budget.
		expect(deriveCandidateLimit(20, 5)).toBe(60);
		// limit is a floor when it exceeds the budget-derived pool.
		expect(deriveCandidateLimit(1, 50)).toBe(50);
		// Clamped to the vector store's hard ceiling.
		expect(deriveCandidateLimit(100, 5)).toBe(100);
		expect(deriveCandidateLimit(40, 5)).toBe(100);
	});

	it("keeps DECISION_CRITICAL_MIN_SCORE a small, non-zero threshold", () => {
		expect(DECISION_CRITICAL_MIN_SCORE).toBeGreaterThan(0);
		expect(DECISION_CRITICAL_MIN_SCORE).toBeLessThanOrEqual(1);
	});
});

describe("Agent Context - response and performance contract", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	const owner = "test";
	const repo = "agent-context-contract";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
	});

	function seedMemory(index: number): void {
		const now = new Date().toISOString();
		const entry: MemoryEntry = {
			id: crypto.randomUUID(),
			type: "code_fact",
			title: `Contract memory ${index}`,
			content: `Bounded compiler candidate ${index} `.repeat(12),
			importance: 3,
			agent: "test-agent",
			role: "unknown",
			model: "test-model",
			scope: { owner, repo },
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
		};
		db.memories.insert(entry);
	}

	it("keeps warm in-memory compilation p95 below 250ms", async () => {
		for (let i = 0; i < 40; i++) seedMemory(i);
		const args = {
			owner,
			repo,
			objective: "bounded compiler",
			sources: ["memories"] as const,
			budget: { tokens: 2_000, max_items: 20, code_depth: 0 },
			json: true
		};
		await handleAgentContext(args, db, vectors);
		const durations: number[] = [];
		for (let i = 0; i < 20; i++) {
			const started = performance.now();
			await handleAgentContext(args, db, vectors);
			durations.push(performance.now() - started);
		}
		durations.sort((a, b) => a - b);
		const p95 = durations[Math.ceil(durations.length * 0.95) - 1]!;
		expect(p95).toBeLessThan(250);
	});

	it("returns the same opaque pack id for an explicit correlation key", async () => {
		seedMemory(1);
		const args = {
			owner,
			repo,
			objective: "bounded compiler",
			sources: ["memories"] as const,
			context_pack_id: "shared-pack-key",
			json: true
		};
		const first = await handleAgentContext(args, db, vectors);
		const second = await handleAgentContext(args, db, vectors);
		const firstData = first.structuredContent as { context_pack_id: string };
		const secondData = second.structuredContent as { context_pack_id: string };
		expect(firstData.context_pack_id).toBe(secondData.context_pack_id);
		expect(firstData.context_pack_id).not.toContain("shared-pack-key");
		expect(second).toBe(first);
	});

	it("keeps compact text without structured JSON and includes it when requested", async () => {
		seedMemory(1);
		const args = { owner, repo, objective: "bounded compiler", sources: ["memories"] as const };
		const compact = await handleAgentContext(args, db, vectors);
		expect(compact.structuredContent).toBeUndefined();
		expect(compact.content).toHaveLength(1);
		const [content] = compact.content ?? [];
		if (content?.type !== "text") throw new Error("Expected text content");
		expect(content.text).toContain("Relevant Memories");

		const structured = await handleAgentContext({ ...args, json: true }, db, vectors);
		expect(structured.structuredContent).toMatchObject({
			schema: "agent-context",
			context_pack_id: expect.stringMatching(/^[a-f0-9]{24}$/),
			repo,
			memories: expect.any(Array),
			decisions: expect.any(Array),
			tasks: expect.any(Array)
		});
	});
});

describe("Agent Context - decision-log and session-summarize removed", () => {
	it("decision-log/session-summarize logic replaced by flat fields in memory-write", () => {
		// Verify the flat decision fields exist on memory-write schema
		const shape = MemoryWriteSchema.shape || {};
		const keys = Object.keys(shape);
		expect(keys).toContain("context");
		expect(keys).toContain("rationale");
		expect(keys).toContain("alternatives");
		expect(keys).toContain("key_decisions");
		expect(keys).toContain("next_steps");
	});

	it("agent-context definition no longer lists decision-log or session-summarize tools", () => {
		const toolNames = AGENT_TOOL_DEFINITIONS.map((t: { name: string }) => t.name);
		expect(toolNames).not.toContain("decision-log");
		expect(toolNames).not.toContain("session-summarize");
	});
});
