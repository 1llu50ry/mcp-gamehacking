// Single source of truth for task enumerations. The zod schemas
// (tools/schemas/shared.ts) derive their enums from these consts.
export const TASK_STATUS_BACKLOG = "backlog" as const;
export const TASK_STATUS_PENDING = "pending" as const;
export const TASK_STATUS_IN_PROGRESS = "in_progress" as const;
export const TASK_STATUS_COMPLETED = "completed" as const;
export const TASK_STATUS_CANCELED = "canceled" as const;
export const TASK_STATUS_BLOCKED = "blocked" as const;
export const TASK_STATUSES = [
	TASK_STATUS_BACKLOG,
	TASK_STATUS_PENDING,
	TASK_STATUS_IN_PROGRESS,
	TASK_STATUS_COMPLETED,
	TASK_STATUS_CANCELED,
	TASK_STATUS_BLOCKED
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = [1, 2, 3, 4, 5] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface TaskChild {
	task_code: string;
	title: string;
	status: TaskStatus;
}

export interface TaskStats {
	total: number;
	backlog: number;
	todo: number;
	inProgress: number;
	completed: number;
	blocked: number;
	canceled: number;
}

export interface TaskCoordination {
	active_claim_count: number;
	active_claim_agent: string | null;
	active_claim_role: string | null;
	active_claim_claimed_at: string | null;
	pending_handoff_count: number;
	pending_handoff_id: string | null;
	pending_handoff_summary: string | null;
	pending_handoff_to_agent: string | null;
	pending_handoff_created_at: string | null;
}

export interface Task {
	id: string;
	owner: string;
	repo: string;
	task_code: string;
	phase: string;
	title: string;
	description: string | null;
	status: TaskStatus;
	priority: TaskPriority;
	agent: string;
	role: string;
	doc_path: string | null;
	created_at: string;
	updated_at: string;
	in_progress_at: string | null;
	finished_at: string | null;
	canceled_at: string | null;
	est_tokens: number;
	commit_id: string | null;
	changed_files: string[];
	tags: string[];
	suggested_skills: string[];
	metadata: Record<string, unknown>;
	parent_id: string | null;
	depends_on: string | null;
	parent_code?: string | null;
	depends_on_code?: string | null;
	coordination?: TaskCoordination;
	comments?: TaskComment[];
	comments_count?: number;
	children?: TaskChild[];
	depended_by?: TaskChild[];
}

export interface TaskComment {
	id: string;
	task_id: string;
	owner: string;
	repo: string;
	comment: string;
	agent: string;
	role: string;
	model: string;
	previous_status: TaskStatus | null;
	next_status: TaskStatus | null;
	created_at: string;
}

export interface TaskRow {
	id: string;
	owner: string;
	repo: string;
	task_code: string;
	phase: string;
	title: string;
	description: string | null;
	status: TaskStatus;
	priority: TaskPriority;
	agent: string;
	role: string;
	doc_path: string | null;
	created_at: string;
	updated_at: string;
	in_progress_at: string | null;
	finished_at: string | null;
	canceled_at: string | null;
	est_tokens: number;
	commit_id: string | null;
	changed_files: string;
	tags: string;
	suggested_skills: string;
	metadata: string;
	parent_id: string | null;
	depends_on: string | null;
	parent_code?: string | null;
	depends_on_code?: string | null;
	comments_count: number;
	// Coordination columns — present only when the SELECT joins claims/handoffs
	// (buildCoordinationSelect); undefined on bare tasks.* reads.
	active_claim_count?: number;
	active_claim_agent?: string | null;
	active_claim_role?: string | null;
	active_claim_claimed_at?: string | null;
	pending_handoff_count?: number;
	pending_handoff_id?: string | null;
	pending_handoff_summary?: string | null;
	pending_handoff_to_agent?: string | null;
	pending_handoff_created_at?: string | null;
}
