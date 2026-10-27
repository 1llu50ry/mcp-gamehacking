import { z } from "zod";
import { normalizeRepo } from "../../utils/normalize";
import { MEMORY_TYPES, MEMORY_STATUSES, TASK_STATUSES, TASK_PRIORITIES, HANDOFF_STATUSES } from "../../types";

export const MemoryScopeSchema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1).transform(normalizeRepo),
	branch: z.string().optional(),
	folder: z.string().optional(),
	language: z.string().optional()
});

// Enums are derived from the single-source consts in ../../types (TASK-118) —
// never inline the value lists here.
export const MemoryTypeSchema = z.enum(MEMORY_TYPES);

export const MemoryStatusSchema = z.enum(MEMORY_STATUSES);

export const TaskStatusSchema = z.enum(TASK_STATUSES);

export const TaskPrioritySchema = z.coerce
	.number()
	.min(Math.min(...TASK_PRIORITIES))
	.max(Math.max(...TASK_PRIORITIES));

export const HandoffStatusSchema = z.enum(HANDOFF_STATUSES);

export const SingleStandardSchema = z.object({
	name: z.string().min(3).max(255),
	content: z.string().min(10),
	parent_id: z.string().optional(),
	context: z.string().optional(),
	version: z.string().optional(),
	language: z.string().optional(),
	stack: z.array(z.string()).optional(),
	is_global: z.boolean().optional(),
	tags: z.array(z.string().min(1)).min(1),
	metadata: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, {
		message: "metadata must contain at least one key"
	}),
	agent: z.string().optional(),
	model: z.string().optional()
});

export const TaskStatusValues: readonly string[] = TASK_STATUSES;
