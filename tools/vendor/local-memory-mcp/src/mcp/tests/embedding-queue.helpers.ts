import { randomUUID } from "crypto";
import { vi } from "vitest";
import { SQLiteStore } from "../storage/sqlite";
import { EmbeddingWorker } from "../embedding-queue/worker";
import { RealVectorStore } from "../storage/vectors";
import type { Task, MemoryEntry, CodingStandardEntry } from "../types";

export const REPO = "embedding-queue-test";

export function makeTask(overrides: Partial<Task> = {}): Task {
	const now = new Date().toISOString();
	return {
		id: randomUUID(),
		owner: "test",
		repo: REPO,
		task_code: `TQ-${randomUUID().slice(0, 6)}`,
		phase: "testing",
		title: "Embedding queue test task",
		description: "Alice worked on the deployment for Acme Corp",
		status: "backlog",
		priority: 3,
		agent: "test",
		role: "tester",
		doc_path: null,
		created_at: now,
		updated_at: now,
		in_progress_at: null,
		finished_at: null,
		canceled_at: null,
		est_tokens: 0,
		commit_id: null,
		changed_files: [],
		tags: [],
		suggested_skills: [],
		metadata: {},
		parent_id: null,
		depends_on: null,
		...overrides
	};
}

export function makeMemory(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	const now = new Date().toISOString();
	return {
		id: randomUUID(),
		type: "code_fact",
		title: "Dedup memory title",
		content: "Alice worked on the deployment for Acme Corp",
		importance: 3,
		agent: "test",
		role: "tester",
		model: "test",
		scope: { owner: "test", repo: REPO },
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
		is_global: false,
		...overrides
	};
}

export function makeStandard(overrides: Partial<CodingStandardEntry> = {}): CodingStandardEntry {
	const now = new Date().toISOString();
	return {
		id: randomUUID(),
		code: `CS-${randomUUID().slice(0, 6)}`,
		title: "Dedup standard title",
		content: "Always use UUID primary keys and decimal for money",
		parent_id: null,
		context: "dedup-test",
		version: "1",
		language: "typescript",
		stack: [],
		is_global: false,
		owner: "test",
		repo: REPO,
		tags: [],
		metadata: {},
		created_at: now,
		updated_at: now,
		hit_count: 0,
		last_used_at: null,
		agent: "test",
		model: "test",
		...overrides
	};
}

/** Minimal vectors stand-in: runOnce() only needs `embed`. */
export function makeStubVectors(): RealVectorStore {
	return { embed: vi.fn().mockResolvedValue([[0.1, 0.2]]) } as unknown as RealVectorStore;
}

export function makeWorker(db: SQLiteStore): EmbeddingWorker {
	return new EmbeddingWorker(db, makeStubVectors(), {
		batchSize: 32,
		leaseMs: 60_000,
		poisonThreshold: 3,
		backoffBaseMs: 1_000,
		backoffMaxMs: 60_000,
		pollIntervalMs: 3_600_000, // never fires in tests
		purgeIntervalMs: 3_600_000,
		backfillCap: 0
	});
}

export function getJob(db: SQLiteStore, kind: string, entityId: string): Record<string, unknown> | undefined {
	return db.db.prepare("SELECT * FROM queue_jobs WHERE entity_kind = ? AND entity_id = ?").get(kind, entityId) as
		Record<string, unknown> | undefined;
}

export function countRows(db: SQLiteStore, sql: string, params: unknown[] = []): number {
	return (db.db.prepare(sql).get(...params) as { cnt: number }).cnt;
}
