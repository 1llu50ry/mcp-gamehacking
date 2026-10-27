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
	owner?: string;
	repo: string;
	task_code: string;
	phase: string;
	title: string;
	description: string | null;
	status: string;
	priority: number;
	agent?: string;
	role?: string;
	created_at: string;
	updated_at: string;
	finished_at?: string | null;
	in_progress_at?: string | null;
	est_tokens?: number;
	tags?: string[];
	metadata?: Record<string, unknown>;
	parent_id?: string | null;
	depends_on?: string | null;
	parent_code?: string | null;
	depends_on_code?: string | null;
	coordination?: TaskCoordination;
	comments?: TaskComment[];
	comment?: string;
}

export interface TaskComment {
	id: string;
	task_id: string;
	repo: string;
	comment: string;
	agent?: string;
	role?: string;
	model?: string;
	previous_status?: string;
	next_status?: string;
	created_at: string;
}
