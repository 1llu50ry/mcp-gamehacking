// Single source of truth for memory enumerations. The zod schemas
// (tools/schemas/shared.ts) derive their enums from these consts.
export const MEMORY_TYPES = ["code_fact", "decision", "mistake", "pattern", "task_archive"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_STATUS_ACTIVE = "active" as const;
export const MEMORY_STATUS_ARCHIVED = "archived" as const;
export const MEMORY_STATUSES = [MEMORY_STATUS_ACTIVE, MEMORY_STATUS_ARCHIVED] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export type MemoryScope = {
	owner: string;
	repo: string;
	branch?: string;
	folder?: string;
	language?: string;
};

export type MemoryEntry = {
	id: string;
	code?: string;
	type: MemoryType;
	title: string;
	content: string;
	importance: number;
	agent: string;
	role: string;
	model: string;
	scope: MemoryScope;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
	hit_count: number;
	recall_count: number;
	last_used_at: string | null;
	expires_at: string | null;
	supersedes: string | null;
	status: MemoryStatus;
	tags: string[];
	metadata: Record<string, unknown>;
	structuredData?: Record<string, unknown>;
	is_global: boolean;
};

export type MemoryRow = {
	id: string;
	code?: string;
	type: MemoryType;
	title: string;
	content: string;
	importance: number;
	agent: string;
	role: string;
	model: string;
	owner: string;
	repo: string;
	branch?: string;
	folder?: string;
	language?: string;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
	hit_count: number;
	recall_count: number;
	last_used_at: string | null;
	expires_at: string | null;
	supersedes: string | null;
	status: MemoryStatus;
	is_global: number;
	tags: string;
	metadata: string;
};

export type CodingStandardEntry = {
	id: string;
	code?: string;
	title: string;
	content: string;
	parent_id: string | null;
	context: string;
	version: string;
	language: string | null;
	stack: string[];
	is_global: boolean;
	owner: string;
	repo: string | null;
	tags: string[];
	metadata: Record<string, unknown>;
	created_at: string;
	updated_at: string;
	hit_count: number;
	last_used_at: string | null;
	agent: string;
	model: string;
};

export type CodingStandardRow = {
	id: string;
	code?: string;
	title: string;
	content: string;
	parent_id: string | null;
	context: string;
	version: string;
	language: string | null;
	stack: string | null;
	is_global: number;
	owner: string;
	repo: string | null;
	tags: string | null;
	metadata: string | null;
	created_at: string;
	updated_at: string;
	hit_count: number;
	last_used_at: string | null;
	agent: string;
	model: string;
};
