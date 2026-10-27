/**
 * memory-read orchestrator + barrel.
 *
 * Replaces 3 existing tools (memory-search, memory-detail, memory-recap)
 * with a single handler that auto-infers mode from parameter presence:
 *
 *   id/code/ids/codes     → DETAIL  (full MemoryEntry, single or bulk)
 *   query                 → SEARCH  (hybrid vector + keyword scoring)
 *   none of the above     → RECAP   (stats + top memories)
 *
 * DETAIL precedes SEARCH so a non-empty identifier beats a query, and every
 * discriminator uses "non-empty" presence so a serialize-all client sending
 * `query: ""` cannot hijack the mode.
 *
 * SPEC-001 hybrid scoring: 0.40 similarity + 0.30 keyword + 0.15 recency + 0.15 domain
 * No hit_count increments on read.
 *
 * Split from the old single-file src/mcp/tools/memory.read.ts (TASK-555) —
 * this file is now the dispatcher; the per-mode handlers live in sibling
 * modules (search.ts / detail.ts / recap.ts) with shared helpers (shared.ts,
 * kg.ts), each under 500 LOC. The dotted legacy file remains as a thin
 * re-exporter so existing `./memory.read` importers keep working.
 */

import type { SQLiteStore } from "../../storage/sqlite";
import type { VectorStore } from "../../types";
import type { McpResponse } from "../../utils/mcp-response";
import { parseArgs } from "../../utils/mcp-error";
import { inferReadMode } from "../../utils/auto-infer";
import { MemoryReadSchema } from "../schemas/index";
import { handleDetailMode } from "./detail";
import { handleSearchMode } from "./search";
import { handleRecapMode } from "./recap";

// Re-export sub-modules for direct imports
export { handleDetailMode, formatMemoryDetail, formatBulkDetail } from "./detail";
export { handleSearchMode } from "./search";
export { handleRecapMode } from "./recap";

// ── Main handler ──────────────────────────────────────────────────────────

export async function handleMemoryRead(params: unknown, db: SQLiteStore, vectors: VectorStore): Promise<McpResponse> {
	// Centralized validation (OPT-CODE-01): throws the friendly owner/repo-aware
	// message instead of a raw ZodError; transport catch → toErrorResponse.
	const validated = parseArgs(MemoryReadSchema, params);

	// Auto-infer mode from field presence via the shared helper (OPT-DRY-06):
	//   id/code/ids/codes → DETAIL · query → SEARCH · none → RECAP.
	//   DETAIL precedes SEARCH so a non-empty identifier beats a query, and
	//   "non-empty" presence ignores `query: ""` from serialize-all clients.
	const mode = inferReadMode(validated, {
		rules: [
			{ mode: "detail", fields: ["id", "code", "ids", "codes"], presence: "non-empty" },
			{ mode: "search", fields: ["query"], presence: "non-empty" }
		],
		fallback: "recap"
	});

	switch (mode) {
		case "search":
			return handleSearchMode(validated, db, vectors);
		case "detail":
			return handleDetailMode(validated, db);
		default:
			return handleRecapMode(validated, db);
	}
}
