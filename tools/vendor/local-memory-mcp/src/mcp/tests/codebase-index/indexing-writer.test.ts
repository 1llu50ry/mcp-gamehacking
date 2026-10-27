/**
 * Unit tests for the codebase-index writer (indexing-writer.ts).
 *
 * Focus: transactional atomicity (issue #69) — per-batch symbol delete+insert
 * and per-cleanup stale deletions commit as ONE SQLite transaction, so a
 * failure mid-batch rolls back the entire batch (no symbol leakage, no
 * duplicate rows).
 */

import { describe, it, expect, afterEach } from "vitest";
import { createTestStore, SQLiteStore } from "../../storage/sqlite";
import {
	writeParseBatch,
	cleanStaleFiles,
	applyRenames,
	WriteBaseContext
} from "../../codebase-index/services/indexing-writer";
import { codebaseEntityId } from "../../embedding-queue/enqueue";
import { observationText } from "../../tools/kg-archivist";
import { randomUUID } from "crypto";
import type { CodebaseFileInsert, CodebaseSymbolInsert, CodebaseReferenceInsert } from "../../types";

// Kept at module scope so tests keep their own store and close it via afterEach.
const activeStores: SQLiteStore[] = [];

async function makeStore(): Promise<SQLiteStore> {
	const store = await createTestStore();
	activeStores.push(store);
	return store;
}

function base(db: SQLiteStore, repo: string): WriteBaseContext {
	return { db, repo, batchSize: 50, options: {} };
}

describe("indexing-writer", () => {
	afterEach(() => {
		while (activeStores.length > 0) {
			activeStores.pop()!.close();
		}
	});

	it("writeParseBatch: delete + insert are atomic — failure mid-batch rolls back deletes", async () => {
		const store = await makeStore();
		const repo = "test-repo";

		// Seed existing symbols for both re-parsed files.
		store.codebaseSymbols.bulkUpsertSymbols([
			{ repo, file_path: "a.ts", name: "oldA", kind: "function" },
			{ repo, file_path: "b.ts", name: "oldB", kind: "function" }
		]);

		const fileInserts: CodebaseFileInsert[] = [
			{ repo, file_path: "a.ts" },
			{ repo, file_path: "b.ts" }
		];

		// The second insert violates the parent_symbol_id FK, so it throws AFTER
		// the deletes have already run and the first insert has gone in — the
		// whole batch (deletes + inserts) must roll back as one unit.
		const symbolInserts: CodebaseSymbolInsert[] = [
			{ repo, file_path: "a.ts", name: "newA", kind: "function" },
			{ repo, file_path: "b.ts", name: "newB", kind: "function", parent_symbol_id: "missing-parent" }
		];

		const dbWriteErrors = await writeParseBatch(base(store, repo), fileInserts, symbolInserts, new Map());

		expect(dbWriteErrors).toBeGreaterThan(0);

		// Deletes rolled back: original symbols for BOTH files still present.
		expect(store.codebaseSymbols.getSymbolsByFile(repo, "a.ts").map((s) => s.name)).toEqual(["oldA"]);
		expect(store.codebaseSymbols.getSymbolsByFile(repo, "b.ts").map((s) => s.name)).toEqual(["oldB"]);
		// No partial inserts leaked either.
		expect(store.codebaseSymbols.getSymbolsByFile(repo, "a.ts").some((s) => s.name === "newA")).toBe(false);
		expect(store.codebaseSymbols.getSymbolsByFile(repo, "b.ts").some((s) => s.name === "newB")).toBe(false);
	});

	it("writeParseBatch: successful batch replaces old symbols with new ones (no duplicates)", async () => {
		const store = await makeStore();
		const repo = "test-repo";

		store.codebaseSymbols.bulkUpsertSymbols([{ repo, file_path: "a.ts", name: "oldA", kind: "function" }]);

		const fileInserts: CodebaseFileInsert[] = [{ repo, file_path: "a.ts" }];
		const symbolInserts: CodebaseSymbolInsert[] = [{ repo, file_path: "a.ts", name: "newA", kind: "function" }];

		const dbWriteErrors = await writeParseBatch(base(store, repo), fileInserts, symbolInserts, new Map());

		expect(dbWriteErrors).toBe(0);

		// Old symbol gone, new one present, exactly one row for a.ts.
		const names = store.codebaseSymbols.getSymbolsByFile(repo, "a.ts").map((s) => s.name);
		expect(names).toEqual(["newA"]);
	});

	it("writeParseBatch: delete-only batch (no symbol inserts) still clears old symbols", async () => {
		const store = await makeStore();
		const repo = "test-repo";

		store.codebaseSymbols.bulkUpsertSymbols([{ repo, file_path: "a.ts", name: "stale", kind: "function" }]);

		const fileInserts: CodebaseFileInsert[] = [{ repo, file_path: "a.ts" }];
		const dbWriteErrors = await writeParseBatch(base(store, repo), fileInserts, [], new Map());

		expect(dbWriteErrors).toBe(0);
		expect(store.codebaseSymbols.getSymbolsByFile(repo, "a.ts")).toEqual([]);
	});

	it("cleanStaleFiles: removes stale symbol + file records", async () => {
		const store = await makeStore();
		const repo = "test-repo";

		store.codebaseSymbols.bulkUpsertSymbols([
			{ repo, file_path: "gone.ts", name: "gone", kind: "function" },
			{ repo, file_path: "keep.ts", name: "keep", kind: "function" }
		]);
		store.codebaseFiles.upsertFile({ repo, file_path: "gone.ts" });
		store.codebaseFiles.upsertFile({ repo, file_path: "keep.ts" });

		const errors = await cleanStaleFiles(base(store, repo), new Set(["gone.ts"]));

		expect(errors).toBe(0);
		expect(store.codebaseFiles.getFilesByRepo(repo).map((f) => f.file_path)).toEqual(["keep.ts"]);
		expect(store.codebaseSymbols.getSymbolsByFile(repo, "gone.ts")).toEqual([]);
	});

	// -----------------------------------------------------------------------
	// Codebase → KG outbox wiring (TASK-293)
	// -----------------------------------------------------------------------

	it("writeParseBatch enqueues ONE codebase_symbol job per re-parsed file (single funnel for tool + autoIndex)", async () => {
		const store = await makeStore();
		const repo = "test-repo";

		const fileInserts: CodebaseFileInsert[] = [{ repo, file_path: "a.ts" }];
		const symbolInserts: CodebaseSymbolInsert[] = [{ repo, file_path: "a.ts", name: "newA", kind: "function" }];
		const referenceInserts: CodebaseReferenceInsert[] = [
			{ repo, symbol_name: "dep", caller_file: "a.ts", caller_line: 1, caller_name: "newA", kind: "call" }
		];

		const errors = await writeParseBatch(base(store, repo), fileInserts, symbolInserts, new Map(), referenceInserts);
		expect(errors).toBe(0);

		// One queue job for the file, keyed by the stable <repo>::<file_path> id.
		const row = store.db
			.prepare("SELECT payload FROM queue_jobs WHERE entity_kind = 'codebase_symbol' AND entity_id = ?")
			.get(codebaseEntityId(repo, "a.ts")) as { payload: string } | undefined;
		expect(row).toBeDefined();

		const payload = JSON.parse(row!.payload) as { content: string; codebaseRefDigest?: string };
		expect(payload.content).toContain("newA (function)");
		// The ref digest makes the content hash sensitive to call-graph changes.
		expect(payload.codebaseRefDigest).toBeTruthy();
	});

	it("writeParseBatch: an identical re-parse LWW-dedups to a single queue row", async () => {
		const store = await makeStore();
		const repo = "test-repo";

		const fileInserts: CodebaseFileInsert[] = [{ repo, file_path: "a.ts" }];
		const symbolInserts: CodebaseSymbolInsert[] = [{ repo, file_path: "a.ts", name: "newA", kind: "function" }];

		expect(await writeParseBatch(base(store, repo), fileInserts, symbolInserts, new Map())).toBe(0);
		expect(await writeParseBatch(base(store, repo), fileInserts, symbolInserts, new Map())).toBe(0);

		expect(
			(
				store.db
					.prepare("SELECT COUNT(*) as cnt FROM queue_jobs WHERE entity_kind = 'codebase_symbol' AND entity_id = ?")
					.get(codebaseEntityId(repo, "a.ts")) as { cnt: number }
			).cnt
		).toBe(1);
	});

	it("cleanStaleFiles purges the codebase job + removes the file's KG observations (delete path)", async () => {
		const store = await makeStore();
		const repo = "test-repo";

		// Seed the file + symbols and run a parse batch so the job exists.
		const fileInserts: CodebaseFileInsert[] = [{ repo, file_path: "gone.ts" }];
		const symbolInserts: CodebaseSymbolInsert[] = [{ repo, file_path: "gone.ts", name: "gone", kind: "function" }];
		await writeParseBatch(base(store, repo), fileInserts, symbolInserts, new Map());
		expect(
			(
				store.db
					.prepare("SELECT COUNT(*) as cnt FROM queue_jobs WHERE entity_kind = 'codebase_symbol' AND entity_id = ?")
					.get(codebaseEntityId(repo, "gone.ts")) as { cnt: number }
			).cnt
		).toBe(1);

		// Simulate KG rows the worker already produced for the file.
		const now = new Date().toISOString();
		const obsText = observationText("codebase", "gone.ts");
		store.knowledgeGraph.ensureObservation({
			id: randomUUID(),
			name: "gone",
			type: "function",
			description: null,
			observation: obsText,
			repo,
			owner: "",
			created_at: now
		});

		const errors = await cleanStaleFiles(base(store, repo), new Set(["gone.ts"]));
		expect(errors).toBe(0);

		// Queue row purged and the file-scoped KG observation + orphan swept.
		expect(
			(
				store.db
					.prepare("SELECT COUNT(*) as cnt FROM queue_jobs WHERE entity_kind = 'codebase_symbol' AND entity_id = ?")
					.get(codebaseEntityId(repo, "gone.ts")) as { cnt: number }
			).cnt
		).toBe(0);
		expect(
			(
				store.db
					.prepare("SELECT COUNT(*) as cnt FROM observations WHERE observation = ? AND repo = ?")
					.get(obsText, repo) as { cnt: number }
			).cnt
		).toBe(0);
	});

	it("cleanStaleFiles with > 200 stale paths clears files/symbols/jobs across chunks (TASK-457)", async () => {
		const store = await makeStore();
		const repo = "test-repo";

		// CLEANUP_TXN_CHUNK = 200 (indexing-writer.ts): 250 stale files →
		// 2 immediate write transactions. Seed via writeParseBatch so file +
		// symbol + codebase_symbol queue rows all exist for every stale path.
		const COUNT = 250;
		const fileInserts: CodebaseFileInsert[] = [];
		const symbolInserts: CodebaseSymbolInsert[] = [];
		const stale = new Set<string>();
		for (let i = 0; i < COUNT; i++) {
			const path = `gone-${i}.ts`;
			fileInserts.push({ repo, file_path: path });
			symbolInserts.push({ repo, file_path: path, name: `goneSym-${i}`, kind: "function" });
			stale.add(path);
		}
		expect(await writeParseBatch(base(store, repo), fileInserts, symbolInserts, new Map())).toBe(0);
		expect(
			(
				store.db.prepare("SELECT COUNT(*) as cnt FROM queue_jobs WHERE entity_kind = 'codebase_symbol'").get() as {
					cnt: number;
				}
			).cnt
		).toBe(COUNT);

		expect(await cleanStaleFiles(base(store, repo), stale)).toBe(0);

		// Every chunk's per-file ops ran: file records, symbols, and queue
		// jobs for ALL stale paths are gone — chunking preserved the per-file
		// delete contract without dropping rows at chunk boundaries.
		expect(store.codebaseFiles.getFilesByRepo(repo)).toEqual([]);
		expect(store.codebaseSymbols.getAllSymbols().length).toBe(0);
		expect(
			(
				store.db.prepare("SELECT COUNT(*) as cnt FROM queue_jobs WHERE entity_kind = 'codebase_symbol'").get() as {
					cnt: number;
				}
			).cnt
		).toBe(0);
	});

	it("applyRenames: purges old-path queue job, enqueues the new path, removes old-path KG observation (rename path)", async () => {
		const store = await makeStore();
		const repo = "test-repo";

		// Seed the file under the OLD path exactly like a prior index run:
		// file record + symbols + reference edges, which also enqueues the
		// old-path codebase_symbol job via the writeParseBatch funnel.
		const fileInserts: CodebaseFileInsert[] = [{ repo, file_path: "old.ts" }];
		const symbolInserts: CodebaseSymbolInsert[] = [
			{ repo, file_path: "old.ts", name: "renamedSym", kind: "function", doc_comment: "renamed symbol" }
		];
		const referenceInserts: CodebaseReferenceInsert[] = [
			{ repo, symbol_name: "dep", caller_file: "old.ts", caller_line: 1, caller_name: "renamedSym", kind: "call" }
		];
		expect(await writeParseBatch(base(store, repo), fileInserts, symbolInserts, new Map(), referenceInserts)).toBe(0);

		const oldJobId = codebaseEntityId(repo, "old.ts");
		const newJobId = codebaseEntityId(repo, "new.ts");
		expect(
			(
				store.db
					.prepare("SELECT COUNT(*) as cnt FROM queue_jobs WHERE entity_kind = 'codebase_symbol' AND entity_id = ?")
					.get(oldJobId) as { cnt: number }
			).cnt
		).toBe(1);

		// Simulate KG rows the worker already produced for the OLD path.
		const now = new Date().toISOString();
		const oldObsText = observationText("codebase", "old.ts");
		store.knowledgeGraph.ensureObservation({
			id: randomUUID(),
			name: "renamedSym",
			type: "function",
			description: null,
			observation: oldObsText,
			repo,
			owner: "",
			created_at: now
		});

		// Rename old.ts → new.ts.
		expect(await applyRenames(base(store, repo), new Map([["new.ts", "old.ts"]]))).toBe(0);

		// Old-path queue row purged.
		expect(
			(
				store.db
					.prepare("SELECT COUNT(*) as cnt FROM queue_jobs WHERE entity_kind = 'codebase_symbol' AND entity_id = ?")
					.get(oldJobId) as { cnt: number }
			).cnt
		).toBe(0);

		// New-path job enqueued from the transferred symbols/refs.
		expect(
			(
				store.db
					.prepare("SELECT COUNT(*) as cnt FROM queue_jobs WHERE entity_kind = 'codebase_symbol' AND entity_id = ?")
					.get(newJobId) as { cnt: number }
			).cnt
		).toBe(1);
		const newPayload = JSON.parse(
			(
				store.db
					.prepare("SELECT payload FROM queue_jobs WHERE entity_kind = 'codebase_symbol' AND entity_id = ?")
					.get(newJobId) as { payload: string }
			).payload
		) as { content: string; title: string; codebaseRefDigest?: string };
		expect(newPayload.title).toBe("new.ts");
		expect(newPayload.content).toContain("renamedSym (function)");
		// Caller edges survived the transfer, so the ref digest is present.
		expect(newPayload.codebaseRefDigest).toBeTruthy();

		// Symbols + refs transferred to the new path.
		expect(store.codebaseSymbols.getSymbolsByFile(repo, "new.ts").map((s) => s.name)).toEqual(["renamedSym"]);
		expect(store.codebaseReferences.getReferencesByFile(repo, "new.ts").map((r) => r.symbol_name)).toEqual(["dep"]);

		// Old-path KG observation removed + orphan entity swept.
		expect(
			(
				store.db
					.prepare("SELECT COUNT(*) as cnt FROM observations WHERE observation = ? AND repo = ?")
					.get(oldObsText, repo) as { cnt: number }
			).cnt
		).toBe(0);
		expect(
			(store.db.prepare("SELECT COUNT(*) as cnt FROM entities WHERE name = 'renamedSym'").get() as { cnt: number }).cnt
		).toBe(0);
	});

	it("indexing lifecycle keeps exploration observations honest: reindex, rename, and delete (issue #92)", async () => {
		const store = await makeStore();
		const repo = "test-repo";
		const owner = "test-owner";

		// Index a file with a symbol, then publish an observation against it.
		expect(
			await writeParseBatch(
				base(store, repo),
				[{ repo, file_path: "svc.ts", checksum: "checksum-a" }],
				[{ id: "123e4567-e89b-42d3-a456-426614174001", repo, file_path: "svc.ts", name: "run", kind: "function" }],
				new Map()
			)
		).toBe(0);
		const created = store.explorationObservations.upsertMany(owner, repo, [
			{
				subject: "run",
				fact: "The run function performs the operation.",
				confidence: 0.9,
				evidence: [{ file_path: "svc.ts", symbol_id: "123e4567-e89b-42d3-a456-426614174001" }]
			}
		])[0]!.observation;
		expect(created.freshness).toBe("valid");

		// An unrelated file's re-index must not touch the observation.
		expect(
			await writeParseBatch(
				base(store, repo),
				[{ repo, file_path: "other.ts", checksum: "other-a" }],
				[{ repo, file_path: "other.ts", name: "other", kind: "function" }],
				new Map()
			)
		).toBe(0);
		expect(store.explorationObservations.getById(owner, repo, created.id)!.freshness).toBe("valid");

		// Re-indexing the referenced file with a CHANGED symbol marks it stale.
		expect(
			await writeParseBatch(
				base(store, repo),
				[{ repo, file_path: "svc.ts", checksum: "checksum-b" }],
				[
					{
						id: "123e4567-e89b-42d3-a456-426614174002",
						repo,
						file_path: "svc.ts",
						name: "run",
						kind: "function",
						signature: "run(input: string): void"
					}
				],
				new Map()
			)
		).toBe(0);
		expect(store.explorationObservations.getById(owner, repo, created.id)!.freshness).toBe("stale");

		// A rename carries the evidence pointer to the new path.
		expect(await applyRenames(base(store, repo), new Map([["renamed.ts", "svc.ts"]]))).toBe(0);
		expect(store.explorationObservations.getById(owner, repo, created.id, true)!.evidence![0].file_path).toBe(
			"renamed.ts"
		);

		// Deleting the source marks the observation stale with a delete reason.
		expect(await cleanStaleFiles(base(store, repo), new Set(["renamed.ts"]))).toBe(0);
		const afterDelete = store.explorationObservations.getById(owner, repo, created.id)!;
		expect(afterDelete.freshness).toBe("stale");
		expect(afterDelete.stale_reason).toBe("file_deleted");
	});
});
