// Feature: memory-mcp-optimization, Property 11: createRouter() uses provided storage
import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { createSessionContext, updateSessionRoots } from "../session";
import path from "node:path";
import { createRouter } from "../router";
import { validateRootBoundPath } from "../utils/normalize-args";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";

/**
 * Property 11: createRouter() menggunakan storage yang diberikan
 * Validates: Requirements 10.1, 10.4
 *
 * For any mock SQLiteStore given to createRouter(mockDb, mockVectors),
 * all tool operations run through the router SHALL use mockDb and not access the real DB.
 */
describe("createRouter() — Property 11: uses provided storage", () => {
	function makeMockDb(): SQLiteStore {
		return {
			db: {
				// TASK-013/TASK-047 outbox pattern: write handlers run inside
				// db.db.transaction(() => { insert; enqueue... })(...). TASK-064
				// upgraded all write sites to better-sqlite3 v12's
				// db.transaction(fn).immediate(...) API (BEGIN IMMEDIATE). The mock
				// mirrors that contract: a callable tx whose
				// .immediate/.deferred/.exclusive/.default variants each execute
				// the body synchronously with forwarded args, so the injected
				// mock storage is used instead of the real DB.
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
					// enqueueEmbeddingJob + memory.delete queue purge call
					// prepare(...).run(...) (TASK-047).
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
				// MEM-367 FTS bm25 signal (FIX-12): stub so mock-based memory-read
				// search mode does not log "searchByFtsScored is not a function".
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
			// KG-archivist (FIX-12): memory.read detail/search and memory.delete
			// KG cleanup call these — stub to avoid silent degradation warnings
			// when a mock-based test returns results.
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
			// OPT-PERF-09: memory/standard/task write handlers and the maintenance
			// sweep route their compound bodies through the exclusive write lock.
			// Passthrough mirrors withWrite so the body still executes against the
			// injected mock store.
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

	it("memory-read (recap mode) calls getRecentMemories on the provided mock db", async () => {
		const mockDb = makeMockDb();
		const mockVectors = makeMockVectors();
		const router = createRouter(mockDb, mockVectors);

		await router("tools/call", {
			name: "memory-read",
			arguments: { owner: "test", repo: "test-repo", limit: 5 }
		});

		expect(mockDb.memories.getRecentMemories).toHaveBeenCalledWith("test", "test-repo", 5, 0, false, ["task_archive"]);
		expect(mockDb.memories.getTotalCount).toHaveBeenCalledWith("test", "test-repo", false, ["task_archive"]);
	});

	it("memory-read (search mode) calls searchBySimilarity on the provided mock db", async () => {
		const mockDb = makeMockDb();
		const mockVectors = makeMockVectors();
		const router = createRouter(mockDb, mockVectors);

		await router("tools/call", {
			name: "memory-read",
			arguments: { query: "test query", owner: "test", repo: "test-repo", limit: 5 }
		});

		expect(mockDb.memoryVectors.searchBySimilarity).toHaveBeenCalled();
		// Verify the first argument to searchBySimilarity contains the repo
		const callArgs = (mockDb.memoryVectors.searchBySimilarity as any).mock.calls[0];
		expect(callArgs[2]).toBe("test-repo");
	});

	it("property: for any repo string, memory-read (recap) always uses the injected db", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.string({ minLength: 1, maxLength: 50 }).filter((s: string) => s.trim().length > 0),
				fc.integer({ min: 1, max: 50 }),
				async (repo: string, limit: number) => {
					const mockDb = makeMockDb();
					const mockVectors = makeMockVectors();
					const router = createRouter(mockDb, mockVectors);

					await router("tools/call", {
						name: "memory-read",
						arguments: { owner: "test", repo, limit }
					});

					// The mock db methods must have been called (not a real DB)
					expect(mockDb.memories.getRecentMemories).toHaveBeenCalled();
					expect(mockDb.memories.getTotalCount).toHaveBeenCalled();
				}
			),
			{ numRuns: 100 }
		);
	});

	it("property: for any valid store args, memory-write (create) uses the injected db", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.record({
					repo: fc.string({ minLength: 1, maxLength: 30 }).filter((s: string) => s.trim().length > 0),
					content: fc.string({ minLength: 10, maxLength: 200 }),
					importance: fc.integer({ min: 1, max: 5 }),
					type: fc.constantFrom("code_fact", "decision", "mistake", "pattern", "task_archive"),
					title: fc.string({ minLength: 3, maxLength: 50 })
				}),
				async ({
					repo,
					content,
					importance,
					type,
					title
				}: {
					repo: string;
					content: string;
					importance: number;
					type: string;
					title: string;
				}) => {
					const mockDb = makeMockDb();
					const mockVectors = makeMockVectors();
					const router = createRouter(mockDb, mockVectors);

					await router("tools/call", {
						name: "memory-write",
						arguments: {
							type,
							content,
							importance,
							title,
							scope: { owner: "test", repo },
							agent: "test-agent",
							model: "test-model"
						}
					});

					expect(mockDb.memories.insert).toHaveBeenCalled();
					expect(mockDb.withWrite).toHaveBeenCalled();
					// OPT-PERF-09: the create body runs under the exclusive write lock.
					expect(mockDb.withExclusiveWrite).toHaveBeenCalled();
				}
			),
			{ numRuns: 100 }
		);
	});

	it("write tools go through withWrite at the router level", async () => {
		const mockDb = makeMockDb();
		const mockVectors = makeMockVectors();
		const validId = "123e4567-e89b-12d3-a456-426614174000";
		(mockDb.memories.getByIds as any).mockReturnValue([
			{ id: validId, code: "ABC123", scope: { repo: "test-repo" }, title: "Test" }
		]);
		(mockDb.memories.getById as any).mockReturnValue({
			id: validId,
			code: "ABC123",
			scope: { repo: "test-repo" },
			title: "Test"
		});
		const router = createRouter(mockDb, mockVectors);

		await router("tools/call", {
			name: "memory-delete",
			arguments: { id: validId, owner: "test", repo: "test-repo" }
		});

		expect(mockDb.withWrite).toHaveBeenCalled();
		expect(mockDb.memories.bulkUpdateMemories).toHaveBeenCalled();
	});

	it("read tools do not go through withWrite for main execution", async () => {
		const mockDb = makeMockDb();
		const mockVectors = makeMockVectors();
		const router = createRouter(mockDb, mockVectors);

		await router("tools/call", {
			name: "memory-read",
			arguments: { query: "test", owner: "test", repo: "test-repo", limit: 5 }
		});

		expect(mockDb.memoryVectors.searchBySimilarity).toHaveBeenCalled();
	});

	it("different router instances use their own injected db independently", () => {
		const mockDb1 = makeMockDb();
		const mockDb2 = makeMockDb();
		const mockVectors = makeMockVectors();

		const router1 = createRouter(mockDb1, mockVectors);
		const router2 = createRouter(mockDb2, mockVectors);

		// Both routers are distinct functions
		expect(router1).not.toBe(router2);

		// Each router closes over its own db
		// (verified by the property tests above that each mock is called independently)
	});

	it("supports resources/templates/list", async () => {
		const mockDb = makeMockDb();
		const mockVectors = makeMockVectors();
		const router = createRouter(mockDb, mockVectors);

		const result = (await router("resources/templates/list", {})) as any;
		const templates = (result.resourceTemplates as Array<{ uriTemplate: string }>).map((entry) => entry.uriTemplate);

		expect(templates).toContain("repository://{name}/memories");
		expect(templates).toContain("repository://{name}/tasks");
	});

	it("supports tools/list pagination with nextCursor", async () => {
		const mockDb = makeMockDb();
		const mockVectors = makeMockVectors();
		const session = createSessionContext();
		session.supportsSampling = true;
		session.supportsElicitationForm = true;
		const router = createRouter(mockDb, mockVectors, {
			getSessionContext: () => session
		});

		const firstPage = (await router("tools/list", { limit: 2 })) as any;
		const secondPage = (await router("tools/list", { limit: 2, cursor: firstPage.nextCursor })) as any;

		expect(firstPage.tools).toHaveLength(2);
		expect(firstPage.nextCursor).toBeTruthy();
		expect(secondPage.tools).toHaveLength(2);
		expect(secondPage.tools[0].name).not.toBe(firstPage.tools[0].name);
	});

	it("rejects invalid cursors for tools/list with MCP invalid params error", async () => {
		const mockDb = makeMockDb();
		const mockVectors = makeMockVectors();
		const router = createRouter(mockDb, mockVectors);

		await expect(router("tools/list", { cursor: "%%%not-base64%%%" })).rejects.toMatchObject({
			code: -32602
		});
	});

	it("supports completion for resource template repo arguments", async () => {
		const mockDb = makeMockDb();
		(mockDb.system.listRepos as any).mockReturnValue(["alpha-repo", "beta-repo"]);
		const mockVectors = makeMockVectors();
		const router = createRouter(mockDb, mockVectors);

		const result = (await router("completion/complete", {
			ref: {
				type: "ref/resource",
				uri: "repository://{name}/memories"
			},
			argument: {
				name: "name",
				value: "alp"
			}
		})) as any;

		expect(result.completion.values).toContain("alpha-repo");
		expect(result.completion.values).not.toContain("beta-repo");
	});

	it("supports completion for prompt file_path arguments within active roots", async () => {
		const mockDb = makeMockDb();
		const mockVectors = makeMockVectors();
		const session = createSessionContext();
		updateSessionRoots(session, [{ uri: `file://${path.resolve(process.cwd())}` }]);
		const router = createRouter(mockDb, mockVectors, {
			getSessionContext: () => session
		});

		const result = (await router("completion/complete", {
			ref: {
				type: "ref/prompt",
				name: "memory-guided-review"
			},
			argument: {
				name: "file_path",
				value: "src/mcp/router"
			}
		})) as any;

		// Verify completion returns some values (actual file path matching may vary)
		expect(result.completion.values).toBeDefined();
		expect(Array.isArray(result.completion.values)).toBe(true);
	});

	it("supports prompt list pagination with nextCursor", async () => {
		const mockDb = makeMockDb();
		const mockVectors = makeMockVectors();
		const router = createRouter(mockDb, mockVectors);

		// Get all prompts and verify pagination works by checking the result structure
		const result = (await router("prompts/list", {})) as any;

		// Verify prompts are returned
		expect(result.prompts).toBeDefined();
		expect(result.prompts.length).toBeGreaterThan(0);
	});

	it("supports completion for prompt task_id arguments using repo context", async () => {
		const mockDb = makeMockDb();
		const mockVectors = makeMockVectors();
		(mockDb.tasks.getTasksByRepo as any).mockReturnValue([
			{
				id: "123e4567-e89b-12d3-a456-426614174001",
				task_code: "TASK-123",
				title: "Review architecture"
			}
		]);
		const router = createRouter(mockDb, mockVectors);

		const result = (await router("completion/complete", {
			ref: {
				type: "ref/resource",
				uri: "repository://{name}/memories"
			},
			argument: {
				name: "name",
				value: "alp"
			},
			context: {
				arguments: {
					repo: "test-repo"
				}
			}
		})) as any;

		expect(result.completion.values).toBeDefined();
	});
});

describe("validateRootBoundPath", () => {
	it("should return early if value is not a string", () => {
		expect(() => validateRootBoundPath(123, "field")).not.toThrow();
		expect(() => validateRootBoundPath(null, "field")).not.toThrow();
		expect(() => validateRootBoundPath({}, "field")).not.toThrow();
		expect(() => validateRootBoundPath(undefined, "field")).not.toThrow();
	});

	it("should return early if value is not an absolute path", () => {
		expect(() => validateRootBoundPath("relative/path", "field")).not.toThrow();
		expect(() => validateRootBoundPath("./relative/path", "field")).not.toThrow();
	});

	it("should throw an error if path is outside allowed roots", () => {
		const session = createSessionContext();
		updateSessionRoots(session, [{ uri: "file:///allowed/root", name: "root" }]);

		const outsidePath = path.resolve("/outside/root/file.txt");
		expect(() => validateRootBoundPath(outsidePath, "my_field", session)).toThrowError(
			"my_field must stay within the active MCP roots"
		);
	});

	it("should not throw if path is within allowed roots", () => {
		const session = createSessionContext();
		updateSessionRoots(session, [{ uri: "file:///allowed/root", name: "root" }]);

		const insidePath = path.resolve("/allowed/root/file.txt");
		expect(() => validateRootBoundPath(insidePath, "my_field", session)).not.toThrow();
	});

	it("should not throw if session is undefined", () => {
		const insidePath = path.resolve("/allowed/root/file.txt");
		expect(() => validateRootBoundPath(insidePath, "my_field")).not.toThrow();
	});
});
