import { Task } from "../../types";
import { TASK_STATUS_BACKLOG } from "../../types";
import { TABLE_TASKS } from "../../utils/constants";

// Writable task columns / JSON-serialized keys for the shared update-clause
// builder (TASK-109). comment/model are accepted on the API surface but are
// intentionally not writable columns.
export const TASK_UPDATE_COLUMNS = new Set([
	"owner",
	"repo",
	"task_code",
	"phase",
	"title",
	"description",
	"status",
	"priority",
	"agent",
	"role",
	"doc_path",
	"finished_at",
	"canceled_at",
	"tags",
	"suggested_skills",
	"metadata",
	"parent_id",
	"depends_on",
	"est_tokens",
	"in_progress_at",
	"commit_id",
	"changed_files"
]);
export const TASK_JSON_KEYS = new Set(["tags", "metadata", "changed_files", "suggested_skills"]);

/**
 * Single source of truth for the tasks INSERT statement (TASK-108) —
 * shared by insertTask() and bulkInsertTasks() so a column change is
 * made in exactly one place.
 */
export function buildTaskInsert(task: Task): { sql: string; params: unknown[] } {
	return {
		sql: `INSERT INTO ${TABLE_TASKS} (
			id, repo, owner, task_code, phase, title, description, status, priority,
			agent, role, doc_path, created_at, updated_at, finished_at, canceled_at, tags, suggested_skills, metadata, parent_id, depends_on, est_tokens, in_progress_at,
			commit_id, changed_files
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		params: [
			task.id,
			task.repo,
			task.owner || "",
			task.task_code,
			task.phase || null,
			task.title,
			task.description || null,
			task.status || TASK_STATUS_BACKLOG,
			task.priority || 3,
			task.agent || "unknown",
			task.role || "unknown",
			task.doc_path || null,
			task.created_at,
			task.updated_at,
			task.finished_at || null,
			task.canceled_at || null,
			task.tags ? JSON.stringify(task.tags) : null,
			task.suggested_skills ? JSON.stringify(task.suggested_skills) : null,
			task.metadata ? JSON.stringify(task.metadata) : null,
			task.parent_id || null,
			task.depends_on || null,
			task.est_tokens || 0,
			task.in_progress_at || null,
			task.commit_id || null,
			task.changed_files ? JSON.stringify(task.changed_files) : null
		]
	};
}
