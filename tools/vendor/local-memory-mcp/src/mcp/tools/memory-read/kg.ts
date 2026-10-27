/**
 * memory-read/kg — KG-enrichment helper shared by the mode handlers.
 *
 * Best-effort KG context (REFACTOR-KG-003) rides the SAME gating rule in
 * search, recap, and detail: the payload only ships inside
 * `structuredContent`, so computing it for a text-mode read is pure waste
 * (audit F3 — measured ~1.0s of a ~1.05s `memory-read` on a 490k-edge repo,
 * 1000x less payload delivered on text calls). Extracted from memory.read.ts
 * (TASK-555) because the fetch-and-gate pattern was duplicated verbatim in
 * every mode handler.
 */

import type { SQLiteStore } from "../../storage/sqlite";
import { fetchAggregatedKgContext, type KgResult } from "../kg-archivist/query";

/**
 * Fetch aggregated KG context for the given memory titles — or null when the
 * read is text-mode (`json` false) or there are no titles to enrich. Mirrors
 * the exact per-mode gate it replaces so wire output is unchanged.
 */
export function fetchGatedMemoryKgContext(
	db: SQLiteStore,
	repo: string,
	memories: { title: string }[],
	json: boolean
): KgResult | null {
	if (!json || memories.length === 0) return null;
	return fetchAggregatedKgContext(
		db,
		repo,
		memories.map((m) => m.title),
		"memory"
	);
}
