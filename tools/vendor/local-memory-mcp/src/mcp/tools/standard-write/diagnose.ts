/**
 * standard-write/diagnose — mode detection + directive shape errors (FIX-026).
 *
 * The unified schema is intentionally permissive (every operational field is
 * optional) so the handler owns mode inference — bulk (`standards[]`) → update
 * (`id`/`code`) → single-create (`name` + `content` + `tags` + `metadata`).
 *
 * The previous failure mode: a payload that matched none of the three modes was
 * rejected by a schema-level `.refine` with a single generic three-mode message,
 * so the caller could not tell WHICH mode their payload was parsed as nor which
 * field was missing. This module replaces that with a directive that names the
 * DETECTED mode (when one is inferable) and the exact missing fields for it.
 *
 * Message style mirrors the task-write directive errors (TASK-061 / FIX-108):
 *   "Detected single-create but 'metadata' is missing; required: name, content,
 *    tags, metadata"
 */

import { StandardWriteParams } from "./shared";

// ── Types ─────────────────────────────────────────────────────────────────

export type StandardWriteMode = "bulk" | "update" | "create";

export type ShapeDiagnosis = { kind: "ok"; mode: StandardWriteMode } | { kind: "invalid"; message: string };

// ── Constants ─────────────────────────────────────────────────────────────

/** Fields a single CREATE must carry (canonical order, mirrors the schema). */
const CREATE_REQUIRED = ["name", "content", "tags", "metadata"] as const;

/**
 * Any of these appearing (without `standards[]`/`id`/`code`) signals the caller
 * intended a single CREATE — used to name the detected mode even when several
 * required fields are absent.
 */
const CREATE_HINT_FIELDS = [
	"name",
	"content",
	"tags",
	"metadata",
	"parent_id",
	"context",
	"version",
	"language",
	"stack",
	"is_global"
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────

function quoteList(fields: readonly string[]): string {
	return fields.map((field) => `'${field}'`).join(", ");
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Infer the operational mode from a parsed standard-write payload, or explain
 * why no mode matched.
 *
 * Precedence mirrors the handler dispatch: bulk → update → create. A payload
 * that only partially matches single-create reports the detected mode plus the
 * exact missing fields; a payload with no mode signal reports the generic
 * three-mode directive.
 */
export function diagnoseStandardWriteShape(params: StandardWriteParams): ShapeDiagnosis {
	// ── Bulk: `standards[]` present (schema guarantees non-empty) ──
	if (params.standards !== undefined) {
		if (params.standards.length === 0) {
			return {
				kind: "invalid",
				message: "Detected bulk-create but 'standards[]' is empty; required: at least one item in standards[]."
			};
		}
		return { kind: "ok", mode: "bulk" };
	}

	// ── Update: `id` or `code` present ──
	if (params.id || params.code) {
		return { kind: "ok", mode: "update" };
	}

	// ── Single create: any create signal present ──
	const looksLikeCreate = CREATE_HINT_FIELDS.some((field) => params[field] !== undefined);
	if (looksLikeCreate) {
		const missing = CREATE_REQUIRED.filter((field) => params[field] === undefined);
		if (missing.length === 0) {
			return { kind: "ok", mode: "create" };
		}
		const verb = missing.length === 1 ? "is" : "are";
		return {
			kind: "invalid",
			message:
				`Detected single-create but ${quoteList(missing)} ${verb} missing; ` +
				`required: ${CREATE_REQUIRED.join(", ")}.`
		};
	}

	// ── No mode signal at all ──
	return {
		kind: "invalid",
		message:
			"Could not infer operation. Provide:\n" +
			"  - `standards[]` for BULK CREATE\n" +
			"  - `name` + `content` + `tags` + `metadata` for single CREATE\n" +
			"  - `id`/`code` + fields for UPDATE"
	};
}
