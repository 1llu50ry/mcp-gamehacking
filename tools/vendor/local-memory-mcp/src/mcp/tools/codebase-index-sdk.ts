/**
 * codebase-index — unified write + status for the codebase index.
 *
 * Per ADR-005: "Zero oneOf — auto-infer dari parameter mana yang diisi"
 *
 * Auto-infer rules:
 *   repoPath + repo → INDEX  (trigger tree-sitter scan)
 *   repo saja        → STATUS (check freshness + count)
 */

import { z } from "zod";
import type { McpResponse } from "../utils/mcp-response";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { handleCodebaseIndexRepository, handleCodebaseIndexStatus } from "./codebase-index";
import { getCodebaseParserPool } from "../codebase-index/parser/singleton";
import { logger } from "../utils/logger";
import { CodebaseIndexSchema } from "./schemas/codebase-index";
import { getRuntimeCapabilities } from "../runtime-capabilities";
import { createMcpResponse } from "../utils/mcp-response";

export { CodebaseIndexSchema };
export type CodebaseIndexInput = z.infer<typeof CodebaseIndexSchema>;

type CodebaseIndexMode = "index" | "status";

// ═══════════════════════════════════════════════════════════════════════════
// MODE INFERENCE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determine which mode to run based on the provided parameters.
 *
 * ADR-005 auto-infer rules:
 * 1. `repoPath` + `repo` → INDEX (trigger tree-sitter scan)
 * 2. `repo` saja          → STATUS (check freshness + count)
 */
function inferMode(params: CodebaseIndexInput): CodebaseIndexMode {
	if (params.repoPath) return "index";
	return "status";
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Unified codebase-index handler.
 *
 * Auto-infers the mode from the provided parameters per ADR-005 rules:
 * - `repoPath` + `repo` → INDEX (trigger tree-sitter scan)
 * - `repo` saja          → STATUS (check freshness + count)
 *
 * Old tool name `index_repository` routes here for backward compatibility.
 */
export async function handleCodebaseIndex(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = CodebaseIndexSchema.parse(params);
	const mode = inferMode(validated);
	const capabilities = getRuntimeCapabilities();
	if (!capabilities.hasLoader("indexing")) {
		capabilities.register("indexing", () => getCodebaseParserPool().initialize());
	}
	if (validated.warmup) {
		if (!capabilities.isAvailable("indexing")) {
			return createMcpResponse(
				capabilities.snapshot(),
				"Index capability is unavailable in the minimal runtime profile.",
				{ includeJson: true }
			);
		}
		const status = await capabilities.warmup(["indexing"]);
		return createMcpResponse(status, `Index capability: ${status.capabilities.indexing.state}`, {
			includeJson: true
		});
	}

	logger.info("[Tool] codebase-index", {
		repo: validated.repo,
		mode
	});

	switch (mode) {
		case "index": {
			const ready = await capabilities.ensure("indexing");
			if (!ready) {
				return createMcpResponse(capabilities.snapshot(), "Index capability unavailable in this runtime profile.", {
					includeJson: true
				});
			}
			return handleCodebaseIndexRepository(params, db, vectors);
		}
		case "status":
			return handleCodebaseIndexStatus(params, db, vectors);
	}
}
