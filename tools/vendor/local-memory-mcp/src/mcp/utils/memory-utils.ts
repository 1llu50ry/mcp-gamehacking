import { SQLiteStore } from "../storage/sqlite";
import type { MemoryEntry } from "../types";
import { resolveEntityRef } from "./entity-ref";

/**
 * Checks if a title appears to contain metadata (agent/role/model/date/source metadata patterns).
 * Returns true if the title starts with a bracket-enclosed metadata pattern.
 */
export function hasMetadataLikeTitle(title: string): boolean {
	const normalized = title.trim();
	return /^\[[^\]]{0,200}(agent:|role:|model:|\d{4}-\d{2}-\d{2}|source_)[^\]]*\]/i.test(normalized);
}

/**
 * Resolves a supersedes value to a memory UUID.
 *
 * - If the value is null/undefined → returns null
 * - If the value is already a UUID → returns it as-is
 * - If the value is a code → looks up the memory by code and returns its id
 *
 * @throws If the code does not resolve to an existing memory
 */
export function resolveMemorySupersedes(
	value: string | null | undefined,
	db: SQLiteStore,
	owner?: string,
	repo?: string
): string | null {
	return resolveEntityRef(db, "memory", value, owner, repo);
}

/**
 * Whether a memory has been explicitly acknowledged as used.
 *
 * The only persisted "acknowledged" signal is `recall_count` — it is
 * incremented EXCLUSIVELY by the `acknowledge: "used"` write path
 * (memory-write update/bulk → incrementRecallCount), so `recall_count > 0`
 * means the memory was recalled/used at least once. An acknowledge of
 * "irrelevant" or "contradictory" is logged but NOT persisted as a counter,
 * so it does not flip this flag (documented limitation of the data model).
 *
 * This is the single source of the acknowledged derivation so the search
 * ranking boost (TASK-423), the per-item markers, and the detail view cannot
 * drift apart.
 */
export function isMemoryAcknowledged(memory: Pick<MemoryEntry, "recall_count">): boolean {
	return memory.recall_count > 0;
}
