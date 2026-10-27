// Feature: memory-mcp-optimization
// Property tests for SQLiteStore — Properties 1, 6, 7, 8, 9, 10, 18, 19

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { SQLiteStore, createTestStore } from "../storage/sqlite";
import { handleMemoryWrite } from "../tools/memory.write";
import { MEMORY_DB_BUSY_TIMEOUT_MS } from "../utils/constants";
import type { MemoryEntry, VectorStore } from "../types";

const require = createRequire(import.meta.url);

type MemoryType = "code_fact" | "decision" | "mistake" | "pattern" | "task_archive";

function makeEntry(
	overrides: Partial<{
		id: string;
		repo: string;
		type: MemoryType;
		title: string;
		content: string;
		importance: number;
		agent: string;
		model: string;
		created_at: string;
		expires_at: string | null;
	}>
): MemoryEntry {
	const now = new Date().toISOString();
	return {
		id: overrides.id ?? `id-${Math.random().toString(36).slice(2)}`,
		type: overrides.type ?? "code_fact",
		title: overrides.title ?? "Test Memory Title",
		content: overrides.content ?? "sample content for testing purposes",
		importance: overrides.importance ?? 3,
		agent: overrides.agent ?? "test-agent",
		role: "unknown",
		model: overrides.model ?? "test-model",
		scope: { owner: "test", repo: overrides.repo ?? "test-repo" },
		created_at: overrides.created_at ?? now,
		updated_at: now,
		completed_at: null,
		hit_count: 0,
		recall_count: 0,
		last_used_at: null,
		expires_at: overrides.expires_at !== undefined ? overrides.expires_at : null,
		supersedes: null,
		status: "active",
		tags: [],
		metadata: {},
		is_global: false
	};
}

async function freshStore(): Promise<SQLiteStore> {
	return createTestStore();
}

describe("Property 1: Pre-filter SQL limits searchBySimilarity candidates", () => {
	it("result.length <= limit for any repo with N > limit memories", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.integer({ min: 5, max: 30 }),
				fc.integer({ min: 1, max: 4 }),
				fc.string({ minLength: 5, maxLength: 30 }),
				async (n: number, limit: number, query: string) => {
					const store = await freshStore();
					const repo = "repo-p1";

					for (let i = 0; i < n; i++) {
						store.memories.insert(
							makeEntry({
								id: `p1-${i}`,
								repo,
								content: `memory content item number ${i} about coding patterns`
							})
						);
					}

					const results = store.memoryVectors.searchBySimilarity(query, "test", repo, limit);
					store.close();

					return results.length <= limit;
				}
			),
			{ numRuns: 50 }
		);
	});
});

describe("Property 6: Repeated SQLiteStore initialization does not throw", () => {
	it("constructing SQLiteStore twice on :memory: does not throw", async () => {
		await fc.assert(
			fc.asyncProperty(fc.constant(":memory:"), async () => {
				const s1 = await freshStore();
				s1.close();

				const s2 = await freshStore();
				s2.close();

				return true;
			}),
			{ numRuns: 20 }
		);
	});

	it("migrate() is idempotent — inserting then re-opening same store does not throw", async () => {
		const store1 = await freshStore();
		store1.memories.insert(makeEntry({ id: "m1", repo: "r1" }));
		store1.close();

		const store2 = await freshStore();
		store2.memories.insert(makeEntry({ id: "m2", repo: "r2" }));
		expect(() => store2.close()).not.toThrow();
	});
});

describe("Property 7: Pagination non-overlapping", () => {
	it("pages i and j (i ≠ j) share no memory ids", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.integer({ min: 10, max: 40 }),
				fc.integer({ min: 2, max: 5 }),
				fc.integer({ min: 0, max: 3 }),
				fc.integer({ min: 0, max: 3 }),
				async (n: number, pageSize: number, i: number, j: number) => {
					fc.pre(i !== j);

					const store = await freshStore();
					const repo = "repo-p7";

					for (let k = 0; k < n; k++) {
						store.memories.insert(
							makeEntry({
								id: `p7-${k}`,
								repo,
								content: `memory item ${k} for pagination test`
							})
						);
					}

					const pageI = store.memories.getRecentMemories("test", repo, pageSize, i * pageSize);
					const pageJ = store.memories.getRecentMemories("test", repo, pageSize, j * pageSize);
					store.close();

					const idsI = new Set(pageI.map((m) => m.id));
					const idsJ = new Set(pageJ.map((m) => m.id));

					for (const id of idsI) {
						if (idsJ.has(id)) return false;
					}
					return true;
				}
			),
			{ numRuns: 50 }
		);
		// REL-051: raised from 15000ms. Each run constructs a fresh in-memory
		// SQLite store (re-running all migrations) and inserts up to 40 rows;
		// the property took ~9s in isolation and flaked past 15s under full
		// parallel load (observed in a clean `--project unit` run). The
		// assertion is unchanged; only the wall-clock budget is widened.
	}, 60_000);
});

describe("Property 8: TTL stores correct expires_at", () => {
	it("expires_at equals created_at + ttlDays * 86400 seconds", async () => {
		const mockVectors: VectorStore = {
			upsert: vi.fn().mockResolvedValue(undefined),
			remove: vi.fn().mockResolvedValue(undefined),
			search: vi.fn().mockResolvedValue([])
		};

		await fc.assert(
			fc.asyncProperty(fc.integer({ min: 1, max: 365 }), async (ttlDays: number) => {
				const db = await freshStore();
				const repo = "p8-ttl";

				const response = await handleMemoryWrite(
					{
						type: "code_fact",
						title: "TTL Test Memory",
						content: "Testing that expires_at equals created_at plus ttlDays",
						importance: 3,
						scope: { owner: "test", repo },
						agent: "test-agent",
						model: "test-model",
						ttlDays,
						json: true
					},
					db,
					mockVectors
				);

				const stored = db.memories.getById((response.structuredContent as Record<string, unknown>).id as string);
				db.close();

				expect(stored).not.toBeNull();
				const createdMs = new Date(stored!.created_at).getTime();
				const expiresMs = new Date(stored!.expires_at!).getTime();
				expect(expiresMs).toBe(createdMs + ttlDays * 86400000);
			}),
			{ numRuns: 50 }
		);
	});
});

describe("Property 9: Expired memories excluded from search results", () => {
	it("searchBySimilarity does not return expired memories", async () => {
		await fc.assert(
			fc.asyncProperty(fc.string({ minLength: 5, maxLength: 20 }), async (query: string) => {
				const store = await freshStore();
				const repo = "repo-p9-sim";
				const pastDate = new Date(Date.now() - 86400 * 1000).toISOString();

				store.memories.insert(
					makeEntry({
						id: "expired-sim",
						repo,
						content: `${query} expired content that should not appear`,
						expires_at: pastDate
					})
				);

				const results = store.memoryVectors.searchBySimilarity(query, "", repo, 10);
				store.close();

				return !results.some((r) => r.id === "expired-sim");
			}),
			{ numRuns: 50 }
		);
	});

	it("searchByRepo does not return expired memories", async () => {
		await fc.assert(
			fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (importance: number) => {
				const store = await freshStore();
				const repo = "repo-p9-byrepo";
				const pastDate = new Date(Date.now() - 86400 * 1000).toISOString();

				store.memories.insert(
					makeEntry({
						id: "expired-byrepo",
						repo,
						importance,
						expires_at: pastDate
					})
				);

				const results = store.memories.searchByRepo("test", repo);
				store.close();

				return !results.some((r) => r.id === "expired-byrepo");
			}),
			{ numRuns: 50 }
		);
	});
});

describe("Property 10: archiveExpiredMemories() is idempotent", () => {
	it("second call returns 0 when no new memories expired between calls", async () => {
		await fc.assert(
			fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (n: number) => {
				const store = await freshStore();
				const repo = "repo-p10";
				const pastDate = new Date(Date.now() - 86400 * 1000).toISOString();

				for (let i = 0; i < n; i++) {
					store.memories.insert(
						makeEntry({
							id: `p10-${i}`,
							repo,
							expires_at: pastDate
						})
					);
				}

				const first = store.memoryArchives.archiveExpiredMemories(true);
				const second = store.memoryArchives.archiveExpiredMemories(true);
				store.close();

				return first === n && second === 0;
			}),
			{ numRuns: 50 }
		);
	});
});

describe("Property 18: listRepos() returns unique and sorted list", () => {
	it("no duplicates and sorted ascending", async () => {
		// One migrated store for all runs: constructing a fresh SQLiteStore (and
		// re-running all migrations) per run was the dominant cost and pushed this
		// property past the 15s timeout under the full forks pool (FIX-0452). Each
		// run still starts from a clean memories table, so isolation is preserved.
		const store = await freshStore();
		try {
			await fc.assert(
				fc.asyncProperty(
					fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{1,10}$/), { minLength: 2, maxLength: 10 }),
					async (repos: string[]) => {
						store.db.exec("DELETE FROM memories");

						repos.forEach((repo: string, i: number) => {
							store.memories.insert(
								makeEntry({
									id: `p18-${i}-${repo}`,
									repo
								})
							);
						});

						const result = store.system.listRepos();

						const unique = new Set(result);
						if (unique.size !== result.length) return false;

						for (let i = 1; i < result.length; i++) {
							if (result[i] < result[i - 1]) return false;
						}

						return true;
					}
				),
				{ numRuns: 50 }
			);
		} finally {
			store.close();
		}
	}, 15000);
});

describe("Property 19: Action Log stores and retrieves recent actions", () => {
	it("logAction stores action with correct metadata", async () => {
		const store = await freshStore();

		store.actions.logAction("search", "test", "test-repo", { query: "test query", resultCount: 5 } as any);
		store.actions.logAction("store", "test", "test-repo", { id: "mem-1", type: "decision" } as any);

		const actions = store.actions.getRecentActions("test", "test-repo", 10);
		store.close();

		expect(actions.length).toBe(2);
		expect(actions[0].action).toBe("store");
		expect(actions[1].action).toBe("search");
	});

	it("getRecentActions returns actions in descending order by created_at", async () => {
		const store = await freshStore();

		store.actions.logAction("action-1", "test", "repo-a", { step: 1 } as any);
		store.actions.logAction("action-2", "test", "repo-a", { step: 2 } as any);
		store.actions.logAction("action-3", "test", "repo-a", { step: 3 } as any);

		const actions = store.actions.getRecentActions("test", "repo-a", 10);
		store.close();

		expect(actions[0].action).toBe("action-3");
		expect(actions[1].action).toBe("action-2");
		expect(actions[2].action).toBe("action-1");
	});

	it("getRecentActions limits results correctly", async () => {
		const store = await freshStore();

		for (let i = 0; i < 20; i++) {
			store.actions.logAction(`action-${i}`, "test", "repo-limit", { index: i } as any);
		}

		const actions = store.actions.getRecentActions("test", "repo-limit", 5);
		store.close();

		expect(actions.length).toBe(5);
	});

	it("getRecentActions filters by repo correctly", async () => {
		const store = await freshStore();

		store.actions.logAction("repo-a-action", "test", "repo-a", { data: "a" } as any);
		store.actions.logAction("repo-b-action", "test", "repo-b", { data: "b" } as any);
		store.actions.logAction("repo-a-second", "test", "repo-a", { data: "a2" } as any);

		const repoAActions = store.actions.getRecentActions("test", "repo-a", 10);
		const repoBActions = store.actions.getRecentActions("test", "repo-b", 10);
		store.close();

		expect(repoAActions.length).toBe(2);
		expect(repoBActions.length).toBe(1);
	});

	it("getRecentActions returns empty array when no actions exist", async () => {
		const store = await freshStore();

		const actions = store.actions.getRecentActions("", "nonexistent-repo", 10);
		store.close();

		expect(actions).toEqual([]);
	});

	it("getRecentActions without repo parameter returns all actions", async () => {
		const store = await freshStore();

		store.actions.logAction("action-1", "test", "repo-a", {});
		store.actions.logAction("action-2", "test", "repo-b", {});
		store.actions.logAction("action-3", "test", "repo-c", {});

		const allActions = store.actions.getRecentActions();
		store.close();

		expect(allActions.length).toBe(3);
	});
});

describe("Dashboard memory queries", () => {
	it("getRecentMemories returns memories sorted by created_at descending", async () => {
		const store = await freshStore();
		const repo = "dashboard-test";

		store.memories.insert(makeEntry({ id: "m1", repo, created_at: "2024-01-01T00:00:00Z" }));
		store.memories.insert(makeEntry({ id: "m2", repo, created_at: "2024-01-03T00:00:00Z" }));
		store.memories.insert(makeEntry({ id: "m3", repo, created_at: "2024-01-02T00:00:00Z" }));

		const memories = store.memories.getRecentMemories("test", repo, 10, 0);
		store.close();

		expect(memories[0].id).toBe("m2");
		expect(memories[1].id).toBe("m3");
		expect(memories[2].id).toBe("m1");
	});

	it("getRecentMemories respects limit and offset", async () => {
		const store = await freshStore();
		const repo = "pagination-test";

		for (let i = 0; i < 10; i++) {
			store.memories.insert(makeEntry({ id: `m-${i}`, repo }));
		}

		const firstPage = store.memories.getRecentMemories("test", repo, 3, 0);
		const secondPage = store.memories.getRecentMemories("test", repo, 3, 3);
		store.close();

		expect(firstPage.length).toBe(3);
		expect(secondPage.length).toBe(3);
		expect(firstPage[0].id).not.toBe(secondPage[0].id);
	});
});

// ---------------------------------------------------------------------------
// FIX-032 — SQLite write-contention hardening.
//
// The store must open with the CONFIGURED busy_timeout (regression: the derived
// attach previously rewrote the connection-scoped busy_timeout down to 5000),
// and concurrent writes must not surface a raw `database is locked` to callers:
// busy_timeout absorbs transient holds, and a persistent hold is retried
// (bounded) then surfaced as a CLEAR terminal error.
// ---------------------------------------------------------------------------

/** A file-backed store plus its temp dir, cleaned up by the caller. */
async function fileStore(): Promise<{ store: SQLiteStore; dir: string; dbPath: string }> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-contention-"));
	const dbPath = path.join(dir, "memory.db");
	const store = await SQLiteStore.create(dbPath);
	return { store, dir, dbPath };
}

describe("FIX-032 — busy_timeout on connection open", () => {
	it("keeps the configured busy_timeout after the derived schema is attached", async () => {
		const { store, dir } = await fileStore();
		try {
			// Derived attach must have happened (otherwise this regression guard
			// is not exercising the downgrade path).
			expect(store.getDerivedDbPath()).not.toBeNull();
			expect(store.getBusyTimeoutMs()).toBe(MEMORY_DB_BUSY_TIMEOUT_MS);
		} finally {
			store.close();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("FIX-032 — concurrent writes never surface a raw lock error", () => {
	it("a persistent writer hold is retried then surfaced as a CLEAR terminal error (never bare 'database is locked')", async () => {
		const { store, dir, dbPath } = await fileStore();
		// Second connection holds the write lock for the whole test — the store's
		// busy_timeout is forced to 0 so each attempt fails IMMEDIATELY with
		// SQLITE_BUSY (no multi-second wait), exercising the retry + terminal
		// error path deterministically.
		const lockHolder = new Database(dbPath);
		try {
			store.db.pragma("busy_timeout = 0");
			lockHolder.exec("BEGIN IMMEDIATE");

			let caught: unknown;
			try {
				store.memories.insert(makeEntry({ id: "blocked-1", repo: "contention" }));
			} catch (error) {
				caught = error;
			}

			expect(caught).toBeInstanceOf(Error);
			const message = (caught as Error).message;
			// Clear + actionable, NOT a bare "database is locked".
			expect(message).toMatch(/persistent lock contention/);
			expect(message).toMatch(/database is locked/);
			// Machine code preserved so downstream classifiers still see BUSY.
			expect((caught as { code?: string }).code).toBe("SQLITE_BUSY");
			// Nothing was written.
			expect(store.memories.getById("blocked-1")).toBeNull();
		} finally {
			try {
				lockHolder.exec("ROLLBACK");
			} catch {
				/* best effort */
			}
			lockHolder.close();
			store.close();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("waits out a transient cross-connection hold and succeeds with no error (busy_timeout absorbs it)", async () => {
		const { store, dir, dbPath } = await fileStore();
		// A worker thread (separate connection) takes the write lock, holds it
		// ~200ms, then commits. The main thread's write must block on
		// busy_timeout and then succeed — no retry, no error. A worker is used
		// because better-sqlite3 is synchronous: the lock must be released by an
		// independent thread while the main thread is blocked inside SQLite.
		const workerSource = `
			import { parentPort, workerData } from "node:worker_threads";
			const { default: Database } = await import(workerData.modulePath);
			const db = new Database(workerData.dbPath);
			db.pragma("busy_timeout = 30000");
			db.exec("BEGIN IMMEDIATE");
			parentPort.postMessage({ type: "locked" });
			setTimeout(() => {
				db.exec("COMMIT");
				db.close();
				parentPort.postMessage({ type: "released" });
			}, 200);
		`;

		const worker = new Worker(workerSource, {
			eval: true,
			workerData: { dbPath, modulePath: require.resolve("better-sqlite3") }
		});
		try {
			await new Promise<void>((resolve, reject) => {
				worker.once("message", (msg: { type?: string }) => {
					if (msg.type === "locked") resolve();
					else reject(new Error(`unexpected worker message: ${JSON.stringify(msg)}`));
				});
				worker.once("error", reject);
			});

			const started = performance.now();
			expect(() => store.memories.insert(makeEntry({ id: "waited-1", repo: "contention" }))).not.toThrow();
			const elapsed = performance.now() - started;

			// It genuinely waited for the hold to clear (proves busy_timeout was
			// in effect) and then committed.
			expect(elapsed).toBeGreaterThanOrEqual(100);
			expect(store.memories.getById("waited-1")).not.toBeNull();
		} finally {
			await worker.terminate();
			store.close();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	}, 15000);
});
