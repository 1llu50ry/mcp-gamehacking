import { z } from "zod";
import { normalizeRepo } from "../../utils/normalize";
import { HandoffStatusSchema } from "./shared";

export const HandoffCreateSchema = z
	.object({
		owner: z.string().min(1, "owner is required — provide it explicitly or configure MCP workspace roots"),
		repo: z
			.string()
			.min(1, "repo is required — provide it explicitly or configure MCP workspace roots")
			.transform(normalizeRepo),
		from_agent: z.string().min(1),
		to_agent: z.string().min(1).optional(),
		task_id: z.string().optional(),
		task_code: z.string().optional(),
		summary: z.string().min(1),
		context: z.record(z.string(), z.unknown()).optional(),
		expires_at: z.string().optional(),
		json: z.boolean().default(false)
	})
	.refine((data) => !(data.task_id && data.task_code), {
		message: "Provide either task_id or task_code, not both"
	})
	.refine(
		(data) =>
			data.to_agent ||
			data.task_id ||
			data.task_code ||
			data.context?.next_steps ||
			data.context?.blockers ||
			data.context?.remaining_work,
		{
			message:
				"Handoffs must identify a target agent, linked task, next_steps, blockers, or remaining_work. Do not create pending handoffs for completed-work summaries."
		}
	);

export const HandoffUpdateSchema = z.object({
	id: z.string().uuid(),
	status: HandoffStatusSchema,
	json: z.boolean().default(false)
});

export const HandoffListSchema = z.object({
	owner: z.string().min(1, "owner is required — provide it explicitly or configure MCP workspace roots"),
	repo: z
		.string()
		.min(1, "repo is required — provide it explicitly or configure MCP workspace roots")
		.transform(normalizeRepo),
	status: HandoffStatusSchema.optional(),
	from_agent: z.string().min(1).optional(),
	to_agent: z.string().min(1).optional(),
	limit: z.coerce.number().min(1).max(100).default(20),
	offset: z.coerce.number().min(0).default(0),
	json: z.boolean().default(false)
});

export const TaskClaimSchema = z
	.object({
		owner: z.string().min(1, "owner is required — provide it explicitly or configure MCP workspace roots"),
		repo: z
			.string()
			.min(1, "repo is required — provide it explicitly or configure MCP workspace roots")
			.transform(normalizeRepo),
		task_id: z.string().optional(),
		task_code: z.string().optional(),
		agent: z.string().min(1),
		role: z.string().optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
		json: z.boolean().default(false)
	})
	.refine((data) => data.task_id !== undefined || data.task_code !== undefined, {
		message: "Either task_id or task_code must be provided"
	})
	.refine((data) => !(data.task_id && data.task_code), {
		message: "Provide either task_id or task_code, not both"
	});

export const ClaimListSchema = z.object({
	owner: z.string().optional().default(""),
	repo: z.string().transform(normalizeRepo).optional().default(""),
	agent: z.string().min(1).optional(),
	active_only: z.boolean().default(true),
	limit: z.coerce.number().min(1).max(100).default(20),
	offset: z.coerce.number().min(0).default(0),
	json: z.boolean().default(false)
});

export const ClaimReleaseSchema = z
	.object({
		owner: z.string().min(1, "owner is required — provide it explicitly or configure MCP workspace roots"),
		repo: z
			.string()
			.min(1, "repo is required — provide it explicitly or configure MCP workspace roots")
			.transform(normalizeRepo),
		task_id: z.string().optional(),
		task_code: z.string().optional(),
		agent: z.string().min(1).optional(),
		json: z.boolean().default(false)
	})
	.refine((data) => data.task_id !== undefined || data.task_code !== undefined, {
		message: "Either task_id or task_code must be provided"
	})
	.refine((data) => !(data.task_id && data.task_code), {
		message: "Provide either task_id or task_code, not both"
	});

export const ClaimManageSchema = z.object({
	owner: z.string().min(1, "owner is required — provide it explicitly or configure MCP workspace roots"),
	repo: z
		.string()
		.min(1, "repo is required — provide it explicitly or configure MCP workspace roots")
		.transform(normalizeRepo),

	// Task identification (for CLAIM and RELEASE)
	task_id: z.string().optional(),
	task_code: z.string().optional(),

	// CLAIM-specific
	agent: z.string().optional(),
	role: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),

	// RELEASE flag — set true to release instead of claim
	release: z.boolean().default(false),

	// LIST fields
	query: z.string().optional(),
	active_only: z.boolean().default(true),
	limit: z.coerce.number().min(1).max(100).default(20),
	offset: z.coerce.number().min(0).default(0),

	json: z.boolean().default(false)
});

export const HandoffWriteSchema = z.object({
	// CREATE fields
	owner: z.string().min(1, "owner is required — provide it explicitly or configure MCP workspace roots").optional(),
	repo: z
		.string()
		.min(1, "repo is required — provide it explicitly or configure MCP workspace roots")
		.transform(normalizeRepo)
		.optional(),
	from_agent: z.string().min(1).optional(),
	to_agent: z.string().min(1).optional(),
	task_id: z.string().optional(),
	task_code: z.string().optional(),
	summary: z.string().min(1).optional(),
	context: z.record(z.string(), z.unknown()).optional(),
	expires_at: z.string().optional(),

	// UPDATE fields
	id: z.string().optional(),
	status: HandoffStatusSchema.optional(),

	// Metadata
	json: z.boolean().default(false)
});

export const HandoffReadSchema = z.object({
	// Detail mode — look up single handoff by id
	id: z.string().optional(),

	// Claim listing mode — set true to force listing claims
	claim: z.boolean().default(false).optional(),

	// Handoff search mode — present triggers handoff listing with optional filters
	query: z.string().optional(),

	// Pagination (shared across modes)
	limit: z.coerce.number().min(1).max(100).default(20),
	offset: z.coerce.number().min(0).default(0),

	// Handoff filters (for SEARCH / LIST HANDOFFS modes)
	status: HandoffStatusSchema.optional(),
	from_agent: z.string().optional(),
	to_agent: z.string().optional(),

	// Claim filters (for LIST CLAIMS mode)
	agent: z.string().optional(),
	active_only: z.boolean().default(true),

	// Scope (auto-inferred from session context for non-detail modes)
	owner: z.string().optional().default(""),
	repo: z.string().transform(normalizeRepo).optional().default(""),

	// Metadata
	json: z.boolean().default(false)
});
