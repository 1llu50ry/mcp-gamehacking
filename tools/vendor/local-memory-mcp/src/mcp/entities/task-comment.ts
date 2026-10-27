import { BaseEntity } from "../storage/base";
import { TaskComment } from "../types";

export class TaskCommentEntity extends BaseEntity {
	insertTaskComment(comment: TaskComment): void {
		this.run(
			`INSERT INTO task_comments (
				id, task_id, repo, owner, comment, agent, role, model, previous_status, next_status, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				comment.id,
				comment.task_id,
				comment.repo,
				comment.owner,
				comment.comment,
				comment.agent || "unknown",
				comment.role || "unknown",
				comment.model || "unknown",
				comment.previous_status || null,
				comment.next_status || null,
				comment.created_at
			]
		);
	}

	updateTaskComment(id: string, updates: Partial<TaskComment>): void {
		const fields: string[] = [];
		const values: unknown[] = [];
		const anyUpdates = updates as Record<string, unknown>;
		const VALID_COLUMNS = new Set([
			"owner",
			"repo",
			"comment",
			"agent",
			"role",
			"model",
			"previous_status",
			"next_status"
		]);

		Object.keys(updates).forEach((key) => {
			if (VALID_COLUMNS.has(key) && anyUpdates[key] !== undefined) {
				fields.push(`${key} = ?`);
				values.push(anyUpdates[key]);
			}
		});

		if (fields.length === 0) return;

		values.push(id);

		this.run(`UPDATE task_comments SET ${fields.join(", ")} WHERE id = ?`, values as (string | number | null)[]);
	}

	deleteTaskComment(id: string): void {
		this.run("DELETE FROM task_comments WHERE id = ?", [id]);
	}

	getTaskCommentById(id: string): TaskComment | null {
		return this.get<TaskComment>("SELECT * FROM task_comments WHERE id = ?", [id]) ?? null;
	}

	getTaskCommentsByTaskId(taskId: string): TaskComment[] {
		return this.all<TaskComment>(`SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at DESC, id DESC`, [
			taskId
		]);
	}

	/**
	 * Batched comment fetch by task ids (TASK-422) — lets the task-read search
	 * engine detect issue refs (`#NNN`) in comments for a whole result pool
	 * with ONE query instead of N+1. Chunked to stay under SQLite's default
	 * variable limit (999).
	 */
	getTaskCommentsByTaskIds(taskIds: string[]): TaskComment[] {
		if (taskIds.length === 0) return [];
		const CHUNK = 500;
		const out: TaskComment[] = [];
		for (let i = 0; i < taskIds.length; i += CHUNK) {
			const chunk = taskIds.slice(i, i + CHUNK);
			const placeholders = chunk.map(() => "?").join(",");
			out.push(
				...this.all<TaskComment>(
					`SELECT * FROM task_comments WHERE task_id IN (${placeholders}) ORDER BY created_at DESC, id DESC`,
					chunk
				)
			);
		}
		return out;
	}

	getAllTaskCommentsByRepo(owner: string, repo: string, limit?: number, offset?: number): TaskComment[] {
		let sql = `SELECT * FROM task_comments WHERE owner = ? AND repo = ? ORDER BY created_at DESC, id DESC`;
		const params: (string | number)[] = [owner, repo];
		if (limit !== undefined) {
			sql += " LIMIT ?";
			params.push(limit);
			if (offset !== undefined) {
				sql += " OFFSET ?";
				params.push(offset);
			}
		}
		return this.all<TaskComment>(sql, params);
	}

	/**
	 * Re-scopes every comment of a task to a new owner (FEAT-007 explicit owner
	 * move). Called INSIDE the caller's task-mutation transaction so the task
	 * row and its comment rows can never diverge (a partial move would strand
	 * comments under the old scope). Returns the number of comment rows updated.
	 */
	updateTaskCommentsOwnerByTaskId(taskId: string, owner: string): number {
		return this.run("UPDATE task_comments SET owner = ? WHERE task_id = ?", [owner, taskId]).changes;
	}
}
