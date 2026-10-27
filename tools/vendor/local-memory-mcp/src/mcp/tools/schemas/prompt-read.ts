import { z } from "zod";

/**
 * Unified schema for prompt-read (LIST / DETAIL).
 *
 * Auto-infer:
 * - `name` present → DETAIL  (load + substitute a single prompt)
 * - none           → LIST    (catalog of all prompts)
 *
 * `args` only applies in DETAIL mode — key/value pairs substituted into
 * `{{var}}` placeholders. `current_repo` / `current_owner` are always
 * auto-injected from the session after user args, never read from `args`.
 */
export const PromptReadSchema = z.object({
	// ── MODE ──────────────────────────────────────────────────────────────
	/** Prompt name (e.g. "session-planner"). Presence triggers DETAIL mode. */
	name: z
		.string()
		.trim()
		.min(1)
		.max(120)
		.optional()
		.describe('Prompt name to load (e.g. "session-planner"). Omit to list the full prompt catalog (mode: list).'),

	// ── SUBSTITUTION (DETAIL mode only) ──────────────────────────────────
	/** Values substituted into {{arg}} placeholders. Keys are matched literally (user-escaped). */
	args: z
		.record(z.string().trim().min(1).max(200), z.string().max(20000))
		.refine((value) => Object.keys(value).length <= 50, {
			message: "args must contain at most 50 substitution keys"
		})
		.optional(),

	// ── OUTPUT ────────────────────────────────────────────────────────────
	/** Include machine-readable structuredContent alongside the always-present text. */
	json: z.boolean().default(false)
});

export type PromptReadInput = z.infer<typeof PromptReadSchema>;
