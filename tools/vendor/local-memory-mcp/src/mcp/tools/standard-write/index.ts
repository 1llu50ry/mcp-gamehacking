/**
 * standard-write — orchestrator + re-exports.
 *
 * Auto-infer logic (FIX-026: diagnosed by {@link diagnoseStandardWriteShape},
 * which reports the detected mode + exact missing fields on a shape mismatch):
 * - `standards[]` → BULK
 * - `id`/`code` + fields → UPDATE
 * - `name` + `content` + `tags` + `metadata` → CREATE
 */

import { StandardWriteSchema } from "../schemas/index";
import { SQLiteStore } from "../../storage/sqlite";
import { VectorStore } from "../../types";
import { McpResponse } from "../../utils/mcp-response";
import { handleCreateSingle } from "./create";
import { handleUpdateSingle } from "./update";
import { handleBulk } from "./bulk";
import { diagnoseStandardWriteShape } from "./diagnose";
import { StandardWriteParams } from "./shared";

// Re-export types and sub-modules
export type { StandardWriteParams, BulkResult } from "./shared";
export { handleCreateSingle } from "./create";
export { handleUpdateSingle } from "./update";
export { handleBulk } from "./bulk";
export { diagnoseStandardWriteShape } from "./diagnose";
export type { StandardWriteMode, ShapeDiagnosis } from "./diagnose";

// ── Main entry point ─────────────────────────────────────────────────────

export async function handleStandardWrite(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = StandardWriteSchema.parse(params) as unknown as Parameters<typeof handleCreateSingle>[0];

	// Mode inference (FIX-026): the schema no longer rejects shape mismatches
	// with a generic three-mode message — diagnose here so the error names the
	// DETECTED mode and the exact missing fields (task-write directive style).
	const diagnosis = diagnoseStandardWriteShape(validated as unknown as StandardWriteParams);
	if (diagnosis.kind === "invalid") {
		throw new Error(diagnosis.message);
	}

	// Read-modify-write atomicity (TASK-159 / OPT-PERF-09 review): standard-write
	// create/update run a conflict check (DB read), code allocation
	// (generateNextCode) and INSERT in separate transactions. The fast-path
	// withWrite no longer serializes the whole body, so concurrent processes
	// could bypass the STANDARD_CONFLICT gate or collide on codes. Route the
	// whole body through the exclusive lock.
	return db.withExclusiveWrite(async () => {
		// ── Bulk mode ──
		if (diagnosis.mode === "bulk") {
			return handleBulk(validated, db, vectors);
		}

		// ── Update mode: id or code + any fields ──
		if (diagnosis.mode === "update") {
			return handleUpdateSingle(validated, db, vectors);
		}

		// ── Create mode: name + content + tags + metadata (no id/code) ──
		return handleCreateSingle(validated, db, vectors);
	});
}
