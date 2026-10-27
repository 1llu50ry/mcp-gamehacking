import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";
import { McpResponse, getPrimaryTextContent } from "../utils/mcp-response";

vi.setConfig({ testTimeout: 30000 });

// ─── task-read / task-delete E2E ──────────────────────────────────────────
// Split out from tasks.e2e.test.ts (the "read + delete" half of the
// consolidated e2e suite) to keep that file within the 500-line limit.
// Setup mirrors the original describe: createTestStore + StubVectorStore +
// json:true router wrapper.

describe("MCP Local Memory - Consolidated Task Tools E2E (read + delete)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: unknown) => Promise<McpResponse>;

	const REPO = "workflow-test-repo";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
		const rawRouter = createRouter(db, vectors);
		router = async (method, params) => {
			const args = (params as Record<string, unknown>)?.arguments as Record<string, unknown> | undefined;
			if (method === "tools/call" && args) {
				args.json = true;
			}
			return rawRouter(method, params as any) as any;
		};
	});

	it("should read task detail by id via task-read", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "DETAIL-001",
				phase: "testing",
				title: "Detail by ID Test",
				description: "Testing task-read detail mode with id",
				status: "pending",
				priority: 3,
				est_tokens: 50
			}
		});

		const taskId = db.tasks.getTaskByCode("test", REPO, "DETAIL-001")?.id;
		expect(taskId).toBeDefined();

		const res = await router("tools/call", {
			name: "task-read",
			arguments: {
				owner: "test",
				repo: REPO,
				id: taskId,
				json: true
			}
		});

		const data = res.structuredContent as Record<string, unknown>;
		expect(data.task_code).toBe("DETAIL-001");
		expect(data.title).toBe("Detail by ID Test");
		expect(data.status).toBe("pending");
	});

	it("should read task detail by task_code via task-read", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "DETAIL-002",
				phase: "testing",
				title: "Detail by Code Test",
				description: "Testing task-read detail mode with task_code",
				status: "pending",
				priority: 4,
				est_tokens: 60
			}
		});

		const res = await router("tools/call", {
			name: "task-read",
			arguments: {
				owner: "test",
				repo: REPO,
				task_code: "DETAIL-002",
				json: true
			}
		});

		const data = res.structuredContent as Record<string, unknown>;
		expect(data.task_code).toBe("DETAIL-002");
		expect(data.title).toBe("Detail by Code Test");
	});

	it("should search tasks by query via task-read", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "SEARCH-001",
				phase: "research",
				title: "Unicorns and Rainbows",
				description: "Searchable task with unique terms",
				status: "pending",
				priority: 3,
				est_tokens: 40
			}
		});

		const res = await router("tools/call", {
			name: "task-read",
			arguments: {
				owner: "test",
				repo: REPO,
				query: "Unicorns",
				json: true
			}
		});

		const data = res.structuredContent as { results: { rows: unknown[][] } };
		expect(data.results.rows.length).toBeGreaterThanOrEqual(1);
		const codes = data.results.rows.map((r: unknown[]) => r[1]);
		expect(codes).toContain("SEARCH-001");
	});

	// ─── task-read auto-infer mode detection ──────────────────────────

	it("task-read auto-infers DETAIL when id is present", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "AUTO-ID",
				phase: "testing",
				title: "Auto-infer detail by id",
				description: "Testing auto-infer detail mode.",
				status: "pending",
				priority: 3,
				est_tokens: 30
			}
		});
		const task = db.tasks.getTaskByCode("test", REPO, "AUTO-ID")!;
		expect(task).toBeDefined();

		const res: any = await router("tools/call", {
			name: "task-read",
			arguments: { owner: "test", repo: REPO, id: task.id }
		});
		expect(res.structuredContent.id).toBe(task.id);
		expect(res.structuredContent.task_code).toBe("AUTO-ID");
	});

	it("task-read auto-infers DETAIL when code is present", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "AUTO-CODE",
				phase: "testing",
				title: "Auto-infer detail by code",
				description: "Testing auto-infer by code.",
				status: "pending",
				priority: 3,
				est_tokens: 30
			}
		});
		const res: any = await router("tools/call", {
			name: "task-read",
			arguments: { owner: "test", repo: REPO, code: "AUTO-CODE" }
		});
		expect(res.structuredContent.task_code).toBe("AUTO-CODE");
	});

	it("task-read auto-infers SEARCH when query is present", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "SEARCH-ME",
				phase: "testing",
				title: "Searchable auto-infer task",
				description: "This task should be found by auto-infer search.",
				status: "pending",
				priority: 3,
				est_tokens: 30
			}
		});
		const res: any = await router("tools/call", {
			name: "task-read",
			arguments: { owner: "test", repo: REPO, query: "auto-infer" }
		});
		expect(res.structuredContent.results.rows.length).toBeGreaterThanOrEqual(1);
	});

	it("task-read auto-infers LIST when no id/code/query present", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "LIST-ME",
				phase: "testing",
				title: "List auto-infer task",
				description: "This task appears in list mode.",
				status: "pending",
				priority: 3,
				est_tokens: 30
			}
		});
		const res: any = await router("tools/call", {
			name: "task-read",
			arguments: { owner: "test", repo: REPO, status: "all" }
		});
		expect(res.structuredContent.tasks).toBeDefined();
		expect(res.structuredContent.tasks.rows.length).toBeGreaterThanOrEqual(1);
	});

	// ─── empty-string discriminator hardening (FIX-READMODE-001) ──────
	// A serialize-all-optional-fields client sends `query: ""` for unset
	// strings. "non-empty" presence + DETAIL-before-SEARCH must keep that from
	// hijacking mode selection.

	it("task-read auto-infers DETAIL for {query:'', code} (empty query must not hijack)", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "DOC-004",
				phase: "implementation",
				title: "Empty query detail regression",
				description: "query:'' plus a non-empty code must resolve DETAIL.",
				status: "pending",
				priority: 3,
				est_tokens: 30
			}
		});

		const res: any = await router("tools/call", {
			name: "task-read",
			arguments: { owner: "test", repo: REPO, query: "", code: "DOC-004" }
		});

		expect(res.isError).toBeFalsy();
		expect(res.structuredContent.task_code).toBe("DOC-004");
		expect(res.structuredContent.results).toBeUndefined();
	});

	it("task-read auto-infers LIST for {query:'', id:'', code:''} (no DETAIL throw)", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "EMPTY-DISCRIMINATOR",
				phase: "testing",
				title: "Empty discriminators fall through to list",
				description: "All-empty identifiers must not route to DETAIL.",
				status: "pending",
				priority: 3,
				est_tokens: 30
			}
		});

		const res: any = await router("tools/call", {
			name: "task-read",
			arguments: { owner: "test", repo: REPO, query: "", id: "", code: "", status: "all" }
		});

		expect(res.isError).toBeFalsy();
		expect(res.structuredContent.tasks).toBeDefined();
		expect(res.structuredContent.tasks.rows.length).toBeGreaterThanOrEqual(1);
	});

	it("task-read gives a non-empty identifier precedence over a non-empty query", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "PRIORITY-CODE",
				phase: "testing",
				title: "Identifier precedence over query",
				description: "code must win over a non-empty query.",
				status: "pending",
				priority: 3,
				est_tokens: 30
			}
		});

		const res: any = await router("tools/call", {
			name: "task-read",
			arguments: { owner: "test", repo: REPO, query: "zzz-no-such-task", code: "PRIORITY-CODE" }
		});

		expect(res.isError).toBeFalsy();
		expect(res.structuredContent.task_code).toBe("PRIORITY-CODE");
		expect(res.structuredContent.results).toBeUndefined();
	});

	// ───────────────────────────────────────────────────────────────────

	it("should list tasks by phase via task-read", async () => {
		// Create a task first so we have something to list
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "PHASE-001",
				phase: "research",
				title: "Phase Listing Test",
				description: "Testing task-read phase listing",
				status: "pending",
				priority: 3,
				est_tokens: 40
			}
		});

		const res = await router("tools/call", {
			name: "task-read",
			arguments: {
				owner: "test",
				repo: REPO,
				phase: "research",
				status: "all",
				json: true
			}
		});

		const data = res.structuredContent as { tasks: { rows: unknown[][] } };
		const codes = data.tasks.rows.map((r: unknown[]) => r[1]);
		expect(codes).toContain("PHASE-001");
	});

	it("task-delete with empty-string ids fails instead of reporting phantom success", async () => {
		// Seed a real task so a phantom cancel would be observable
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "DELETE-GUARD",
				phase: "cleanup",
				title: "Phantom delete guard",
				description: "Empty-string ids must never cancel this task",
				status: "pending",
				priority: 3
			}
		});
		const before = db.tasks.getTasksByRepo("test", REPO);

		// Empty-string item in ids must be rejected by the schema (TASK-123) —
		// previously `{ ids: [""] }` collapsed to "" and reported
		// canceledCount:1 without deleting anything (phantom success). The
		// transport converts the thrown ZodError into the canonical isError
		// envelope (OPT-CODE-01), preserving the `Error:` message text.
		const emptyIdsRes = await router("tools/call", {
			name: "task-delete",
			arguments: { owner: "test", repo: REPO, ids: [""] }
		});
		expect(emptyIdsRes.isError).toBe(true);
		expect(getPrimaryTextContent(emptyIdsRes)).toContain("Error:");

		// Nothing may have been canceled by the failed delete
		const after = db.tasks.getTasksByRepo("test", REPO);
		expect(after).toHaveLength(before.length);
		expect(after.every((task) => task.status !== "canceled")).toBe(true);

		// Non-empty but unresolvable identifiers must also fail loudly
		// (resolveIdentifier restore of pre-TASK-111 behavior) instead of
		// collapsing to "" and reporting a phantom cancel. The transport turns
		// the throw into the canonical isError envelope (OPT-CODE-01).
		const res = await router("tools/call", {
			name: "task-delete",
			arguments: { owner: "test", repo: REPO, ids: ["MISSING-TASK-CODE"] }
		});
		expect(res.isError).toBe(true);
		expect(getPrimaryTextContent(res)).toContain("Task not found: MISSING-TASK-CODE");

		const afterMissing = db.tasks.getTasksByRepo("test", REPO);
		expect(afterMissing).toHaveLength(before.length);
		expect(afterMissing.every((task) => task.status !== "canceled")).toBe(true);
	});
});
