import { logger } from "../../utils/logger";
import type { Migration } from "./index";

/**
 * v37 — vector storage format: JSON TEXT → float32 little-endian BLOB
 * (TASK-038).
 *
 * Dense embeddings were written as `JSON.stringify(Array.from(float32))`:
 * a 384-dim all-MiniLM-L6-v2 vector serialized as ~8,050 characters of
 * decimal text (~8,219 bytes) instead of `384 * 4 = 1,536` bytes. That is a
 * measured **5.24x** waste across `memory_vectors` (75.3 MiB / 9,601 rows),
 * `task_vectors` (63.0 MiB / 8,037 rows) and `standard_vectors`
 * (23.5 MiB / 2,994 rows) — 161.7 MiB total, ~127-135 MB reclaimable with
 * ZERO recall risk (no quantization, no dimension change) and no 8 KB
 * `JSON.parse` per candidate per vector search.
 *
 * SQLite columns are dynamically typed, so this is a pure data rewrite: the
 * `vector` column keeps its declared `TEXT` affinity but now stores the raw
 * little-endian float32 bytes as a BLOB. No table rebuild, no index churn.
 *
 * Idempotent + defensive:
 *  - Tables are probed in `sqlite_master` and skipped when absent.
 *  - A row whose value is already a BLOB (`typeof !== "string"`) is skipped,
 *    so a re-run after a crash mid-migration is a no-op for converted rows.
 *  - Only JSON arrays are converted. Sparse TF maps (JSON objects written by
 *    `StubVectorStore`) have no fixed dimension and are left as TEXT.
 *
 * The rewrite is batched by `rowid` (keyset pagination) to bound peak memory
 * on multi-thousand-row tables, but runs inside the runner's single
 * transaction like every other migration — a crash rolls the whole thing back.
 */
const TABLES = ["memory_vectors", "task_vectors", "standard_vectors"] as const;

/** Rows rewritten per round-trip; bounds peak memory on large tables. */
const BATCH_SIZE = 500;

function tableExists(db: Parameters<Migration["up"]>[0], table: string): boolean {
	const row = db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
	return row !== undefined;
}

/**
 * Rewrite every JSON-array `vector` in `table` to a float32 BLOB. Returns the
 * number of rows converted.
 */
function convertTable(db: Parameters<Migration["up"]>[0], table: string): number {
	if (!tableExists(db, table)) {
		logger.debug(`[Migration] v37: ${table} absent, skipping`);
		return 0;
	}

	const selectBatch = db.prepare(`SELECT rowid AS rid, vector FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ?`);
	const update = db.prepare(`UPDATE ${table} SET vector = ? WHERE rowid = ?`);

	let converted = 0;
	let lastRowid = 0;
	for (;;) {
		const batch = selectBatch.all(lastRowid, BATCH_SIZE) as Array<{ rid: number; vector: unknown }>;
		if (batch.length === 0) break;
		for (const row of batch) {
			lastRowid = row.rid;
			// Already a BLOB (converted on a prior run / written post-v37) or a
			// sparse TF map (JSON object) — leave untouched.
			if (typeof row.vector !== "string") continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(row.vector);
			} catch {
				continue;
			}
			if (!Array.isArray(parsed)) continue;
			const f32 = Float32Array.from(parsed as number[]);
			update.run(Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength), row.rid);
			converted++;
		}
	}
	return converted;
}

export const migration: Migration = {
	version: 37,
	name: "vector-blob-format",
	up: (db) => {
		let total = 0;
		for (const table of TABLES) {
			const converted = convertTable(db, table);
			total += converted;
			logger.debug(`[Migration] v37: converted ${converted} ${table} rows to float32 BLOB`);
		}
		logger.info(`[Migration] Rewrote ${total} dense vector rows from JSON TEXT to float32 BLOB (TASK-038)`);
	}
};
