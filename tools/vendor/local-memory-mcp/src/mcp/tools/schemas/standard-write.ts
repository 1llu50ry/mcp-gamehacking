import { z } from "zod";
import { normalizeRepo } from "../../utils/normalize";
import { SingleStandardSchema } from "./shared";

/**
 * Standard Write schema — unified CREATE / UPDATE / BULK CREATE.
 *
 * Auto-infer logic (handled by the handler, not the schema):
 *   - `standards[]` array     → BULK CREATE
 *   - `content` present       → CREATE single standard
 *   - `id` or `code`          → UPDATE existing standard
 *
 * Mode inference is intentionally NOT a schema-level `.refine` (FIX-026): the
 * old three-mode refine collapsed every malformed payload into one generic
 * message, so callers could not tell which mode their payload was parsed as or
 * which field was missing. The handler now calls
 * {@link diagnoseStandardWriteShape} (standard-write/diagnose.ts) to report the
 * detected mode + exact missing fields — a directive in the task-write style.
 * Only field-level constraints remain here.
 */
export const StandardWriteSchema = z
	.object({
		// ── Common ──
		owner: z.string().min(1),
		repo: z.string().transform(normalizeRepo).optional(),
		json: z.boolean().default(false),

		// ── CREATE fields ──
		name: z.string().min(3).max(255).optional(),
		content: z.string().min(10).optional(),
		parent_id: z.string().optional(),
		context: z.string().optional(),
		version: z.string().optional(),
		language: z.string().optional(),
		stack: z.array(z.string()).optional(),
		is_global: z.boolean().optional(),
		tags: z.array(z.string().min(1)).min(1).optional(),
		metadata: z
			.record(z.string(), z.unknown())
			.refine((value) => Object.keys(value).length > 0, { message: "metadata must contain at least one key" })
			.optional(),
		agent: z.string().optional(),
		model: z.string().optional(),

		// ── UPDATE fields ──
		id: z.string().optional(),
		code: z.string().max(20).optional(),

		// ── BULK ──
		standards: z.array(SingleStandardSchema).min(1).optional()
	})
	.refine(
		(data) => {
			// repo-specific standards need a repo
			if (data.is_global === false && !data.repo && !data.standards) return false;
			return true;
		},
		{ message: "repo is required for repo-specific standards" }
	);
