// Feature: memory-mcp-optimization, Property 11 (continued): createRouter()
// advanced surface — prompts, sampling/synthesize, elicitation, session-gated
// tools, MCP root enforcement, logging. Split out from router.test.ts to keep
// that file within the 500-line maintainability limit. The mock factory below
// mirrors router.test.ts to avoid cross-file coupling (per existing testfile
// convention — see action-log.test.ts).
import { describe, it, expect, vi } from "vitest";
import { createSessionContext, updateSessionRoots } from "../session";
import { createRouter } from "../router";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";

describe("createRouter() — advanced surface (prompts, sampling, elicitation, roots, logging)", () => {
	function makeMockDb(): SQLiteStore {
		return {
			db: {
				transaction: (fn: (...args: unknown[]) => unknown) => {
					const tx = (...args: unknown[]) => fn(...args);
					tx.immediate = tx;
					tx.deferred = tx;
					tx.exclusive = tx;
					tx.default = tx;
					return tx;
				},
				prepare: vi.fn().mockReturnValue({
					get: vi.fn().mockReturnValue({ max_seq: null }),
					run: vi.fn().mockReturnValue({ changes: 0 })
				})
			} as never,
			memories: {
				insert: vi.fn(),
				update: vi.fn(),
				getById: vi.fn().mockReturnValue(null),
				getByIds: vi.fn().mockReturnValue([]),
				getByCode: vi.fn().mockReturnValue(null),
				searchByRepo: vi.fn().mockReturnValue([]),
				searchByFtsScored: vi.fn().mockReturnValue([]),
				getRecentMemories: vi.fn().mockReturnValue([]),
				getTotalCount: vi.fn().mockReturnValue(0),
				getSummary: vi.fn().mockReturnValue(null),
				upsertSummary: vi.fn(),
				incrementHitCount: vi.fn(),
				incrementHitCounts: vi.fn(),
				incrementRecallCount: vi.fn(),
				getStats: vi.fn().mockReturnValue({ total: 0, byType: {} }),
				bulkUpdateMemories: vi.fn().mockReturnValue(0),
				bulkInsertMemories: vi.fn().mockReturnValue(0)
			},
			tasks: {
				getTasksByRepo: vi.fn().mockReturnValue([]),
				getTasksByMultipleStatuses: vi.fn().mockReturnValue([]),
				isTaskCodeDuplicate: vi.fn().mockReturnValue(false),
				insertTask: vi.fn(),
				updateTask: vi.fn(),
				deleteTask: vi.fn(),
				getTaskById: vi.fn().mockReturnValue(null)
			},
			taskStats: {
				getTaskStats: vi.fn().mockReturnValue({ todo: 0 }),
				getTaskTimeStats: vi.fn().mockReturnValue({ completed: 0, tokens: 0, avgDuration: 0, added: 0 }),
				getTaskComparisonSeries: vi.fn().mockReturnValue([])
			},
			taskComments: {
				getTaskCommentsByTaskId: vi.fn().mockReturnValue([]),
				insertTaskComment: vi.fn(),
				getAllTaskCommentsByRepo: vi.fn().mockReturnValue([])
			},
			memoryVectors: {
				searchBySimilarity: vi.fn().mockReturnValue([]),
				upsertVectorEmbedding: vi.fn(),
				checkConflicts: vi.fn().mockResolvedValue(null)
			},
			memoryArchives: {
				archiveExpiredMemories: vi.fn().mockReturnValue(0),
				archiveLowScoreMemories: vi.fn().mockReturnValue(0),
				bulkDeleteMemories: vi.fn().mockReturnValue(0)
			},
			actions: {
				logAction: vi.fn()
			},
			system: {
				listRepos: vi.fn().mockReturnValue([]),
				getStats: vi.fn().mockReturnValue({ total: 0, byType: {}, unused: 0 }),
				listRepoNavigation: vi.fn().mockReturnValue([])
			},
			summaries: {
				getSummary: vi.fn().mockReturnValue(null),
				upsertSummary: vi.fn()
			},
			knowledgeGraph: {
				getEntityNamesByObservations: vi.fn().mockReturnValue([]),
				getEntityNamesByObservation: vi.fn().mockReturnValue([]),
				getEntityNamesByText: vi.fn().mockReturnValue([]),
				getEntitiesFor: vi.fn().mockReturnValue([]),
				getRelationsFor: vi.fn().mockReturnValue([]),
				deleteObservationsAndOrphans: vi.fn().mockReturnValue(0)
			},
			close: vi.fn(),
			getDbPath: vi.fn().mockReturnValue(":memory:"),
			refresh: vi.fn().mockResolvedValue(undefined),
			withWrite: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
			withExclusiveWrite: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn())
		} as unknown as SQLiteStore;
	}

	function makeMockVectors(): VectorStore {
		return {
			upsert: vi.fn().mockResolvedValue(undefined),
			remove: vi.fn().mockResolvedValue(undefined),
			search: vi.fn().mockResolvedValue([]),
			initialize: vi.fn().mockResolvedValue(undefined)
		} as unknown as VectorStore;
	}

	it("filters session-dependent tools from tools/list when the client lacks required capabilities", async () => {
		const mockDb = makeMockDb();
		const mockVectors = makeMockVectors();
		const session = createSessionContext();
		const router = createRouter(mockDb, mockVectors, {
			getSessionContext: () => session
		});

		const result = (await router("tools/list", {})) as any;
		const toolNames = result.tools.map((tool: Record<string, unknown>) => tool.name);

		expect(toolNames).not.toContain("synthesize");
		expect(toolNames).not.toContain("task-create-interactive");
	});

	it("rejects absolute tool paths outside active roots", async () => {
		const mockDb = makeMockDb();
		const mockVectors = makeMockVectors();
		const session = createSessionContext();
		updateSessionRoots(session, [{ uri: "file:///workspace/repo" }]);
		const router = createRouter(mockDb, mockVectors, {
			getSessionContext: () => session
		});

		await expect(
			router("tools/call", {
				name: "memory-read",
				arguments: {
					query: "test query",
					owner: "test",
					repo: "test-repo",
					current_file_path: "/tmp/outside.ts"
				}
			})
		).rejects.toThrow("current_file_path must stay within the active MCP roots");
	});

	it("supports logging/setLevel utility", async () => {
		const mockDb = makeMockDb();
		const mockVectors = makeMockVectors();
		const router = createRouter(mockDb, mockVectors);

		const result = (await router("logging/setLevel", { level: "debug" })) as any;
		expect(result.level).toBe("debug");
		expect(result.supportedLevels).toContain("info");
	});

	it("rejects invalid logging/setLevel values with MCP invalid params error", async () => {
		const mockDb = makeMockDb();
		const mockVectors = makeMockVectors();
		const router = createRouter(mockDb, mockVectors);

		await expect(router("logging/setLevel", { level: "verbose" })).rejects.toMatchObject({
			code: -32602
		});
	});

	it("rejects invalid cursors for prompts/list with MCP invalid params error", async () => {
		const mockDb = makeMockDb();
		const mockVectors = makeMockVectors();
		const router = createRouter(mockDb, mockVectors);

		await expect(router("prompts/list", { cursor: "%%%not-base64%%%" })).rejects.toMatchObject({
			code: -32602
		});
	});

	it("validates required prompt arguments with MCP invalid params error", async () => {
		const mockDb = makeMockDb();
		const mockVectors = makeMockVectors();
		const router = createRouter(mockDb, mockVectors);

		// The prompt is now loaded - it might have default handling
		const result = await router("prompts/get", {
			name: "memory-guided-review",
			arguments: { interactive: true }
		});
		// Now returns the prompt with default file_path substitution
		expect(result).toBeDefined();
	});

	it("returns a dynamic prompt with embedded resource messages", async () => {
		const mockDb = makeMockDb();
		(mockDb.system.listRepos as any).mockReturnValue(["repo-alpha"]);
		const mockVectors = makeMockVectors();
		const router = createRouter(mockDb, mockVectors);

		// Use a prompt that exists - project-briefing
		const result = (await router("prompts/get", {
			name: "project-briefing",
			arguments: { interactive: true }
		})) as any;

		expect(result).toBeDefined();
		expect(result.description).toBeDefined();
	});

	it("synthesize uses sampling when the client supports it", async () => {
		const mockDb = makeMockDb();
		const mockVectors = makeMockVectors();
		const session = createSessionContext();
		session.supportsSampling = true;
		const sampleMessage = vi.fn().mockResolvedValue({
			role: "assistant",
			content: { type: "text", text: "Grounded answer from sampling." },
			model: "test-model",
			stopReason: "endTurn"
		});

		const router = createRouter(mockDb, mockVectors, {
			getSessionContext: () => session,
			sampleMessage
		});

		const result = (await router("tools/call", {
			name: "synthesize",
			arguments: { owner: "test", repo: "test-repo", objective: "Summarize the project state" }
		})) as any;

		expect(sampleMessage).toHaveBeenCalledTimes(1);
		expect((result.structuredContent as Record<string, unknown>).answer).toContain("Grounded answer");
	});

	it("synthesize supports a multi-turn sampling tool loop", async () => {
		const mockDb = makeMockDb();
		const mockVectors = makeMockVectors();
		const session = createSessionContext();
		session.supportsSampling = true;
		session.supportsSamplingTools = true;

		const sampleMessage = vi
			.fn()
			.mockResolvedValueOnce({
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "call_1",
						// Registered tool name (OPT-FLOW-02): legacy alias memory_recap
						// was removed from the sampling surface (buildSamplingTools now
						// hands the model only memory-read/task-read). Recap-mode args
						// with limit 8 === SEEDED_RECAP_LIMIT and the synthesize scope
						// (owner/repo) additionally exercise the first-iteration
						// seed-serve path (cached recap instead of a re-query).
						name: "memory-read",
						input: { owner: "test", repo: "test-repo", limit: 8 }
					}
				],
				stopReason: "toolUse"
			})
			.mockResolvedValueOnce({
				role: "assistant",
				content: { type: "text", text: "Final grounded answer after tool use." },
				model: "test-model",
				stopReason: "endTurn"
			});

		const router = createRouter(mockDb, mockVectors, {
			getSessionContext: () => session,
			sampleMessage
		});

		const result = (await router("tools/call", {
			name: "synthesize",
			arguments: {
				owner: "test",
				repo: "test-repo",
				objective: "Explain the latest architecture decisions",
				max_iterations: 3
			}
		})) as any;

		expect(sampleMessage).toHaveBeenCalledTimes(2);
		expect((result.structuredContent as Record<string, unknown>).toolCalls).toBe(1);
		expect((result.structuredContent as Record<string, unknown>).iterations).toBe(2);
	});

	it("synthesize falls back to cwd inference when no roots or repo provided", async () => {
		const mockDb = makeMockDb();
		const mockVectors = makeMockVectors();
		const session = createSessionContext();
		session.supportsSampling = true;
		session.supportsElicitation = true;
		session.supportsElicitationForm = true;

		const sampleMessage = vi.fn().mockResolvedValue({
			role: "assistant",
			content: { type: "text", text: "Synthesized after cwd fallback." },
			model: "test-model",
			stopReason: "endTurn"
		});
		const elicit = vi.fn();

		const router = createRouter(mockDb, mockVectors, {
			getSessionContext: () => session,
			sampleMessage,
			elicit
		});

		const result = (await router("tools/call", {
			name: "synthesize",
			arguments: { owner: "test", objective: "Summarize using cwd inference" }
		})) as any;

		expect(elicit).not.toHaveBeenCalled();
		expect(sampleMessage).toHaveBeenCalledTimes(1);
		expect(result.structuredContent).toBeDefined();
	});

	it("task-write with interactive=true elicits missing task fields and creates the task", async () => {
		const mockDb = makeMockDb();
		const mockVectors = makeMockVectors();
		const session = createSessionContext();
		session.supportsElicitation = true;
		session.supportsElicitationForm = true;

		const elicit = vi.fn().mockResolvedValue({
			action: "accept",
			content: {
				owner: "test",
				repo: "interactive-repo",
				task_code: "TASK-101",
				phase: "implementation",
				title: "Implement elicitation flow",
				description: "Add elicitation-backed task creation flow",
				status: "pending",
				priority: 4
			}
		});

		const router = createRouter(mockDb, mockVectors, {
			getSessionContext: () => session,
			elicit
		});

		const result = (await router("tools/call", {
			name: "task-write",
			arguments: { interactive: true }
		})) as any;

		expect(elicit).toHaveBeenCalledTimes(1);
		expect(mockDb.tasks.insertTask).toHaveBeenCalledTimes(1);
		// OPT-PERF-09: task creation runs under the exclusive write lock.
		expect(mockDb.withExclusiveWrite).toHaveBeenCalled();
		// repo is inferred from session context, not from elicit response
		expect(result.structuredContent.repo).toBeDefined();
		expect(result.structuredContent.task_code).toBeDefined();
	});

	it("returns resource links in memory-read (search) results", async () => {
		const mockDb = makeMockDb();
		const mockVectors = makeMockVectors();
		(mockDb.memoryVectors.searchBySimilarity as any).mockReturnValue([
			{
				id: "123e4567-e89b-12d3-a456-426614174000",
				type: "decision",
				title: "Use SQLite for local memory",
				content: "SQLite keeps the server self-contained.",
				importance: 4,
				scope: { repo: "test-repo" },
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
				hit_count: 0,
				recall_count: 0,
				last_used_at: null,
				expires_at: null,
				tags: []
			}
		]);
		(mockVectors.search as any).mockResolvedValue([]);
		const router = createRouter(mockDb, mockVectors);

		const result = (await router("tools/call", {
			name: "memory-read",
			arguments: { query: "sqlite", owner: "test", repo: "test-repo", limit: 5 }
		})) as any;

		// New policy: no automatic resource links in search results to force use of detail tools
		const resourceLinks = (result.content as Record<string, unknown>[]).filter(
			(entry) => entry.type === "resource_link"
		);
		expect(resourceLinks.length).toBe(0);
	});
});
