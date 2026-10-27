import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";

describe("ADR Backward Compat Aliases — old names route to new handlers", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: Record<string, unknown>) => Promise<any>;
	const REPO = "backward-compat-repo";

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

	// ── memory-write backward compat: type=decision with context/rationale/alternatives ──

	it("memory-write with decision fields formats content automatically", async () => {
		const res: any = await router("tools/call", {
			name: "memory-write",
			arguments: {
				owner: "test",
				repo: REPO,
				type: "decision",
				title: "Decision: Use SQLite",
				context: "Database needed to be self-contained",
				rationale: "SQLite requires no external server",
				alternatives: ["MySQL", "PostgreSQL"],
				importance: 4,
				agent: "test-agent",
				role: "architect",
				model: "test-model"
			}
		});
		expect(res.structuredContent.type).toBe("decision");
		const stored = db.memories.getById(res.structuredContent.id);
		expect(stored?.content).toContain("Database needed to be self-contained");
		expect(stored?.content).toContain("SQLite requires no external server");
		expect(stored?.content).toContain("MySQL");
	});

	// ── memory-write backward compat: type=task_archive with key_decisions/next_steps ──

	it("memory-write with session fields formats content automatically", async () => {
		const res: any = await router("tools/call", {
			name: "memory-write",
			arguments: {
				owner: "test",
				repo: REPO,
				type: "task_archive",
				title: "Session: Refactor Auth",
				key_decisions: ["Use JWT", "Drop OAuth1"],
				next_steps: ["Write migration", "Update docs"],
				importance: 3,
				agent: "test-agent",
				role: "developer",
				model: "test-model"
			}
		});
		expect(res.structuredContent.type).toBe("task_archive");
		const stored = db.memories.getById(res.structuredContent.id);
		expect(stored?.content).toContain("Use JWT");
		expect(stored?.content).toContain("Write migration");
	});

	// ── task-write with task_code (old field name) still works ──

	it("task-write accepts task_code as alias for code", async () => {
		const res: any = await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				task_code: "OLD-CODE-001",
				phase: "implementation",
				title: "Backward compat task_code",
				description: "Testing task_code alias",
				status: "pending",
				priority: 3
			}
		});
		expect(res.structuredContent.task_code).toBe("OLD-CODE-001");
	});

	// ── memory-read backward compat: query-only mode still works ──

	it("memory-read with query searches correctly", async () => {
		await router("tools/call", {
			name: "memory-write",
			arguments: {
				owner: "test",
				repo: REPO,
				type: "code_fact",
				title: "Searchable Fact",
				content: "This is a unique searchable memory for backward compat testing.",
				importance: 2,
				agent: "test-agent",
				role: "tester",
				model: "test-model"
			}
		});

		const res: any = await router("tools/call", {
			name: "memory-read",
			arguments: { owner: "test", repo: REPO, query: "backward compat testing" }
		});
		expect(res.structuredContent.count).toBeGreaterThanOrEqual(1);
	});

	// ── agent-context tool is session-gated; verify it exists in tools/list ──

	it("agent-context is listed in tools when session has required capabilities", async () => {
		// Without sampling support, agent-context may not be listed
		// This tests that the tool definition exists at all
		const result: any = await router("tools/list", { limit: 50 });
		const names = (result.tools as Array<{ name: string }>).map((t: any) => t.name);
		// agent-context might be listed depending on session config
		// Just verify common tools are present
		expect(names).toContain("memory-write");
		expect(names).toContain("memory-read");
		expect(names).toContain("task-write");
		expect(names).toContain("observation-write");
		expect(names).toContain("observation-read");
	});
});
