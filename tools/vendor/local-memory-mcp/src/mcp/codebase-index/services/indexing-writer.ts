/**
 * indexing-writer — DB write operations for indexing results.
 *
 * Extracted from indexing-repository.ts STORE + CLEAN sections.
 * Handles batch upsert of files/symbols, rename transfers, and stale cleanup.
 */

import type { SQLiteStore } from "../../storage/sqlite";
import type { CodebaseFileInsert, CodebaseSymbolInsert, CodebaseReferenceInsert } from "../../types";
import { logger } from "../../utils/logger";
import { retryDbWrite } from "./indexing-cache";
import { codebaseEntityId, enqueueCodebaseSymbols } from "../../embedding-queue/enqueue";
import { observationText } from "../../tools/kg-archivist/observation-text";

// ── Local type aliases (avoid circular dep with indexing-repository) ────

export interface IndexProgress {
	stage: "discovering" | "parsing" | "storing" | "cleaning";
	current: number;
	total: number;
	message: string;
}

export interface IndexFileError {
	filePath: string;
	error: string;
}

// ── Writer result ────────────────────────────────────────────────────────

export interface WriteResult {
	errors: IndexFileError[];
	totalSymbols: number;
	dbWriteErrors: number;
}

// ── Write context ────────────────────────────────────────────────────────

export interface WriteContext {
	db: SQLiteStore;
	repo: string;
	/** Scope owner forwarded to codebase→KG enqueue (FIX-OWNER-CODEBASE). */
	owner?: string;
	fileInserts: CodebaseFileInsert[];
	symbolInserts: CodebaseSymbolInsert[];
	referenceInserts?: CodebaseReferenceInsert[];
	renameMap: Map<string, string>;
	stalePaths: Set<string>;
	batchSize: number;
	options: { onProgress?: (progress: IndexProgress) => void };
}

/**
 * Base writer context shared by the incremental write steps.
 *
 * The repository now flushes fileInserts/symbolInserts per parse batch
 * (bounded memory — Fix #3) instead of accumulating the whole repo, so the
 * aggregate `writeIndexResults` was split into composable steps:
 *
 *   1. `applyRenames`   — transfer file + symbol records for detected renames
 *   2. `writeParseBatch` — upsert files + replace symbols for ONE parse batch
 *   3. `cleanStaleFiles` — delete records for files no longer on disk
 */
export interface WriteBaseContext {
	db: SQLiteStore;
	repo: string;
	/**
	 * Scope owner threaded from the index caller and forwarded to the
	 * codebase→KG enqueue (FIX-OWNER-CODEBASE). Empty/undefined falls back to
	 * the historical owner-less behavior.
	 */
	owner?: string;
	batchSize: number;
	options: { onProgress?: (progress: IndexProgress) => void };
}

// ── Helper ───────────────────────────────────────────────────────────────

function emitProgress(options: { onProgress?: (progress: IndexProgress) => void }, progress: IndexProgress): void {
	if (options.onProgress) {
		try {
			options.onProgress(progress);
		} catch {
			// Progress callback must never kill the indexing pipeline
		}
	}
}

// ── Incremental write steps ─────────────────────────────────────────────

/**
 * Step 1 — transfer renamed file + symbol records (old path → new path).
 *
 * Preserves the existing contract: rename transfer failures propagate to the
 * caller (the only uncovered throw path in the writer).
 *
 * Renamed files are never re-parsed (parse-pipeline rename skip), so they
 * bypass the writeParseBatch codebase → KG enqueue funnel. To keep the
 * "codebase" KG domain consistent with the rename (TASK-340), each transfer
 * also:
 *   1. purges the OLD-path queue_jobs row so a pending job can never re-run
 *      KG extraction for a path that no longer exists (mirrors the
 *      cleanStaleFiles queue purge), and
 *   2. re-enqueues under the NEW path from the transferred symbols/refs so
 *      the worker re-derives the observation text for the new path
 *      (unchanged transfers LWW-dedup to a single new-path row).
 * Both run inside the same exclusive write as the transfer, so a failure
 * rolls the whole rename back together.
 *
 * @returns Number of DB write errors (always 0 — failures throw).
 */
export async function applyRenames(base: WriteBaseContext, renameMap: Map<string, string>): Promise<number> {
	const { db, repo, owner } = base;

	if (renameMap.size === 0) return 0;

	await retryDbWrite(async () => {
		await db.withExclusiveWrite(async () => {
			for (const [newPath, oldPath] of renameMap) {
				db.codebaseFiles.transferFile(repo, oldPath, newPath);
				db.codebaseSymbols.transferSymbolsFilePath(repo, oldPath, newPath);
				db.codebaseReferences.transferReferencesFilePath(repo, oldPath, newPath);
				db.explorationObservations.transferEvidencePath(repo, oldPath, newPath);

				// Purge the old-path queue job — the file record no longer
				// exists under this entity id, so any pending job would re-run
				// KG extraction against a stale precheck miss (TASK-340).
				db.db
					.prepare("DELETE FROM queue_jobs WHERE entity_kind = 'codebase_symbol' AND entity_id = ?")
					.run(codebaseEntityId(repo, oldPath));

				// Re-enqueue the renamed file under its NEW path from the
				// transferred rows (symbols + caller edges), mirroring the
				// writeParseBatch enqueue gate: only files with signal
				// (symbols OR references) enqueue — zero-signal files would
				// only ever no-op. Row types carry `null` where the insert
				// types want `undefined`, so the transferred rows are
				// normalized before the payload builder consumes them.
				const symbols: CodebaseSymbolInsert[] = db.codebaseSymbols.getSymbolsByFile(repo, newPath).map((s) => ({
					repo: s.repo,
					file_path: s.file_path,
					name: s.name,
					kind: s.kind,
					exported: s.exported,
					default_export: s.default_export,
					start_line: s.start_line ?? undefined,
					start_col: s.start_col ?? undefined,
					end_line: s.end_line ?? undefined,
					end_col: s.end_col ?? undefined,
					signature: s.signature,
					doc_comment: s.doc_comment,
					parent_symbol_id: s.parent_symbol_id
				}));
				const refs: CodebaseReferenceInsert[] = db.codebaseReferences.getReferencesByFile(repo, newPath).map((r) => ({
					repo: r.repo,
					symbol_name: r.symbol_name,
					caller_file: r.caller_file,
					caller_line: r.caller_line ?? undefined,
					caller_name: r.caller_name,
					kind: r.kind,
					target_file: r.target_file,
					target_symbol_id: r.target_symbol_id,
					role: r.role,
					local_name: r.local_name,
					imported_name: r.imported_name,
					module_specifier: r.module_specifier,
					import_kind: r.import_kind
				}));
				if (symbols.length > 0 || refs.length > 0) {
					enqueueCodebaseSymbols(db, repo, newPath, symbols, refs, owner);
				}
				db.explorationObservations.refreshForFiles(repo, [newPath]);
			}
		});
	}, "rename-transfer");

	// KG cleanup for renamed codebase files (TASK-340): remove the OLD-path
	// "codebase" observation text + orphan-sweep so the renamed file is never
	// doubly observed under both paths (mirrors cleanStaleFiles's best-effort,
	// repo-scoped contract). Best-effort — never throws.
	if (renameMap.size > 0) {
		const observationItems: { text: string; repo: string }[] = [];
		for (const [, oldPath] of renameMap) {
			observationItems.push({ text: observationText("codebase", oldPath), repo });
		}
		try {
			db.knowledgeGraph.deleteObservationsAndOrphans(observationItems);
		} catch (kgError) {
			logger.warn("[KG-Rename] Failed to clean up KG observations for renamed codebase files", {
				error: String(kgError)
			});
		}
	}

	return 0;
}

/**
 * Steps 2 + 3 — persist ONE parse batch: upsert file records and replace the
 * symbols of the re-parsed files (delete old, bulk insert new).
 *
 * Also the codebase → KG outbox funnel (TASK-293): one `codebase_symbol`
 * queue job is enqueued per re-parsed file (symbols or references present),
 * atomically with the symbol replace — BOTH `handleCodebaseIndexRepository`
 * and `autoIndexIfStale` route here via `performIndexRepository` →
 * `runParsePipeline`.
 *
 * Called once per parse batch so the repository never accumulates inserts for
 * the whole repo in memory.
 *
 * @returns Number of DB write errors encountered (0 on success).
 */
export async function writeParseBatch(
	base: WriteBaseContext,
	fileInserts: CodebaseFileInsert[],
	symbolInserts: CodebaseSymbolInsert[],
	renameMap: Map<string, string>,
	referenceInserts: CodebaseReferenceInsert[] = []
): Promise<number> {
	const { db, repo, owner, batchSize, options } = base;
	let dbWriteErrors = 0;

	// ── 2. Upsert files in batches within transaction ─
	{
		let storeOffset = 0;
		let storedCount = 0;

		while (storeOffset < fileInserts.length) {
			const batch = fileInserts.slice(storeOffset, storeOffset + batchSize);
			try {
				await retryDbWrite(async () => {
					await db.withExclusiveWrite(async () => {
						for (const fi of batch) {
							db.codebaseFiles.upsertFile(fi);
						}
					});
				}, `file-insert-batch-${storeOffset}`);
			} catch (err) {
				dbWriteErrors++;
				logger.error("[IndexingWriter] File batch insert failed", {
					batchOffset: storeOffset,
					error: String(err)
				});
			}
			storedCount += batch.length;
			emitProgress(options, {
				stage: "storing",
				current: storedCount,
				total: fileInserts.length + renameMap.size + symbolInserts.length,
				message: `Stored ${storedCount}/${fileInserts.length} files...`
			});
			storeOffset += batchSize;
		}
	}

	// ── 3. Delete old symbols for re-parsed files, then insert new symbols ─
	{
		// Collect file paths that were actually parsed in this batch.
		// Renamed paths never reach here (they are skipped at decision time),
		// but the exclusion is kept defensively — their symbols were
		// transferred, not replaced.
		const reindexedPaths = new Set<string>();
		for (const fi of fileInserts) {
			if (!renameMap.has(fi.file_path)) {
				reindexedPaths.add(fi.file_path);
			}
		}

		try {
			await retryDbWrite(async () => {
				await db.withExclusiveWrite(async () => {
					// ONE SQLite transaction (BEGIN IMMEDIATE) covers the whole
					// batch (issue #69): delete symbols for every re-parsed path,
					// then bulk-insert the new symbols across chunk boundaries —
					// a single commit, so delete+insert is atomic. A failure
					// mid-batch rolls back the entire batch (no symbol leakage,
					// no duplicate rows). `bulkUpsertSymbols` opens a transaction
					// internally; better-sqlite3 turns the nested call into a
					// SAVEPOINT inside this outer transaction, so the rollback
					// still reverts the whole batch.
					db.db
						.transaction(() => {
							// Mark every affected observation stale first. The bounded
							// structural refresh below can promote unchanged evidence back to
							// valid; rows beyond its cap remain conservatively stale.
							db.explorationObservations.markFilesStale(repo, [...reindexedPaths], "file_reindexed");
							for (const fp of reindexedPaths) {
								db.codebaseSymbols.deleteSymbolsByFile(repo, fp);
							}

							let symOffset = 0;
							while (symOffset < symbolInserts.length) {
								db.codebaseSymbols.bulkUpsertSymbols(symbolInserts.slice(symOffset, symOffset + batchSize));
								symOffset += batchSize;
							}

							// 3b. Call-site references (TASK-236 / #64): delete the
							// re-parsed files' refs then bulk-insert the fresh set,
							// atomically with the symbol replace above.
							for (const fp of reindexedPaths) {
								db.codebaseReferences.deleteReferencesByFile(repo, fp);
							}
							let refOffset = 0;
							while (refOffset < referenceInserts.length) {
								db.codebaseReferences.bulkUpsertReferences(
									repo,
									referenceInserts.slice(refOffset, refOffset + batchSize)
								);
								refOffset += batchSize;
							}

							// 3c. Codebase → KG outbox (TASK-293): enqueue ONE
							// embedding/KG job per re-parsed file (stable
							// `<repo>::<file_path>` entity id) so the worker can
							// KG-extract the "codebase" observation domain. Atomic
							// with the symbol replace — a commit includes the queue
							// rows, a rollback excludes them (no orphan jobs for
							// files whose symbols were never persisted). Content-
							// hash dedup makes unchanged re-parses no-ops; a changed
							// file LWW-updates its single row. Only files that
							// produced symbols or reference edges are enqueued
							// (zero-signal files would only ever no-op).
							const symbolsByFile = new Map<string, CodebaseSymbolInsert[]>();
							for (const s of symbolInserts) {
								const arr = symbolsByFile.get(s.file_path) ?? [];
								arr.push(s);
								symbolsByFile.set(s.file_path, arr);
							}
							const refsByFile = new Map<string, CodebaseReferenceInsert[]>();
							for (const r of referenceInserts) {
								const arr = refsByFile.get(r.caller_file) ?? [];
								arr.push(r);
								refsByFile.set(r.caller_file, arr);
							}
							for (const fp of reindexedPaths) {
								const symbols = symbolsByFile.get(fp);
								const refs = refsByFile.get(fp);
								if ((symbols && symbols.length > 0) || (refs && refs.length > 0)) {
									enqueueCodebaseSymbols(db, repo, fp, symbols ?? [], refs ?? [], owner);
								}
							}
							db.explorationObservations.refreshForFiles(repo, [...reindexedPaths]);
						})
						.immediate();
				});
			}, "symbol-replace-batch");
		} catch (err) {
			dbWriteErrors++;
			logger.error("[IndexingWriter] Symbol replace batch failed", {
				error: String(err)
			});
		}
	}

	emitProgress(options, {
		stage: "storing",
		current: fileInserts.length + renameMap.size + symbolInserts.length,
		total: fileInserts.length + renameMap.size + symbolInserts.length,
		message: `Stored ${symbolInserts.length} symbols across batches.`
	});

	return dbWriteErrors;
}

/**
 * Step 4 — clean records for files no longer on disk.
 *
 * @returns Number of DB write errors encountered (0 on success).
 */
export async function cleanStaleFiles(base: WriteBaseContext, stalePaths: Set<string>): Promise<number> {
	const { db, repo, options } = base;
	let dbWriteErrors = 0;

	if (stalePaths.size === 0) return 0;

	emitProgress(options, {
		stage: "cleaning",
		current: 0,
		total: stalePaths.size,
		message: `Cleaning ${stalePaths.size} stale files...`
	});

	try {
		await retryDbWrite(async () => {
			await db.withExclusiveWrite(async () => {
				// Chunked cleanup (TASK-457): the old ONE transaction for every
				// stale path (issue #69) held the SQLite write lock for the whole
				// sweep — on a large cleanup (hundreds of deleted files) that
				// starved sibling writers (embedding worker / another MCP server)
				// past busy_timeout=5000 ("database is locked"). Each chunk still
				// commits atomically (a failure mid-chunk rolls back just that
				// chunk), bounding the per-transaction write-lock hold to
				// CLEANUP_TXN_CHUNK paths while preserving the per-file operations
				// (symbol/ref/job/file deletion) exactly.
				const CLEANUP_TXN_CHUNK = 200;
				const paths = [...stalePaths];
				let cleanedCount = 0;
				for (let start = 0; start < paths.length; start += CLEANUP_TXN_CHUNK) {
					const chunk = paths.slice(start, start + CLEANUP_TXN_CHUNK);
					db.db
						.transaction(() => {
							db.explorationObservations.markFilesStale(repo, chunk, "file_deleted");
							for (const fp of chunk) {
								db.codebaseSymbols.deleteSymbolsByFile(repo, fp);
								db.codebaseReferences.deleteReferencesByFile(repo, fp);
								// Purge pending codebase jobs for the deleted files so a
								// stale job can never re-run KG extraction for a file
								// that no longer exists (TASK-293 — mirrors the
								// memory/task/standard delete-tool purge contract).
								db.db
									.prepare("DELETE FROM queue_jobs WHERE entity_kind = 'codebase_symbol' AND entity_id = ?")
									.run(codebaseEntityId(repo, fp));
								db.codebaseFiles.deleteFile(repo, fp);
								cleanedCount++;
								emitProgress(options, {
									stage: "cleaning",
									current: cleanedCount,
									total: stalePaths.size,
									message: `Cleaned ${cleanedCount}/${stalePaths.size}: ${fp}`
								});
							}
						})
						.immediate();
				}
			});
		}, "stale-cleanup");
	} catch (err) {
		dbWriteErrors++;
		logger.error("[IndexingWriter] Stale cleanup failed", {
			error: String(err)
		});
	}

	// KG cleanup for stale codebase files (TASK-293): remove the file-scoped
	// "codebase" observations + orphan-sweep, mirroring
	// purgeEntityAndCleanup's best-effort, repo-scoped contract
	// (deleteObservationsAndOrphans). Best-effort — never throws.
	if (stalePaths.size > 0) {
		const observationItems: { text: string; repo: string }[] = [];
		for (const fp of stalePaths) {
			observationItems.push({ text: observationText("codebase", fp), repo });
		}
		try {
			db.knowledgeGraph.deleteObservationsAndOrphans(observationItems);
		} catch (kgError) {
			logger.warn("[KG-Cleanup] Failed to clean up KG entities for deleted codebase files", {
				error: String(kgError)
			});
		}
	}

	return dbWriteErrors;
}

// ── Aggregate writer (backward-compatible composition) ──────────────────

/**
 * Persist indexing results to the database.
 *
 * Composition of the incremental steps (kept for backward compatibility):
 *   1. Handle renames (transfer file + symbol records)
 *   2. Upsert file records in batches
 *   3. Delete old symbols, bulk insert new symbols
 *   4. Clean stale file records
 */
export async function writeIndexResults(ctx: WriteContext): Promise<WriteResult> {
	const { db, repo, fileInserts, symbolInserts, referenceInserts, renameMap, stalePaths, batchSize, options } = ctx;
	const base: WriteBaseContext = { db, repo, batchSize, options };

	let dbWriteErrors = 0;
	dbWriteErrors += await applyRenames(base, renameMap);
	dbWriteErrors += await writeParseBatch(base, fileInserts, symbolInserts, renameMap, referenceInserts);
	dbWriteErrors += await cleanStaleFiles(base, stalePaths);

	return {
		errors: [],
		totalSymbols: symbolInserts.length,
		dbWriteErrors
	};
}
