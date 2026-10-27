/**
 * task-read orchestrator — auto-infers detail/search/list mode from field presence:
 *   - id/task_code/ids/task_codes/code/codes (non-empty) → DETAIL (single or bulk)
 *   - query/issue_ref (non-empty) → SEARCH (hybrid vector + keyword)
 *   - none → LIST (filtered by status/phase with pagination)
 *
 * DETAIL is evaluated before SEARCH so a non-empty identifier always wins; all
 * discriminators use "non-empty" presence so a client that serializes unset
 * optional fields as `""` cannot hijack the mode with an empty query.
 */

import { SQLiteStore } from "../../storage/sqlite";
import { VectorStore } from "../../types";
import { McpResponse } from "../../utils/mcp-response";
import { parseArgs } from "../../utils/mcp-error";
import { inferReadMode } from "../../utils/auto-infer";
import { TaskReadSchema } from "../schemas/index";
import { handleDetailMode } from "./detail";
import { handleSearchMode } from "./search";
import { handleListMode } from "./list";

// Re-export sub-modules for direct imports
export { handleDetailMode } from "./detail";
export { handleSearchMode } from "./search";
export { handleListMode } from "./list";

// ── Main handler ──────────────────────────────────────────────────────────

export async function handleTaskRead(args: unknown, storage: SQLiteStore, vectors: VectorStore): Promise<McpResponse> {
	// Centralized validation (OPT-CODE-01): throws on failure — the transport
	// catch converts it to the canonical toErrorResponse envelope. The
	// per-tool safeParse + manual isError special-casing is gone.
	const validated = parseArgs(TaskReadSchema, args);
	const {
		owner,
		repo,
		query,
		code,
		codes,
		id,
		task_code,
		ids,
		task_codes,
		status,
		phase,
		priority,
		issue_ref,
		json: isJsonRequest = false
	} = validated;
	const { offset = 0 } = validated;
	let { limit } = validated;

	// Resolve canonical code/codes — prefer code/codes over task_code/task_codes
	const effectiveCode = code ?? task_code;
	const effectiveCodes = codes ?? task_codes;

	// ── Auto-infer mode from field presence via the shared helper (OPT-DRY-06):
	//    id/code/ids/codes → DETAIL · query/issue_ref → SEARCH · none → LIST.
	//    DETAIL precedes SEARCH so a non-empty identifier beats a query, and
	//    "non-empty" presence ignores `query: ""` from serialize-all clients.
	const mode = inferReadMode(
		{ ...validated, code: effectiveCode, codes: effectiveCodes },
		{
			rules: [
				{ mode: "detail", fields: ["id", "code", "ids", "codes"], presence: "non-empty" },
				// issue_ref also enters SEARCH: listing tasks linked to an issue
				// is a search-style filter even when no free-text query is given.
				{ mode: "search", fields: ["query", "issue_ref"], presence: "non-empty" }
			],
			fallback: "list"
		}
	);

	if (mode === "search") {
		// SEARCH mode: query present — default limit 10
		limit = limit ?? 10;
		return handleSearchMode(
			owner,
			repo,
			query,
			status,
			phase,
			priority,
			issue_ref,
			limit,
			offset,
			isJsonRequest,
			storage,
			vectors
		);
	}

	if (mode === "detail") {
		// DETAIL mode: identifier present
		return handleDetailMode(owner, repo, id, effectiveCode, ids, effectiveCodes, isJsonRequest, storage);
	}

	// LIST mode: no query, no identifier — default filtered listing, default limit 5
	limit = limit ?? 5;
	return handleListMode(owner, repo, status, phase, limit, offset, isJsonRequest, storage);
}
