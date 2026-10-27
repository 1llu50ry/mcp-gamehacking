import { z } from "zod";
import { normalizeRepo } from "../../utils/normalize";

/**
 * Unified schema for standard-read (SEARCH / DETAIL / LIST).
 *
 * Auto-infer:
 * - `query` present → SEARCH
 * - `id`/`code`/`ids`/`codes` → DETAIL
 * - none             → LIST
 */
export const StandardReadSchema = z.object({
	// ── SEARCH ──────────────────────────────────────────────────────────
	query: z
		.string()
		.optional()
		.describe(
			"Free-text search. Supports inline key:value tags (e.g. language:php stack:laravel tag:a,b) which are auto-extracted into filters."
		),

	// ── DETAIL ──────────────────────────────────────────────────────────
	id: z.string().optional(),
	code: z.string().max(20).optional(),
	ids: z.array(z.string()).min(1).optional(),
	codes: z.array(z.string().max(20)).min(1).optional(),

	// ── Filters (SEARCH + LIST) ─────────────────────────────────────────
	owner: z.string().optional().default(""),
	repo: z.string().transform(normalizeRepo).optional(),
	stack: z.array(z.string()).optional(),
	tags: z.array(z.string()).optional(),
	language: z.string().optional(),
	context: z.string().optional(),
	version: z.string().optional(),
	is_global: z.boolean().optional(),

	// ── Pagination ──────────────────────────────────────────────────────
	limit: z.coerce.number().min(1).max(100).default(20),
	offset: z.coerce.number().min(0).default(0),

	// ── Output ──────────────────────────────────────────────────────────
	json: z.boolean().default(false)
});

export type StandardReadInput = z.infer<typeof StandardReadSchema>;
