/**
 * codebase-read — unified read-only access to the codebase index.
 *
 * Replaces 5 individual read-only tools with auto-inferred modes.
 * Per ADR-005: "Zero oneOf — auto-infer dari parameter mana yang diisi"
 *
 * Modes (auto-inferred from mutual-exclusive params — all use non-empty
 * presence, so an empty-string param falls through to ARCHITECTURE):
 *   name     → TRACE  (was trace_symbol)
 *   filePath → FILE   (was get_file_symbols)
 *   content  → CODE   (TASK-316 — grep indexed file contents)
 *   query    → SEARCH (unified: was search_symbols + codebase_search)
 *   nothing  → ARCHITECTURE (was get_architecture — tree overview)
 *
 * Each mode's handler lives in `./codebase-read/*` (TASK-430 file-size
 * split); this module owns mode inference + dispatch only.
 */

import { CodebaseReadSchema, type CodebaseReadInput, type CodebaseReadMode } from "./schemas/codebase-read";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { McpResponse } from "../utils/mcp-response";
import { inferReadMode } from "../utils/auto-infer";
import { requireRepoScope } from "./codebase-read/scope";
import { handleTraceMode } from "./codebase-read/trace";
import { handleFileMode } from "./codebase-read/file";
import { handleSearchMode } from "./codebase-read/search";
import { handleArchitectureMode } from "./codebase-read/architecture";
import { handleCodeSearchMode } from "./codebase-read/code";
import { logger } from "../utils/logger";

// ═══════════════════════════════════════════════════════════════════════════
// MODE INFERENCE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determine which mode to run based on the provided parameters.
 *
 * ADR-005 auto-infer rules (first match wins):
 * 1. `name`     → TRACE
 * 2. `filePath` → FILE
 * 3. `content`  → CODE (TASK-316 — grep indexed file contents)
 * 4. `query`    → SEARCH (unified — code-like→5-tier ranking, NL→semantic)
 * 5. (nothing)  → ARCHITECTURE (tree overview)
 */
function inferMode(params: CodebaseReadInput): CodebaseReadMode {
	// Shared auto-infer engine (OPT-DRY-06). `name`/`filePath` keep truthy
	// presence (an empty string is already "not provided"); `query`/`content`
	// use non-empty presence so an empty string is "not provided"
	// (FIX-EMPTY-PARAMS) and falls through to ARCHITECTURE instead of the
	// degenerate SEARCH-all/CODE-no-op modes (TASK-316 intent preserved —
	// architecture never dumps file contents).
	return inferReadMode(params, {
		rules: [
			{ mode: "trace", fields: ["name"], presence: "truthy" },
			{ mode: "file", fields: ["filePath"], presence: "truthy" },
			{ mode: "code", fields: ["content"], presence: "non-empty" },
			{ mode: "search", fields: ["query"], presence: "non-empty" }
		],
		fallback: "architecture"
	});
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Unified codebase-read handler.
 *
 * Auto-infers the mode from the provided parameters per ADR-005 rules:
 * - `name`     → TRACE (exact symbol match with disambiguation)
 * - `filePath` → FILE (symbols in a file)
 * - `content`  → CODE (TASK-316 — grep indexed file contents, symbol-enriched)
 * - `query`    → SEARCH (unified: 5-tier ranking + semantic vector blending)
 * - (nothing)  → ARCHITECTURE (tree overview of the codebase)
 *
 * Every discriminator uses non-empty presence (FIX-EMPTY-PARAMS), so an
 * empty-string `query`/`content`/`name`/`filePath` is "not provided" and routes
 * to ARCHITECTURE.
 *
 * All old tool names route here for backward compatibility (REFACTOR-CI-003).
 */
export async function handleCodebaseRead(
	params: Record<string, unknown>,
	db: SQLiteStore,
	_vectors: VectorStore
): Promise<McpResponse> {
	const validated = CodebaseReadSchema.parse(params);
	const mode = inferMode(validated);

	// Cross-tenant guard: SEARCH requires `repo` or `repos`; other modes
	// require a concrete `repo` (TASK-235 / issue #67).
	const scopeError = requireRepoScope(validated, mode);
	if (scopeError) return scopeError;

	logger.info("[Tool] codebase-read", {
		repo: validated.repo,
		repos: validated.repos,
		mode
	});

	switch (mode) {
		case "trace":
			return handleTraceMode(validated, db);
		case "file":
			return handleFileMode(validated, db);
		case "search":
			return handleSearchMode(validated, db, _vectors);
		case "architecture":
			return handleArchitectureMode(validated, db);
		case "code":
			return handleCodeSearchMode(validated, db);
	}
}
