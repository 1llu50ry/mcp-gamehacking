/**
 * memory-read/shared — helpers shared across the search/recap/detail mode
 * handlers.
 *
 * Extracted from memory.read.ts (TASK-555) so the per-mode modules stay under
 * 500 LOC without duplicating the acknowledged marker, the pointer-table
 * columns, or the pointer-row mapping (TASK-423 acknowledged derivation is
 * owned by utils/memory-utils#isMemoryAcknowledged — this file only renders
 * it).
 */

import type { MemoryEntry } from "../../types";
import { isMemoryAcknowledged } from "../../utils/memory-utils";

/** Acknowledged-state marker appended to every rendered result line (TASK-423). */
export function ackMarker(memory: MemoryEntry): string {
	return isMemoryAcknowledged(memory) ? " [acked]" : " [unacked]";
}

/**
 * Pointer-table columns used by BOTH the search and recap structured output
 * (formerly the duplicate SEARCH_COLUMNS / TOP_COLUMNS constants).
 */
export const MEMORY_COLUMNS = ["id", "code", "title", "type", "importance", "acknowledged"] as const;

/** Builds one pointer row for a memory (shared by the search + recap table builders). */
export function memoryPointerRow(memory: MemoryEntry): (string | number | boolean)[] {
	return [
		memory.id,
		memory.code || "-",
		memory.title ?? "Untitled",
		memory.type,
		memory.importance,
		isMemoryAcknowledged(memory)
	];
}
