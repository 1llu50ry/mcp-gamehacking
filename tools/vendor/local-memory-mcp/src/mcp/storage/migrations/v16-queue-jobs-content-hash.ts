import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 16,
	name: "queue-jobs-content-hash",
	up: (db) => {
		// OPT-FLOW-03: dedup redundant re-embedds. The queue worker embeds
		// `payload.text` (ONNX) and KG-extracts from `payload.content` +
		// `payload.title` + the relation fields (parentId/decisionRefs/
		// context/stack); a touch/tag-only update bumps `updatedAt` and
		// LWW-resets the row, forcing re-inference on byte-identical
		// content. Storing a sha256 over exactly the embed/KG-relevant
		// fields lets `enqueueEmbeddingJob` skip rows whose content is
		// unchanged (see content-hash.ts for the exact field set + why
		// owner/repo/updatedAt are excluded). Mirrors the v2/v13 idempotent
		// PRAGMA table_info guard, so this is safe on both upgraded and
		// fresh DBs (v9 creates queue_jobs without the column).
		//
		// No backfill: pre-existing rows keep `content_hash` NULL, and the
		// first enqueue after this migration computes + stores the hash
		// (enqueueEmbeddingJob only dedups against a non-NULL stored hash,
		// so NULL rows are never skipped).
		const cols = db.prepare("PRAGMA table_info(queue_jobs)").all() as Array<{ name: string }>;
		if (!cols.some((c) => c.name === "content_hash")) {
			db.exec("ALTER TABLE queue_jobs ADD COLUMN content_hash TEXT");
			logger.info("[Migration] Added queue_jobs.content_hash (OPT-FLOW-03)");
		}
	}
};
