import { z } from "zod";

export const AGENT_CONTEXT_SOURCES = [
	"memories",
	"decisions",
	"tasks",
	"handoffs",
	"standards",
	"observations",
	"code"
] as const;

export const AgentContextSchema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1),
	query: z
		.string()
		.optional()
		.describe("Backward-compatible search query. objective takes precedence when both are provided."),
	objective: z.string().min(1).optional().describe("Current objective used to rank candidates from every source."),
	task_code: z.string().min(1).optional().describe("Task to pin as critical context when it exists in scope."),
	current_file_path: z.string().min(1).optional().describe("Indexed file used to retrieve compact code pointers."),
	type_filter: z.enum(["code_fact", "decision", "mistake", "pattern", "task_archive"]).optional(),
	limit: z.coerce.number().min(1).max(100).default(5),
	budget: z
		.object({
			tokens: z.coerce.number().int().min(256).max(20_000).default(2_000),
			max_items: z.coerce.number().int().min(1).max(100).default(20),
			code_depth: z.coerce.number().int().min(0).max(5).default(1),
			min_relevance: z.coerce
				.number()
				.min(0)
				.max(1)
				.default(0)
				.describe(
					"Minimum lexical relevance (0..1) a candidate must reach to be packed when an objective is set; lower-scoring candidates are excluded as below_relevance. Default 0 disables filtering."
				)
		})
		.default({ tokens: 2_000, max_items: 20, code_depth: 1, min_relevance: 0 }),
	sources: z
		.array(z.enum(AGENT_CONTEXT_SOURCES))
		.min(1)
		.default([...AGENT_CONTEXT_SOURCES]),
	include_stale: z.boolean().default(false),
	context_pack_id: z
		.string()
		.min(8)
		.max(128)
		.optional()
		.describe("Stable opaque id for cache-hit correlation; never prompt text."),
	session_id: z
		.string()
		.min(1)
		.max(256)
		.optional()
		.describe("Opaque session correlation value; stored only as an in-memory hash."),
	json: z.boolean().default(false)
});

// DecisionLogSchema and SessionSummarizeSchema removed per ADR-007.
// Use memory-write with flat fields instead:
//   - type:"decision" + context/rationale/alternatives
//   - type:"task_archive" + key_decisions/next_steps
