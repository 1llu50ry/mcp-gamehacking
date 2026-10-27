/**
 * purgeEntityAndCleanup — the single shared purge + cleanup contract for every
 * delete path (OPT-DRY-03).
 *
 * The three MCP delete tools (memory/standard/task) used to hand-roll the same
 * skeleton: entity delete/cancel → queue_jobs purge → vector removal → KG
 * observation delete + orphan sweep — with per-kind extras (claim release,
 * handoff expiry, child detach for tasks) and byte-identical pieces (the
 * `DELETE FROM queue_jobs WHERE entity_kind = ? AND entity_id IN (...)` txn and
 * the `catch (kgError) { logger.warn('[KG-Cleanup]…') }` block). The dashboard
 * bulk-delete endpoints (tasks/standards) additionally DIVERGED from that
 * contract — hard-deleting rows and skipping all cleanup (OPT-FEAT-04 tester
 * findings, 0b96ad7).
 *
 * This helper is the one place those semantics live: the MCP delete tools
 * (single + bulk, memory/task/standard) and the dashboard delete paths
 * (single + bulk, memory/task/standard — TASK-207) route here so a change to
 * purge/KG semantics lands once. Entity-not-found handling is deliberately
 * NOT part of this contract — each caller implements the OPT-CODE-04 unified
 * policy in its own existence loop (single target → throw; bulk → skip +
 * report via `errors`), because labels and response shapes differ per domain.
 * Code-resolution failures (unresolvable codes) already throw at
 * collectEntityIds (TASK-123) before any caller loop runs.
 *
 * Signature note: the `items` array carries `{ id, title, repo }` instead of
 * separate `ids/titles/repo` args because KG observation cleanup is scoped per
 * item to the entity's OWN repo (TASK-045/043) — a raw-UUID delete can target
 * an entity whose repo differs from the validated repo, and collapsing to one
 * repo would let identical titles cross-delete another repo's graph.
 */

import { SQLiteStore } from "../storage/sqlite";
import { MEMORY_STATUS_ARCHIVED } from "../types";
import { observationText, type KgObservationDomain } from "../tools/kg-archivist/observation-text";
import { logger } from "./logger";
import { chunksOf } from "./chunk";
import { BULK_UPDATE_CHUNK_SIZE } from "./constants";

/**
 * Purge-able domains — deliberately EXCLUDES "codebase": codebase rows are
 * purged by the indexing writer's stale-file sweep (cleanStaleFiles, TASK-293),
 * NOT through this helper. Narrowing via Exclude makes the compiler enforce
 * that intent here, so a future caller can never pass "codebase" into the
 * 3-branch switch below and silently no-op the entity delete (TASK-341).
 */
export type PurgeEntityKind = Exclude<KgObservationDomain, "codebase">;

export interface PurgeEntityItem {
	/** Entity UUID to purge. */
	id: string;
	/**
	 * Entity title — builds the KG observation text. Omit when the row does not
	 * exist (phantom raw UUID) so no KG observation is emitted for it.
	 */
	title?: string;
	/** Repo that owns the entity — scopes the KG observation delete (TASK-045/043). */
	repo?: string;
}

export interface PurgeEntityCleanupOptions {
	/**
	 * Progress callback: fired AFTER the DB transaction commits — once per item
	 * (in order) plus a final call with `progress === total`. Mirrors the
	 * memory-delete contract.
	 */
	onProgress?: (progress: number, total: number) => void;
}

// Exactly 3 members: the compiler rejects a "codebase" key here because
// PurgeEntityKind excludes it (codebase purges go through cleanStaleFiles).
const KIND_PLURALS: Record<PurgeEntityKind, string> = {
	memory: "memories",
	standard: "standards",
	task: "tasks"
};

/**
 * The queue purge shares the 500-chunk invariant with the entity bulk paths
 * (OPT-PERF-11): a single un-chunked `IN (...)` over the whole batch would
 * exceed SQLite's bound-variable limit (~999 default, 32766 with
 * SQLITE_MAX_VARIABLE_NUMBER) and abort the transaction with "too many SQL
 * variables" (TASK-139). The chunking now goes through the shared `chunksOf`
 * helper with BULK_UPDATE_CHUNK_SIZE as the single home of that bound.
 */

/**
 * Runs the full delete contract for a batch of entities of one kind:
 *
 * 1. Entity delete/cancel (kind-specific) + coordination/vector cleanup +
 *    queue_jobs purge — all in ONE transaction. A mid-batch failure rolls back
 *    everything (no partial state), and a stale queue_jobs row could otherwise
 *    re-embed the vector / re-run KG extraction for a deleted entity
 *    (TASK-042 / MEM-427).
 * 2. KG cleanup — best-effort (never throws), atomic, once per batch, each
 *    (text, repo) pair scoped to the entity's OWN repo so identical titles
 *    across repos never cross-delete (TASK-045/043); orphans are checked via
 *    observations UNION relations so relation-referenced entities are KEPT
 *    (REFACTOR-KG-006 / TASK-004).
 *
 * Vector removal is part of the contract: task vectors are dropped explicitly
 * (`derived.task_vectors`); standard vectors are dropped explicitly inside
 * `StandardEntity.delete` (the derived database has no cross-database FK to
 * `coding_standards`); archived memories legitimately keep their vector rows —
 * they stay searchable with `includeArchived`.
 *
 * @returns The number of items purged (=== `items.length`).
 */
export function purgeEntityAndCleanup(
	db: SQLiteStore,
	kind: PurgeEntityKind,
	items: PurgeEntityItem[],
	opts?: PurgeEntityCleanupOptions
): number {
	if (items.length === 0) return 0;

	const onProgress = opts?.onProgress;
	const total = items.length;
	const now = new Date().toISOString();

	db.db
		.transaction(() => {
			switch (kind) {
				case "memory":
					// Soft delete (archive).
					db.memories.bulkUpdateMemories(
						items.map((i) => i.id),
						{ status: MEMORY_STATUS_ARCHIVED }
					);
					break;
				case "standard":
					// Hard delete.
					for (const item of items) {
						db.standards.delete(item.id);
					}
					break;
				case "task":
					// Soft cancel + coordination cleanup: detach children so no
					// stale enqueued worker snapshot re-derives KG relations,
					// drop the task vector, release claims and expire linked
					// handoffs (TASK-065 / MEM-473).
					for (const item of items) {
						db.tasks.updateTask(item.id, { status: "canceled", canceled_at: now });
						db.tasks.clearChildrenParent(item.id);
						db.tasks.removeTaskVector(item.id);
						db.handoffs.releaseClaimsForTask(item.id);
						db.handoffs.updatePendingHandoffsForTask(item.id, "expired");
					}
					break;
			}

			// Purge pending embedding-queue jobs so a stale job can never
			// re-embed the vector / re-run KG extraction for a deleted entity.
			// Chunked at BULK_UPDATE_CHUNK_SIZE via the shared chunksOf helper —
			// a single un-chunked IN(...)
			// over the whole batch would exceed SQLite's bound-variable limit on
			// select-all bulk deletes and abort the transaction (TASK-139).
			for (const chunk of chunksOf(items, BULK_UPDATE_CHUNK_SIZE)) {
				const placeholders = chunk.map(() => "?").join(",");
				db.db
					.prepare(`DELETE FROM queue_jobs WHERE entity_kind = ? AND entity_id IN (${placeholders})`)
					.run(kind, ...chunk.map((item) => item.id));
			}
		})
		.immediate();

	// Progress (when requested): per item, then a final total call.
	if (onProgress) {
		for (let progress = 0; progress < total; progress++) {
			onProgress(progress, total);
		}
		onProgress(total, total);
	}

	// KG cleanup: best-effort, atomic (single transaction), once per batch.
	const observationItems: { text: string; repo: string }[] = [];
	for (const item of items) {
		if (item.title === undefined) continue; // phantom id — nothing to clean in KG
		observationItems.push({ text: observationText(kind, item.title), repo: item.repo ?? "" });
	}

	if (observationItems.length > 0) {
		try {
			db.knowledgeGraph.deleteObservationsAndOrphans(observationItems);
		} catch (kgError) {
			logger.warn(`[KG-Cleanup] Failed to clean up KG entities for deleted ${KIND_PLURALS[kind]}`, {
				error: String(kgError)
			});
		}
	}

	return items.length;
}
