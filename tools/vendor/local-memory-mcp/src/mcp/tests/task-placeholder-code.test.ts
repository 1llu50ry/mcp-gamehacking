import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";
import { getPrimaryTextContent } from "../utils/mcp-response";

/**
 * FIX-021 integration — task-read / task-write / claim-manage must reject the
 * reserved orchestrator template placeholders (T01/R01/Q01/…) with an
 * actionable VALIDATION_ERROR, while genuinely unknown real codes keep the
 * normal not-found and valid codes are unaffected.
 */
describe("task-read/write/claim-manage placeholder codes (FIX-021)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: Record<string, unknown>) => Promise<any>;

	const REPO = "placeholder-code-repo";
	const OWNER = "test";

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

	async function createTask(code: string, title = "Placeholder test task") {
		return router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: OWNER,
				code,
				phase: "fix",
				title,
				description: "Task used to exercise placeholder-code handling.",
				status: "pending",
				priority: 3
			}
		});
	}

	// ── task-read ────────────────────────────────────────────────────────

	it("positive: task-read(code: 'T01') returns a VALIDATION_ERROR naming the placeholder", async () => {
		const res = await router("tools/call", {
			name: "task-read",
			arguments: { repo: REPO, owner: OWNER, code: "T01" }
		});
		expect(res.isError).toBe(true);
		expect(res.structuredContent).toMatchObject({ code: "VALIDATION_ERROR", retryable: false });
		expect(getPrimaryTextContent(res)).toContain("'T01'");
		expect(getPrimaryTextContent(res)).toContain("unsubstituted orchestrator template placeholder");
		expect(getPrimaryTextContent(res)).not.toContain("Task not found: T01");
	});

	it("positive: task-read(code: 'R01') and (code: 'Q01') are rejected the same way", async () => {
		for (const code of ["R01", "Q01"]) {
			const res = await router("tools/call", {
				name: "task-read",
				arguments: { repo: REPO, owner: OWNER, code }
			});
			expect(res.isError).toBe(true);
			expect(res.structuredContent).toMatchObject({ code: "VALIDATION_ERROR" });
			expect(getPrimaryTextContent(res)).toContain(`'${code}'`);
		}
	});

	it("negative: a genuinely unknown real code keeps the normal not-found", async () => {
		const res = await router("tools/call", {
			name: "task-read",
			arguments: { repo: REPO, owner: OWNER, code: "TASK-99999" }
		});
		expect(res.isError).toBe(true);
		expect(res.structuredContent).toMatchObject({ code: "NOT_FOUND" });
		expect(getPrimaryTextContent(res)).toContain("Task not found: TASK-99999");
	});

	it("negative (control): a valid code still resolves successfully", async () => {
		const created = await createTask("TASK-001");
		const res = await router("tools/call", {
			name: "task-read",
			arguments: { repo: REPO, owner: OWNER, code: "TASK-001" }
		});
		expect(res.isError).toBeFalsy();
		expect(res.structuredContent.id).toBe(created.structuredContent.id);
		expect(res.structuredContent.task_code).toBe("TASK-001");
	});

	// ── task-write ───────────────────────────────────────────────────────

	it("positive: task-write(code: 'T01') update is rejected with VALIDATION_ERROR", async () => {
		const res = await router("tools/call", {
			name: "task-write",
			arguments: { repo: REPO, owner: OWNER, code: "T01", comment: "orchestrator context" }
		});
		expect(res.isError).toBe(true);
		expect(res.structuredContent).toMatchObject({ code: "VALIDATION_ERROR" });
		expect(getPrimaryTextContent(res)).toContain("'T01'");
	});

	it("positive: task-write(id: 'R01') placeholder in the id slot is rejected too", async () => {
		const res = await router("tools/call", {
			name: "task-write",
			arguments: { repo: REPO, owner: OWNER, id: "R01", comment: "orchestrator context" }
		});
		expect(res.isError).toBe(true);
		expect(res.structuredContent).toMatchObject({ code: "VALIDATION_ERROR" });
		expect(getPrimaryTextContent(res)).toContain("'R01'");
	});

	it("negative: task-write(code: 'TASK-99999') keeps the normal not-found", async () => {
		const res = await router("tools/call", {
			name: "task-write",
			arguments: { repo: REPO, owner: OWNER, code: "TASK-99999", comment: "no such task" }
		});
		expect(res.isError).toBe(true);
		expect(res.structuredContent).toMatchObject({ code: "NOT_FOUND" });
		expect(getPrimaryTextContent(res)).toContain("Task not found: TASK-99999");
	});

	// ── claim-manage ─────────────────────────────────────────────────────

	it("positive: claim-manage(task_code: 'T01', agent) is rejected with VALIDATION_ERROR", async () => {
		const res = await router("tools/call", {
			name: "claim-manage",
			arguments: { repo: REPO, owner: OWNER, task_code: "T01", agent: "agent-a" }
		});
		expect(res.isError).toBe(true);
		expect(res.structuredContent).toMatchObject({ code: "VALIDATION_ERROR" });
		expect(getPrimaryTextContent(res)).toContain("'T01'");
	});

	it("negative: claim-manage against a valid task still succeeds", async () => {
		await createTask("TASK-002");
		const res = await router("tools/call", {
			name: "claim-manage",
			arguments: { repo: REPO, owner: OWNER, task_code: "TASK-002", agent: "agent-a" }
		});
		expect(res.isError).toBeFalsy();
		expect(res.structuredContent.agent).toBe("agent-a");
		expect(res.structuredContent.task_code).toBe("TASK-002");
	});
});
