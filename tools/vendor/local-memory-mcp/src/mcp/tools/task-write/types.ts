import { TaskStatus } from "../../types";
import { ElicitationRequestHandler } from "../../elicitation";
import { SessionContext } from "../../session";

// ---------------------------------------------------------------------------
// Shared types for task-write operations
// ---------------------------------------------------------------------------

export type TaskWriteOptions = {
	session?: SessionContext;
	elicit?: ElicitationRequestHandler;
};

export type TaskWriteParams = {
	owner: string;
	repo: string;
	json: boolean;
	interactive?: boolean;

	// Identification (for update)
	id?: string;
	ids?: string[];
	code?: string;

	/**
	 * Explicit opt-in owner move (FEAT-007). `owner` above is the scope SELECTOR
	 * for the current (owner, repo, code) row and is never mutated implicitly;
	 * `new_owner` is the ONLY way to re-scope a task. Validated (GitHub username
	 * + non-reserved path segment), collision-checked against the identity key
	 * `idx_tasks_code_owner_repo`, and synced to task_comments in the same
	 * transaction.
	 */
	new_owner?: string;

	// Mutable fields
	phase?: string;
	title?: string;
	description?: string;
	status?: TaskStatus;
	priority?: number;
	agent?: string;
	role?: string;
	model?: string;
	comment?: string;
	doc_path?: string;
	tags?: string[];
	suggested_skills?: string[];
	metadata?: Record<string, unknown>;
	decision_refs?: string[];
	parent_id?: string;
	depends_on?: string;
	est_tokens?: number;
	commit_id?: string;
	changed_files?: string[];
	force?: boolean;

	// Bulk
	tasks?: Record<string, unknown>[];
};

export type ItemInfer = "create" | "update";
