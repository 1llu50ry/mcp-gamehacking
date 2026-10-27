import { z } from "zod";
import { normalizeRepo } from "../../utils/normalize";
import { MemoryScopeSchema, MemoryTypeSchema, MemoryStatusSchema } from "./shared";

export const MemoryDeleteSchema = z
	.object({
		owner: z.string().min(1).describe("GitHub org or username. Auto-inferred."),
		repo: z.string().min(1).transform(normalizeRepo).describe("Repo name. Auto-inferred."),
		id: z
			.string()
			.optional()
			.describe("Single memory UUID or code to delete (auto-inferred: UUID→direct, string→code lookup)."),
		ids: z.array(z.string()).min(1).optional().describe("Array of memory UUIDs or codes to delete (bulk)."),
		code: z.string().max(20).optional().describe("Single memory code to delete."),
		codes: z.array(z.string().max(20)).min(1).optional().describe("Array of memory codes to delete (bulk)."),
		json: z.boolean().default(false).describe("Returns JSON if true.")
	})
	.refine(
		(data) => data.id !== undefined || data.ids !== undefined || data.code !== undefined || data.codes !== undefined,
		{
			message: "Either 'id', 'ids', 'code', or 'codes' must be provided for deletion"
		}
	)
	.describe("Soft-delete memories. Single or bulk. Auto-infers: UUID→direct ID, non-UUID→code lookup.");

export const MemorySummarizeSchema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1).transform(normalizeRepo),
	signals: z.array(z.string().max(200)).min(1),
	json: z.boolean().default(false)
});

export const MemoryReadSchema = z
	.object({
		query: z
			.string()
			.optional()
			.describe(
				"Search keyword for memory titles. Supports inline key:value tags (e.g. tag:a,b lang:php branch:main) which are auto-extracted into filters."
			),
		id: z.string().optional().describe("Memory UUID (detail mode)"),
		code: z.string().max(20).optional().describe("Short memory code (detail mode)"),
		ids: z.array(z.string()).optional().describe("Array of memory UUIDs (bulk detail)"),
		codes: z.array(z.string().max(20)).optional().describe("Array of memory codes (bulk detail)"),
		owner: z.string().min(1),
		repo: z.string().min(1).transform(normalizeRepo),
		current_tags: z.array(z.string()).optional().describe("Tech stack tags for filtering"),
		current_file_path: z.string().optional().describe("File path for workspace grounding"),
		scope: MemoryScopeSchema.partial().optional(),
		include_archived: z.boolean().default(false).describe("Include archived memories"),
		limit: z.coerce.number().min(1).max(100).default(5).describe("Max results (1-100)"),
		offset: z.coerce.number().min(0).default(0).describe("Pagination offset"),
		json: z.boolean().default(false).describe("Returns JSON if true.")
	})
	.describe("Auto-infers mode: search (query present), detail (id/code/ids/codes present), or recap (none)");

// ── Memory Write Schema (replaces memory-store, memory-update, memory-acknowledge) ──
// Single flat schema — no oneOf. The handler uses auto-infer logic to determine
// the operation (CREATE, UPDATE, ACKNOWLEDGE, or BULK) from the field combination.

const MemoryWriteFields = {
	// Create fields
	type: MemoryTypeSchema.optional(),
	title: z.string().min(3).max(255).optional(),
	content: z.string().min(10).optional(),
	// `.default(3)` guarantees every CREATE carries a value (FIX-020): the
	// memories.importance column is NOT NULL CHECK (1..5), and an omitted value
	// previously bound `undefined` and failed the INSERT. UPDATE/ACKNOWLEDGE do
	// NOT run this schema through `.parse()` (handlers read the raw normalized
	// args), so the default never forces a spurious importance write on those
	// paths — only CREATE (single) and bulk CREATE parse through it.
	importance: z.coerce.number().min(1).max(5).default(3),
	code: z.string().max(20).optional(),
	ttlDays: z.coerce.number().min(1).optional(),
	supersedes: z.string().optional(),
	tags: z.array(z.string()).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	is_global: z.boolean().optional(),
	scope: MemoryScopeSchema.optional(),

	// Update fields
	id: z.string().optional(),
	agent: z.string().optional(),
	role: z.string().optional(),
	model: z.string().optional(),
	status: MemoryStatusSchema.optional(),
	completed_at: z.string().optional(),

	// Acknowledge discriminator (separate from entity status)
	acknowledge: z.enum(["used", "irrelevant", "contradictory"]).optional(),
	application_context: z.string().optional(),

	// Decision fields — flat alternative to old decision-log tool
	context: z
		.string()
		.min(10, { message: "Decision context must be at least 10 characters" })
		.optional()
		.describe('Context for type="decision". When present with type="decision", auto-formats content.'),
	rationale: z
		.string()
		.min(10, { message: "Rationale must be at least 10 characters" })
		.optional()
		.describe('Rationale for type="decision". When present with type="decision", auto-formats content.'),
	alternatives: z
		.array(z.string())
		.optional()
		.describe('Alternatives considered for type="decision". Displayed as a list in auto-formatted content.'),

	// Session fields — flat alternative to old session-summarize tool
	key_decisions: z
		.array(z.string())
		.optional()
		.describe('Key decisions for type="task_archive". Displayed as a list in auto-formatted content.'),
	next_steps: z
		.array(z.string())
		.optional()
		.describe('Next steps for type="task_archive". Displayed as a list in auto-formatted content.'),

	// Standard
	owner: z.string().optional(),
	repo: z.string().optional(),
	json: z.boolean().default(false)
} as const;

/** Schema for a single item in the memories[] bulk array. */
export const MemoryWriteItemSchema = z.object({ ...MemoryWriteFields });

/** Schema for memory-write: single CREATE/UPDATE/ACKNOWLEDGE or BULK via memories[]. */
export const MemoryWriteSchema = z.object({
	...MemoryWriteFields,

	// Bulk: if present, switches to bulk mode
	memories: z.array(MemoryWriteItemSchema).optional()
});

export const MemorySynthesizeSchema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1).transform(normalizeRepo).optional(),
	objective: z.string().min(5),
	current_file_path: z.string().optional(),
	include_summary: z.boolean().default(true),
	include_tasks: z.boolean().default(true),
	use_tools: z.boolean().default(true),
	max_iterations: z.coerce.number().int().min(1).max(5).default(3),
	max_tokens: z.coerce.number().int().min(128).max(4000).default(1200),
	json: z.boolean().default(false)
});

// ── Derived input types (OPT-CODE-03) ─────────────────────────────────────
// z.infer keeps handler input interfaces in lockstep with the schemas — no
// more `Schema.parse(params) as X` re-casts that silently drift from the
// validated shape (e.g. memory.read.ts used to re-cast to a hand-written
// MemoryReadParams with a different owner nullability).
export type MemoryReadInput = z.infer<typeof MemoryReadSchema>;
export type MemoryWriteInput = z.infer<typeof MemoryWriteSchema>;
export type MemoryWriteItemInput = z.infer<typeof MemoryWriteItemSchema>;
