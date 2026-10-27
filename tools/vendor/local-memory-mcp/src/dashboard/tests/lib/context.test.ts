/**
 * Unit tests for src/dashboard/lib/context.ts — the dashboard DI singleton
 * module.
 *
 * Two concerns are pinned:
 *
 * 1. WIRING — the module constructs each export with the right dependency
 *    graph. MCPClient/RealVectorStore/EmbeddingWorker/logger are stubbed at the
 *    module boundary (RealVectorStore.initialize would otherwise load an
 *    embedding model); SQLiteStore stays REAL and is forced onto an in-memory
 *    DB via MEMORY_DB_PATH so no config-dir store is touched.
 *
 * 2. STORE BOUNDARIES + TRANSACTION SEMANTICS — the `db` context exposes
 *    (real, in-memory): withWrite/withExclusiveWrite boundaries (value
 *    passthrough, reentrancy, error propagation + lock release), lock-free
 *    reads, atomic commit and rollback (both at the raw BEGIN IMMEDIATE
 *    transaction level and through a real entity bulk insert that fails
 *    mid-batch).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import fs from "node:fs";
import type { MemoryEntry } from "../../../mcp/types/memory";
import { db, embeddingWorker, logger, mcpClient, startTime, vectors } from "../../lib/context";
import { SQLiteStore } from "../../../mcp/storage/sqlite";
import { CapabilityAwareVectorStore } from "../../../mcp/storage/lazy-vectors";

const mocks = vi.hoisted(() => {
	// Force sqlite.ts's module-level `resolveDbPath()` (evaluated at import
	// time, before any test code runs) to target an in-memory store.
	process.env.MEMORY_DB_PATH = ":memory:";

	class MCPClientMock {}

	class RealVectorStoreMock {
		readonly db: unknown;
		readonly initialize: ReturnType<typeof vi.fn>;
		readonly upsert = vi.fn();
		readonly remove = vi.fn();
		readonly search = vi.fn();
		constructor(db: unknown) {
			this.db = db;
			this.initialize = vi.fn().mockResolvedValue(undefined);
		}
	}

	class EmbeddingWorkerMock {
		readonly db: unknown;
		readonly vectors: unknown;
		constructor(db: unknown, vectors: unknown) {
			this.db = db;
			this.vectors = vectors;
		}
	}

	const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

	return { MCPClientMock, RealVectorStoreMock, EmbeddingWorkerMock, logger };
});

vi.mock("../../../mcp/client", () => ({ MCPClient: mocks.MCPClientMock }));
vi.mock("../../../mcp/storage/vectors", () => ({ RealVectorStore: mocks.RealVectorStoreMock }));
vi.mock("../../../mcp/embedding-queue", () => ({ EmbeddingWorker: mocks.EmbeddingWorkerMock }));
vi.mock("../../../mcp/utils/logger", () => ({ logger: mocks.logger }));

type MockedFn = ReturnType<typeof vi.fn>;

function makeMemory(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	return {
		id: randomUUID(),
		type: "code_fact",
		title: "ctx-store-test",
		content: "content",
		importance: 3,
		agent: "backend",
		role: "user",
		model: "test",
		scope: { owner: "acme", repo: "app" },
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		completed_at: null,
		hit_count: 0,
		recall_count: 0,
		last_used_at: null,
		expires_at: null,
		supersedes: null,
		status: "active",
		tags: [],
		metadata: {},
		is_global: false,
		...overrides
	};
}

describe("context module wiring (deps stubbed, store real)", () => {
	it("exports a real SQLiteStore singleton created on an in-memory database", () => {
		expect(db).toBeInstanceOf(SQLiteStore);
		expect(db.getDbPath()).toBe(":memory:");
	});

	it("constructs a single MCPClient", () => {
		expect(mcpClient).toBeInstanceOf(mocks.MCPClientMock);
	});

	it("wraps RealVectorStore and keeps full-profile startup backward compatible", () => {
		expect(vectors).toBeInstanceOf(CapabilityAwareVectorStore);
		const vectorStore = vectors.getInnerStore() as unknown as { db: unknown; initialize: MockedFn };
		expect(vectorStore).toBeInstanceOf(mocks.RealVectorStoreMock);
		expect(vectorStore.db).toBe(db);
		expect(vectorStore.initialize).toHaveBeenCalledTimes(1);
	});

	it("constructs EmbeddingWorker with the real vector store", () => {
		const worker = embeddingWorker as unknown as { db: unknown; vectors: unknown };
		expect(embeddingWorker).toBeInstanceOf(mocks.EmbeddingWorkerMock);
		expect(worker.db).toBe(db);
		expect(worker.vectors).toBe(vectors.getInnerStore());
	});

	it("records a finite startTime", () => {
		expect(Number.isFinite(startTime)).toBe(true);
		expect(startTime).toBeGreaterThan(1_700_000_000_000);
	});

	it("re-exports the logger", () => {
		expect(logger).toBe(mocks.logger);
	});
});

describe("context db — write boundaries & transaction semantics (real in-memory store)", () => {
	const PROBE_TABLE = "_ctx_tx_probe";

	beforeAll(() => {
		db.db.exec(`CREATE TABLE ${PROBE_TABLE} (id INTEGER PRIMARY KEY, v TEXT NOT NULL)`);
	});

	afterAll(() => {
		db.db.exec(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);
		db.close();
		// Clean up the stray artifacts WriteLock creates for the ":memory:" target.
		fs.rmSync(":memory:", { force: true });
		fs.rmSync(".:memory:.lock", { force: true });
	});

	it("withWrite executes the body and returns its value", async () => {
		await expect(db.withWrite(() => 42)).resolves.toBe(42);
	});

	it("withWrite commits mutations so reads outside the boundary see them", async () => {
		const entry = makeMemory();
		await db.withWrite(() => db.memories.insert(entry));
		// Read happens OUTSIDE withWrite: the read boundary is lock-free.
		expect(db.memories.getById(entry.id)?.id).toBe(entry.id);
	});

	it("propagates a body error and leaves the store usable (no deadlock)", async () => {
		const boom = new Error("boom");
		await expect(
			db.withWrite(() => {
				throw boom;
			})
		).rejects.toBe(boom);
		await expect(db.withWrite(() => "still works")).resolves.toBe("still works");
	});

	it("withWrite is reentrant (nested calls run inline)", async () => {
		await expect(
			db.withWrite(() =>
				db.withWrite(() => {
					db.memories.insert(makeMemory());
					return 7;
				})
			)
		).resolves.toBe(7);
	});

	it("reads run lock-free and return null for missing rows", () => {
		expect(db.memories.getById("missing-id")).toBeNull();
	});

	it("reads also succeed when executed inside withWrite", async () => {
		const entry = makeMemory();
		db.memories.insert(entry);
		await expect(db.withWrite(() => db.memories.getById(entry.id))).resolves.not.toBeNull();
	});

	it("withExclusiveWrite runs the body, returns its value and releases the lock", async () => {
		await expect(db.withExclusiveWrite(() => "done")).resolves.toBe("done");
		expect(db.lock.isLocked()).toBe(false);
	});

	it("withExclusiveWrite releases the lock even when the body throws", async () => {
		const boom = new Error("boom");
		await expect(
			db.withExclusiveWrite(() => {
				throw boom;
			})
		).rejects.toBe(boom);
		expect(db.lock.isLocked()).toBe(false);
		await expect(db.withExclusiveWrite(() => "recovered")).resolves.toBe("recovered");
	});

	it("withExclusiveWrite is reentrant for nested calls", async () => {
		const result = await db.withExclusiveWrite(() => db.withExclusiveWrite(() => "nested"));
		expect(result).toBe("nested");
		expect(db.lock.isLocked()).toBe(false);
	});

	it("commits all statements of a transaction atomically", () => {
		const insert = db.db.prepare(`INSERT INTO ${PROBE_TABLE} (id, v) VALUES (?, ?)`);
		db.db
			.transaction(() => {
				insert.run(1, "a");
				insert.run(2, "b");
			})
			.immediate();
		const rows = db.db.prepare(`SELECT id, v FROM ${PROBE_TABLE} ORDER BY id`).all() as { id: number; v: string }[];
		expect(rows).toEqual([
			{ id: 1, v: "a" },
			{ id: 2, v: "b" }
		]);
	});

	it("rolls back the whole transaction when a statement throws (no partial state)", () => {
		const insert = db.db.prepare(`INSERT INTO ${PROBE_TABLE} (id, v) VALUES (?, ?)`);
		expect(() =>
			db.db
				.transaction(() => {
					insert.run(3, "first-of-failed-batch");
					throw new Error("mid-batch failure");
				})
				.immediate()
		).toThrow("mid-batch failure");
		const count = db.db.prepare(`SELECT COUNT(*) AS n FROM ${PROBE_TABLE}`).get() as { n: number };
		expect(count.n).toBe(2);
	});

	it("rolls back a real entity bulk insert through withWrite on mid-batch constraint failure", async () => {
		const first = makeMemory();
		const duplicateId = makeMemory({ id: first.id });
		await expect(db.withWrite(() => db.memories.bulkInsertMemories([first, duplicateId]))).rejects.toThrow();
		// The first insert must NOT have survived the batch rollback.
		expect(db.memories.getById(first.id)).toBeNull();
	});
});
