import { beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "../router";
import { createSessionContext } from "../session";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";
import { getPrimaryTextContent } from "../utils/mcp-response";

describe("MCP handoff-write, handoff-read, and claim-manage tools", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: Record<string, unknown>) => Promise<any>;

	const REPO = "handoff-tools-repo";

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

	it("creates and lists handoffs via MCP tools", async () => {
		const task = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				code: "HANDOFF-101",
				phase: "implementation",
				title: "Handoff target task",
				description: "Task used to validate handoff-write.",
				status: "pending",
				priority: 3
			}
		});

		const createRes = await router("tools/call", {
			name: "handoff-write",
			arguments: {
				repo: REPO,
				owner: "test",
				from_agent: "agent-a",
				to_agent: "agent-b",
				task_code: "HANDOFF-101",
				summary: "Continue implementing the MCP surface",
				context: { file: "src/mcp/router.ts" }
			}
		});

		expect(createRes.structuredContent.from_agent).toBe("agent-a");
		expect(createRes.structuredContent.to_agent).toBe("agent-b");
		expect(createRes.structuredContent.task_id).toBe(task.structuredContent.id);

		const listRes = await router("tools/call", {
			name: "handoff-read",
			arguments: {
				repo: REPO,
				owner: "test",
				to_agent: "agent-b"
			}
		});

		expect(listRes.structuredContent.schema).toBe("handoff-read");
		expect(listRes.structuredContent.mode).toBe("list");
		expect(listRes.structuredContent.count).toBe(1);
		expect(listRes.structuredContent.handoffs.rows[0][1]).toBe("agent-a");
		expect(listRes.structuredContent.handoffs.rows[0][4]).toBe("HANDOFF-101");
		expect(listRes.structuredContent.handoffs.rows[0][10]).toEqual({ file: "src/mcp/router.ts" });
	});

	it("handoff-read treats empty-string id/query as absent (list, not detail/search)", async () => {
		const res = await router("tools/call", {
			name: "handoff-read",
			arguments: { repo: REPO, owner: "test", id: "", query: "" }
		});

		expect(res.isError).toBeFalsy();
		expect(res.structuredContent.schema).toBe("handoff-read");
		expect(res.structuredContent.mode).toBe("list");
	});

	it("rejects completion-summary handoffs without transfer context", async () => {
		const res = await router("tools/call", {
			name: "handoff-write",
			arguments: {
				repo: REPO,
				owner: "test",
				from_agent: "agent-a",
				summary: "Completed implementation and tests"
			}
		});
		expect(res.isError).toBe(true);
		expect(getPrimaryTextContent(res)).toContain("completed-work summaries");
	});

	it("updates handoff status so stale queue items can be closed", async () => {
		const createRes = await router("tools/call", {
			name: "handoff-write",
			arguments: {
				repo: REPO,
				owner: "test",
				from_agent: "agent-a",
				summary: "Blocked waiting for API contract",
				context: { blockers: ["API contract missing"] }
			}
		});

		const updateRes = await router("tools/call", {
			name: "handoff-write",
			arguments: {
				id: createRes.structuredContent.id,
				status: "expired"
			}
		});

		expect(updateRes.structuredContent.success).toBe(true);
		expect(updateRes.structuredContent.status).toBe("expired");
	});

	// FIX-023: handoff-read displays an 8-char id prefix in list output; a
	// client copying that prefix back into handoff-read/handoff-write must
	// resolve it rather than failing with "Handoff not found".
	describe("short-id prefix resolution (FIX-023)", () => {
		it("positive: handoff-read detail resolves the 8-char prefix shown in the list", async () => {
			const createRes = await router("tools/call", {
				name: "handoff-write",
				arguments: {
					repo: REPO,
					owner: "test",
					from_agent: "agent-a",
					to_agent: "agent-b",
					summary: "Detail by short id prefix",
					context: { next_steps: ["Resolve the prefix"] }
				}
			});
			const fullId = createRes.structuredContent.id as string;
			const prefix = fullId.slice(0, 8);

			const detailRes = await router("tools/call", {
				name: "handoff-read",
				arguments: { repo: REPO, owner: "test", id: prefix }
			});

			expect(detailRes.isError).toBeFalsy();
			expect(detailRes.structuredContent.schema).toBe("handoff-read");
			expect(detailRes.structuredContent.mode).toBe("detail");
			expect(detailRes.structuredContent.id).toBe(fullId);
			expect(detailRes.structuredContent.summary).toBe("Detail by short id prefix");
			// The rendered summary uses the canonical id prefix.
			expect(getPrimaryTextContent(detailRes)).toContain(`[${prefix}]`);
		});

		it("positive: full-UUID detail lookup is unchanged", async () => {
			const createRes = await router("tools/call", {
				name: "handoff-write",
				arguments: {
					repo: REPO,
					owner: "test",
					from_agent: "agent-a",
					summary: "Detail by full uuid",
					context: { blockers: ["none"] }
				}
			});
			const fullId = createRes.structuredContent.id as string;

			const detailRes = await router("tools/call", {
				name: "handoff-read",
				arguments: { repo: REPO, owner: "test", id: fullId }
			});
			expect(detailRes.isError).toBeFalsy();
			expect(detailRes.structuredContent.id).toBe(fullId);
		});

		it("positive: handoff-write accepts/updates status by the short id prefix", async () => {
			const createRes = await router("tools/call", {
				name: "handoff-write",
				arguments: {
					repo: REPO,
					owner: "test",
					from_agent: "agent-a",
					to_agent: "agent-b",
					summary: "Accept by short id prefix",
					context: { next_steps: ["Ship it"] }
				}
			});
			const fullId = createRes.structuredContent.id as string;
			const prefix = fullId.slice(0, 8);

			const updateRes = await router("tools/call", {
				name: "handoff-write",
				arguments: { id: prefix, status: "accepted" }
			});

			expect(updateRes.isError).toBeFalsy();
			expect(updateRes.structuredContent.success).toBe(true);
			expect(updateRes.structuredContent.status).toBe("accepted");
			expect(updateRes.structuredContent.id).toBe(fullId);
			expect(db.handoffs.getHandoffById(fullId)?.status).toBe("accepted");
		});

		it("negative: an unknown prefix returns a not-found error", async () => {
			const res = await router("tools/call", {
				name: "handoff-read",
				arguments: { repo: REPO, owner: "test", id: "deadbeef" }
			});
			expect(res.isError).toBe(true);
			expect(getPrimaryTextContent(res)).toContain("Handoff not found: deadbeef");
		});

		it("negative: an ambiguous prefix returns a clear ambiguity error naming matches", async () => {
			const a = "feed0001-1111-4111-8111-111111111111";
			const b = "feed0001-2222-4222-8222-222222222222";
			const NOW = "2024-01-01T00:00:00.000Z";
			for (const id of [a, b]) {
				db.db
					.prepare(
						`INSERT INTO handoffs (id, owner, repo, from_agent, to_agent, task_id, summary, context, status, created_at, updated_at, expires_at)
						 VALUES (?, 'test', ?, 'agent-a', NULL, NULL, 'seeded', '{}', 'pending', ?, ?, NULL)`
					)
					.run(id, REPO, NOW, NOW);
			}

			const res = await router("tools/call", {
				name: "handoff-read",
				arguments: { repo: REPO, owner: "test", id: "feed0001" }
			});

			expect(res.isError).toBe(true);
			const text = getPrimaryTextContent(res);
			expect(text).toContain("Ambiguous handoff id");
			expect(text).toContain(a);
			expect(text).toContain(b);
			expect(res.structuredContent.code).toBe("AMBIGUOUS_ID");
		});

		it("negative: an ambiguous prefix blocks handoff-write status updates", async () => {
			const a = "beef0001-1111-4111-8111-111111111111";
			const b = "beef0001-2222-4222-8222-222222222222";
			const NOW = "2024-01-01T00:00:00.000Z";
			for (const id of [a, b]) {
				db.db
					.prepare(
						`INSERT INTO handoffs (id, owner, repo, from_agent, to_agent, task_id, summary, context, status, created_at, updated_at, expires_at)
						 VALUES (?, 'test', ?, 'agent-a', NULL, NULL, 'seeded', '{}', 'pending', ?, ?, NULL)`
					)
					.run(id, REPO, NOW, NOW);
			}

			const res = await router("tools/call", {
				name: "handoff-write",
				arguments: { id: "beef0001", status: "accepted" }
			});

			expect(res.isError).toBe(true);
			expect(getPrimaryTextContent(res)).toContain("Ambiguous handoff id");
			// No row was mutated by the ambiguous update.
			expect(db.handoffs.getHandoffById(a)?.status).toBe("pending");
			expect(db.handoffs.getHandoffById(b)?.status).toBe("pending");
		});
	});

	it("claims a task by task_code via MCP tool", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				code: "CLAIM-101",
				phase: "implementation",
				title: "Claimable task",
				description: "Task used to validate claim-manage.",
				status: "pending",
				priority: 3
			}
		});

		const claimRes = await router("tools/call", {
			name: "claim-manage",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "CLAIM-101",
				agent: "agent-claim",
				role: "worker",
				metadata: { lane: "handoff" }
			}
		});

		expect(claimRes.structuredContent.task_code).toBe("CLAIM-101");
		expect(claimRes.structuredContent.agent).toBe("agent-claim");
		expect(claimRes.structuredContent.role).toBe("worker");
		expect(claimRes.structuredContent.metadata).toEqual({ lane: "handoff" });

		const listRes = await router("tools/call", {
			name: "claim-manage",
			arguments: {
				repo: REPO,
				owner: "test",
				query: ""
			}
		});

		expect(listRes.structuredContent.schema).toBe("claim-manage");
		expect(listRes.structuredContent.count).toBe(1);
		expect(listRes.structuredContent.claims.rows[0][2]).toBe("CLAIM-101");
	});

	it("releases an active claim by task_code", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				code: "CLAIM-RELEASE-101",
				phase: "implementation",
				title: "Releasable task",
				description: "Task used to validate claim-manage release mode.",
				status: "pending",
				priority: 3
			}
		});

		await router("tools/call", {
			name: "claim-manage",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "CLAIM-RELEASE-101",
				agent: "agent-release",
				role: "worker"
			}
		});

		const releaseRes = await router("tools/call", {
			name: "claim-manage",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "CLAIM-RELEASE-101",
				agent: "agent-release",
				release: true
			}
		});

		expect(releaseRes.structuredContent.success).toBe(true);
		expect(releaseRes.structuredContent.task_code).toBe("CLAIM-RELEASE-101");
	});

	it("auto-releases active claims and expires linked pending handoffs when a task completes", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				code: "CLEANUP-101",
				phase: "implementation",
				title: "Cleanup coordination task",
				description: "Task used to validate automatic coordination cleanup.",
				status: "pending",
				priority: 3
			}
		});

		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				code: "CLEANUP-101",
				status: "in_progress",
				comment: "Starting cleanup validation.",
				agent: "agent-claim"
			}
		});

		const claimRes = await router("tools/call", {
			name: "claim-manage",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "CLEANUP-101",
				agent: "agent-claim",
				role: "worker"
			}
		});

		const handoffRes = await router("tools/call", {
			name: "handoff-write",
			arguments: {
				repo: REPO,
				owner: "test",
				from_agent: "agent-claim",
				task_code: "CLEANUP-101",
				summary: "Continue cleanup validation if blocked",
				context: { remaining_work: "Validate automatic cleanup behavior" }
			}
		});

		const completeRes = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				code: "CLEANUP-101",
				status: "completed",
				comment: "Validated cleanup behavior.",
				agent: "agent-claim",
				est_tokens: 25
			}
		});

		expect(completeRes.structuredContent.coordinationCleanup).toEqual({
			releasedClaims: 1,
			expiredHandoffs: 1
		});
		expect(db.handoffs.getClaim(claimRes.structuredContent.task_id)).toBeNull();
		expect(db.handoffs.getHandoffById(handoffRes.structuredContent.id)?.status).toBe("expired");
	});

	it("auto-comments on create with task_id", async () => {
		const task = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				code: "AUTO-001",
				phase: "implementation",
				title: "Auto-comment create task",
				description: "Task for create comment test.",
				status: "pending",
				priority: 3
			}
		});

		await router("tools/call", {
			name: "handoff-write",
			arguments: {
				repo: REPO,
				owner: "test",
				from_agent: "agent-a",
				to_agent: "agent-b",
				task_code: "AUTO-001",
				summary: "Review PR for autocomplete",
				context: { next_steps: ["Check edge cases", "Write tests"] }
			}
		});

		const comments = db.taskComments.getTaskCommentsByTaskId(task.structuredContent.id);
		expect(comments).toHaveLength(1);
		expect(comments[0].comment).toContain("Handoff [");
		expect(comments[0].comment).toContain("] created: agent-a → agent-b — Review PR for autocomplete");
		expect(comments[0].agent).toBe("agent-a");
		expect(comments[0].role).toBe("unknown");
		expect(comments[0].model).toBe("system");
		expect(comments[0].previous_status).toBeNull();
		expect(comments[0].next_status).toBeNull();
	});

	it("does not auto-comment on create without task_id", async () => {
		const createRes = await router("tools/call", {
			name: "handoff-write",
			arguments: {
				repo: REPO,
				owner: "test",
				from_agent: "agent-x",
				summary: "Blocked waiting for design review",
				context: { blockers: ["Design review pending"] }
			}
		});

		expect(createRes.structuredContent.task_id).toBeNull();
		// No task ID means no comment — verify no explosion by asserting
		// structuredContent came back clean
		expect(createRes.structuredContent.status).toBe("pending");
	});

	it("auto-comments on accepted with next_steps payload", async () => {
		const task = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				code: "AUTO-002",
				phase: "implementation",
				title: "Auto-comment accept task",
				description: "Task for accept comment test.",
				status: "pending",
				priority: 3
			}
		});

		const createRes = await router("tools/call", {
			name: "handoff-write",
			arguments: {
				repo: REPO,
				owner: "test",
				from_agent: "agent-a",
				to_agent: "agent-b",
				task_code: "AUTO-002",
				summary: "Continue API implementation",
				context: { next_steps: ["Implement auth", "Add tests", "Update docs"] }
			}
		});

		await router("tools/call", {
			name: "handoff-write",
			arguments: {
				id: createRes.structuredContent.id,
				status: "accepted"
			}
		});

		const comments = db.taskComments.getTaskCommentsByTaskId(task.structuredContent.id);
		expect(comments).toHaveLength(2); // create + accept
		const acceptComment = comments.find((c) => c.comment.includes("accepted"));
		expect(acceptComment).toBeDefined();
		expect(acceptComment!.comment).toContain("accepted by agent-b.");
		expect(acceptComment!.comment).toContain("Next steps: Implement auth; Add tests; Update docs");
	});

	it("auto-comments on rejected with one-line comment", async () => {
		const task = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				code: "AUTO-003",
				phase: "implementation",
				title: "Auto-comment reject task",
				description: "Task for reject comment test.",
				status: "pending",
				priority: 3
			}
		});

		const createRes = await router("tools/call", {
			name: "handoff-write",
			arguments: {
				repo: REPO,
				owner: "test",
				from_agent: "agent-a",
				task_code: "AUTO-003",
				summary: "Fix null pointer in parser",
				context: { remaining_work: "Parser fix" }
			}
		});

		await router("tools/call", {
			name: "handoff-write",
			arguments: {
				id: createRes.structuredContent.id,
				status: "rejected"
			}
		});

		const comments = db.taskComments.getTaskCommentsByTaskId(task.structuredContent.id);
		const rejectComment = comments.find((c) => c.comment.includes("rejected"));
		expect(rejectComment).toBeDefined();
		expect(rejectComment!.comment).toContain("Handoff [");
		expect(rejectComment!.comment).toContain("] rejected");
		// One-liner: should not contain "Next steps" or "accepted by"
		expect(rejectComment!.comment).not.toContain("Next steps");
		expect(rejectComment!.comment).not.toContain("accepted by");
	});

	it("does not auto-comment on no-op update (same status)", async () => {
		const task = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				code: "AUTO-004",
				phase: "implementation",
				title: "Auto-comment noop task",
				description: "Task for no-op comment test.",
				status: "pending",
				priority: 3
			}
		});

		const createRes = await router("tools/call", {
			name: "handoff-write",
			arguments: {
				repo: REPO,
				owner: "test",
				from_agent: "agent-a",
				task_code: "AUTO-004",
				summary: "Polish UI components",
				context: { remaining_work: "UI polish" }
			}
		});

		// No-op update: pending → pending
		await router("tools/call", {
			name: "handoff-write",
			arguments: {
				id: createRes.structuredContent.id,
				status: "pending"
			}
		});

		const comments = db.taskComments.getTaskCommentsByTaskId(task.structuredContent.id);
		// Only the create comment, no second comment for the no-op
		expect(comments).toHaveLength(1);
		expect(comments[0].comment).toContain("created:");
	});

	it("does not auto-comment on update without task_id", async () => {
		const createRes = await router("tools/call", {
			name: "handoff-write",
			arguments: {
				repo: REPO,
				owner: "test",
				from_agent: "agent-x",
				summary: "Stale transfer without task link",
				context: { blockers: ["No task linked"] }
			}
		});

		const updateRes = await router("tools/call", {
			name: "handoff-write",
			arguments: {
				id: createRes.structuredContent.id,
				status: "expired"
			}
		});

		expect(updateRes.structuredContent.success).toBe(true);
		expect(updateRes.structuredContent.status).toBe("expired");
	});

	// FIX-CLAIM-AGENT-INJECT: a session-bearing client (lastSeenAgent = its
	// client name) must not have that name injected into `agent` for tools
	// where `agent` is a filter/discriminator. Reproduces the production
	// failure: client `opencode` releasing a claim held by `backend` reported
	// "No active claim found" (masked as "Internal tool error"), and every
	// handoff list/search silently returned 0 claims for `opencode`.
	describe("session agent injection does not corrupt agent-semantic tools", () => {
		let sessionRouter: (method: string, params: Record<string, unknown>) => Promise<any>;

		beforeEach(() => {
			const session = createSessionContext("http");
			session.lastSeenAgent = "opencode";
			session.clientName = "opencode";
			const raw = createRouter(db, vectors, { getSessionContext: () => session });
			sessionRouter = async (method, params) => {
				const args = (params as Record<string, unknown>)?.arguments as Record<string, unknown> | undefined;
				if (method === "tools/call" && args) {
					args.json = true;
				}
				return raw(method, params);
			};
		});

		it("releases a claim held by a DIFFERENT agent when the caller omits agent", async () => {
			await sessionRouter("tools/call", {
				name: "task-write",
				arguments: {
					repo: REPO,
					owner: "test",
					code: "AGENT-INJECT-1",
					phase: "implementation",
					title: "Agent injection target",
					description: "Task used to validate release across agents.",
					status: "pending",
					priority: 3
				}
			});

			await sessionRouter("tools/call", {
				name: "claim-manage",
				arguments: { repo: REPO, owner: "test", task_code: "AGENT-INJECT-1", agent: "backend", role: "worker" }
			});

			// No `agent` → release ANY active claim for the task (not just the
			// caller's own). Before the fix this threw "No active claim found".
			const releaseRes = await sessionRouter("tools/call", {
				name: "claim-manage",
				arguments: { repo: REPO, owner: "test", task_code: "AGENT-INJECT-1", release: true }
			});

			expect(releaseRes.isError).toBeFalsy();
			expect(releaseRes.structuredContent.success).toBe(true);
			expect(releaseRes.structuredContent.task_code).toBe("AGENT-INJECT-1");
		});

		it("keeps handoff-read in handoff-list mode (no LIST-CLAIMS hijack)", async () => {
			await sessionRouter("tools/call", {
				name: "task-write",
				arguments: {
					repo: REPO,
					owner: "test",
					code: "AGENT-INJECT-2",
					phase: "implementation",
					title: "Handoff read target",
					description: "Task used to validate handoff-read mode.",
					status: "pending",
					priority: 3
				}
			});

			await sessionRouter("tools/call", {
				name: "handoff-write",
				arguments: {
					repo: REPO,
					owner: "test",
					from_agent: "agent-a",
					to_agent: "agent-b",
					task_code: "AGENT-INJECT-2",
					summary: "Handoff that must remain listable"
				}
			});

			const listRes = await sessionRouter("tools/call", {
				name: "handoff-read",
				arguments: { repo: REPO, owner: "test" }
			});

			expect(listRes.structuredContent.schema).toBe("handoff-read");
			expect(listRes.structuredContent.mode).toBe("list");
			expect(listRes.structuredContent.count).toBe(1);
		});
	});
});
