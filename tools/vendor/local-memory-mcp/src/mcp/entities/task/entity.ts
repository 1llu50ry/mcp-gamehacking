import { BaseEntity } from "../../storage/base";
import { Task, TaskRow, TaskChild, TaskComment, VectorWriteMeta } from "../../types";
import { handleDuplicateTaskCode } from "./validation";
import {
	buildCoordinationSelect,
	taskExcludeCanceledFilter,
	taskRepoFilter,
	taskSearchFilter,
	taskSelectSkeleton,
	taskStatusFilter,
	taskStatusesFilter,
	taskStatusOrderBy
} from "./queries";
import { VECTOR_CANDIDATE_CAP, TABLE_TASKS } from "../../utils/constants";
import { encodeVector } from "../../utils/vector";
import { buildUpdateClause } from "../../utils/sql-builder";
import { buildTaskInsert, TASK_UPDATE_COLUMNS, TASK_JSON_KEYS } from "./serializers";

export class TaskEntity extends BaseEntity {
	insertTask(task: Task): void {
		try {
			const { sql, params } = buildTaskInsert(task);
			this.run(sql, params);
		} catch (err: unknown) {
			handleDuplicateTaskCode(err, task.task_code, task.repo);
		}
	}

	updateTask(id: string, updates: Partial<Task> & { comment?: string; model?: string }): void {
		const { fields, values } = buildUpdateClause(updates as Record<string, unknown>, {
			jsonKeys: TASK_JSON_KEYS,
			validColumns: TASK_UPDATE_COLUMNS
		});

		if (fields.length === 0) return;

		fields.push("updated_at = ?");
		values.push(new Date().toISOString());
		values.push(id);

		this.run(`UPDATE ${TABLE_TASKS} SET ${fields.join(", ")} WHERE id = ?`, values as (string | number | null)[]);
	}

	deleteTask(id: string): void {
		this.run("DELETE FROM task_comments WHERE task_id = ?", [id]);
		this.run(`DELETE FROM ${TABLE_TASKS} WHERE id = ?`, [id]);
	}

	getTaskById(id: string): Task | null {
		const row = this.get<TaskRow>(`${taskSelectSkeleton("t", false)} WHERE t.id = ?`, [id]);
		return row
			? {
					...this.rowToTask(row),
					comments: this.all<TaskComment>(
						"SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at DESC, id DESC",
						[id]
					)
				}
			: null;
	}

	/**
	 * Bulk fetch by ids. Loads full comment bodies for every task — the worker
	 * existence check (embedding-queue/worker.ts loadExistingEntityIds) only
	 * needs ids + status and discards them. A lean variant that skips the
	 * comments join is possible if the API-surface cost ever justifies it.
	 */
	getTasksByIds(ids: string[]): Task[] {
		if (ids.length === 0) return [];
		const placeholders = ids.map(() => "?").join(",");
		const rows = this.all<TaskRow>(
			`SELECT t.*, d.task_code as depends_on_code,
				${buildCoordinationSelect("t")},
				(SELECT COUNT(*) FROM task_comments WHERE task_id = t.id) as comments_count
			FROM ${TABLE_TASKS} t
			LEFT JOIN ${TABLE_TASKS} d ON t.depends_on = d.id
			WHERE t.id IN (${placeholders})`,
			ids
		);

		const comments = this.all<TaskComment>(
			`SELECT * FROM task_comments WHERE task_id IN (${placeholders}) ORDER BY created_at DESC, id DESC`,
			ids
		);

		const commentsMap = new Map<string, TaskComment[]>();
		for (const c of comments) {
			if (!commentsMap.has(c.task_id)) {
				commentsMap.set(c.task_id, []);
			}
			commentsMap.get(c.task_id)!.push(c);
		}

		return rows.map((r) => {
			const task = this.rowToTask(r);
			task.comments = commentsMap.get(task.id) || [];
			return task;
		});
	}

	getTaskByCode(owner: string, repo: string, taskCode: string): Task | null {
		const baseQuery = taskSelectSkeleton("t", false);

		// Single query — owner filter only when provided. Owner-less rows are
		// normalized at write time (TASK-038), so no owner-fallback re-query.
		const ownerClause = owner ? "t.owner = ? AND " : "";
		const params: (string | null)[] = owner ? [owner, repo, taskCode] : [repo, taskCode];
		const row = this.get<TaskRow>(baseQuery + `WHERE ${ownerClause}t.repo = ? AND t.task_code = ?`, params);

		return row
			? {
					...this.rowToTask(row),
					comments: this.all<TaskComment>(
						"SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at DESC, id DESC",
						[row.id]
					)
				}
			: null;
	}

	getTasksByRepo(
		owner: string,
		repo: string,
		status?: string,
		limit?: number,
		offset?: number,
		search?: string,
		excludeCanceled: boolean = false
	): Task[] {
		const repoFilter = taskRepoFilter("t", owner, repo);
		const params: (string | number)[] = repoFilter.params;
		let query = `${taskSelectSkeleton("t")} WHERE ${repoFilter.clause}`;

		const statusClause = taskStatusFilter("t", status);
		if (statusClause) {
			query += statusClause;
			params.push(status as string);
		}

		const excludeCanceledClause = taskExcludeCanceledFilter("t", excludeCanceled, status);
		if (excludeCanceledClause) {
			query += excludeCanceledClause;
		}

		const searchClause = taskSearchFilter("t", search);
		if (searchClause) {
			query += searchClause;
			const searchPattern = `%${search}%`;
			params.push(searchPattern, searchPattern, searchPattern);
		}

		query += ` ORDER BY ${taskStatusOrderBy()}`;

		if (limit !== undefined) {
			query += " LIMIT ?";
			params.push(limit);
			if (offset !== undefined) {
				query += " OFFSET ?";
				params.push(offset);
			}
		}

		const rows = this.all<TaskRow>(query, params);

		// NOTE: no owner-fallback re-query — owner-less rows are normalized at
		// write time (TASK-038); the owner-filtered query is authoritative.
		return rows.map((r) => this.rowToTask(r));
	}

	countTasks(owner: string, repo: string, status?: string, search?: string, excludeCanceled: boolean = false): number {
		const { clause: repoClause, params } = taskRepoFilter(undefined, owner, repo);
		let query = `SELECT COUNT(*) as count FROM ${TABLE_TASKS} WHERE ${repoClause}`;

		const statusClause = taskStatusFilter(undefined, status);
		if (statusClause) {
			query += statusClause;
			params.push(status as string);
		}

		const excludeCanceledClause = taskExcludeCanceledFilter(undefined, excludeCanceled, status);
		if (excludeCanceledClause) {
			query += excludeCanceledClause;
		}

		const searchClause = taskSearchFilter(undefined, search);
		if (searchClause) {
			query += searchClause;
			const searchPattern = `%${search}%`;
			params.push(searchPattern, searchPattern, searchPattern);
		}

		const row = this.get<{ count: number }>(query, params);
		return row?.count ?? 0;
	}

	listRecentTasks(limit = 50, offset = 0): Task[] {
		const query = `${taskSelectSkeleton("t")} ORDER BY ${taskStatusOrderBy()}
		LIMIT ? OFFSET ?
		`;
		const rows = this.all<TaskRow>(query, [limit, offset]);
		return rows.map((r) => this.rowToTask(r));
	}

	getTasksByMultipleStatuses(
		owner: string,
		repo: string,
		statuses: string[],
		limit?: number,
		offset?: number,
		search?: string
	): Task[] {
		if (!statuses.length) return this.getTasksByRepo(owner, repo, undefined, limit, offset, search);

		const repoFilter = taskRepoFilter("t", owner, repo);
		const params: (string | number)[] = repoFilter.params;
		let query = `${taskSelectSkeleton("t")} WHERE ${repoFilter.clause}`;

		const statusesClause = taskStatusesFilter("t", statuses);
		if (statusesClause) {
			query += statusesClause;
			params.push(...statuses);
		}

		const searchClause = taskSearchFilter("t", search);
		if (searchClause) {
			query += searchClause;
			const searchPattern = `%${search}%`;
			params.push(searchPattern, searchPattern, searchPattern);
		}

		query += ` ORDER BY ${taskStatusOrderBy()}`;

		if (limit !== undefined) {
			query += " LIMIT ?";
			params.push(limit);
			if (offset !== undefined) {
				query += " OFFSET ?";
				params.push(offset);
			}
		}

		const rows = this.all<TaskRow>(query, params);

		// NOTE: no owner-fallback re-query — owner-less rows are normalized at
		// write time (TASK-038); the owner-filtered query is authoritative.
		return rows.map((r) => this.rowToTask(r));
	}

	countTasksByMultipleStatuses(owner: string, repo: string, statuses: string[], search?: string): number {
		if (!statuses.length) return this.countTasks(owner, repo, undefined, search);

		const repoFilter = taskRepoFilter(undefined, owner, repo);
		const params: (string | number)[] = repoFilter.params;
		let query = `SELECT COUNT(*) as count FROM ${TABLE_TASKS} WHERE ${repoFilter.clause}`;

		const statusesClause = taskStatusesFilter(undefined, statuses);
		if (statusesClause) {
			query += statusesClause;
			params.push(...statuses);
		}

		const searchClause = taskSearchFilter(undefined, search);
		if (searchClause) {
			query += searchClause;
			const searchPattern = `%${search}%`;
			params.push(searchPattern, searchPattern, searchPattern);
		}

		const row = this.get<{ count: number }>(query, params);
		return row?.count ?? 0;
	}

	isTaskCodeDuplicate(owner: string, repo: string, task_code: string, excludeId?: string): boolean {
		let query = `SELECT COUNT(*) as count FROM ${TABLE_TASKS} WHERE repo = ? AND task_code = ?`;
		const params: (string | number)[] = [repo, task_code];

		if (owner) {
			query = `SELECT COUNT(*) as count FROM ${TABLE_TASKS} WHERE owner = ? AND repo = ? AND task_code = ?`;
			params.unshift(owner);
		}

		if (excludeId) {
			query += " AND id != ?";
			params.push(excludeId);
		}

		const row = this.get<{ count: number }>(query, params);
		return (row?.count ?? 0) > 0;
	}

	getChildrenByParentId(id: string): TaskChild[] {
		return this.all<TaskChild>(
			`SELECT task_code, title, status FROM ${TABLE_TASKS} WHERE parent_id = ? ORDER BY created_at ASC`,
			[id]
		);
	}

	getDependedByTaskId(id: string): TaskChild[] {
		return this.all<TaskChild>(
			`SELECT task_code, title, status FROM ${TABLE_TASKS} WHERE depends_on = ? ORDER BY created_at ASC`,
			[id]
		);
	}

	/**
	 * Bulk-load children (tasks whose parent_id is in `ids`) in a single query,
	 * grouped by parent task id. Replaces N getChildrenByParentId calls (TASK-022).
	 */
	getChildrenByParentIds(ids: string[]): Map<string, TaskChild[]> {
		if (ids.length === 0) return new Map();
		const placeholders = ids.map(() => "?").join(",");
		const rows = this.all<TaskChild & { parent_id: string }>(
			`SELECT task_code, title, status, parent_id FROM ${TABLE_TASKS} WHERE parent_id IN (${placeholders}) ORDER BY created_at ASC`,
			ids
		);
		const grouped = new Map<string, TaskChild[]>();
		for (const row of rows) {
			if (!grouped.has(row.parent_id)) grouped.set(row.parent_id, []);
			grouped.get(row.parent_id)!.push({ task_code: row.task_code, title: row.title, status: row.status });
		}
		return grouped;
	}

	/**
	 * Bulk-load dependents (tasks whose depends_on is in `ids`) in a single query,
	 * grouped by dependency task id. Replaces N getDependedByTaskId calls (TASK-022).
	 */
	getDependedByTaskIds(ids: string[]): Map<string, TaskChild[]> {
		if (ids.length === 0) return new Map();
		const placeholders = ids.map(() => "?").join(",");
		const rows = this.all<TaskChild & { depends_on: string }>(
			`SELECT task_code, title, status, depends_on FROM ${TABLE_TASKS} WHERE depends_on IN (${placeholders}) ORDER BY created_at ASC`,
			ids
		);
		const grouped = new Map<string, TaskChild[]>();
		for (const row of rows) {
			if (!grouped.has(row.depends_on)) grouped.set(row.depends_on, []);
			grouped.get(row.depends_on)!.push({ task_code: row.task_code, title: row.title, status: row.status });
		}
		return grouped;
	}

	/**
	 * Detach every child of the given task (`parent_id → NULL`).
	 *
	 * Called when a parent task is soft-deleted (canceled): the parent's KG
	 * entities are orphan-swept, so keeping children linked would let any
	 * future writer re-derive `depends_on` relations from a document whose
	 * entity rows no longer exist (TASK-065 / MEM-473). The embedding
	 * worker's `loadExistingEntityIds` guard (worker.ts) already skips canceled
	 * tasks via the batched IN(...) existence check; detaching children here
	 * makes the skip unconditional even for stale enqueued snapshots.
	 * Returns the number of children detached.
	 */
	clearChildrenParent(parentId: string): number {
		return this.run(`UPDATE ${TABLE_TASKS} SET parent_id = NULL, updated_at = ? WHERE parent_id = ?`, [
			new Date().toISOString(),
			parentId
		]).changes;
	}

	/**
	 * Bulk-load tasks by task_code with the same row shape as getTaskByCode
	 * (parent_code join + batched comments), in a single tasks query plus one
	 * batched comments query. Results preserve the input code order.
	 *
	 * Deliberately NO owner-fallback re-query: owner-less rows are normalized at
	 * write time (TASK-038), so the owner-filtered query is authoritative.
	 */
	getTasksByCodes(owner: string, repo: string, taskCodes: string[]): Task[] {
		if (taskCodes.length === 0) return [];
		const placeholders = taskCodes.map(() => "?").join(",");
		const repoFilter = taskRepoFilter("t", owner, repo);

		const rows = this.all<TaskRow>(
			`${taskSelectSkeleton("t")} WHERE ${repoFilter.clause} AND t.task_code IN (${placeholders})`,
			[...repoFilter.params, ...taskCodes]
		);

		const tasks = rows.map((r) => this.rowToTask(r));
		if (tasks.length === 0) return [];
		const taskIds = tasks.map((t) => t.id);

		const comments = this.all<TaskComment>(
			`SELECT * FROM task_comments WHERE task_id IN (${taskIds.map(() => "?").join(",")}) ORDER BY created_at DESC, id DESC`,
			taskIds
		);
		const commentsMap = new Map<string, TaskComment[]>();
		for (const c of comments) {
			if (!commentsMap.has(c.task_id)) commentsMap.set(c.task_id, []);
			commentsMap.get(c.task_id)!.push(c);
		}
		for (const task of tasks) {
			task.comments = commentsMap.get(task.id) || [];
		}

		// Preserve input code order, first match per code (mirrors per-code getTaskByCode)
		const byCode = new Map<string, Task>();
		for (const task of tasks) {
			if (!byCode.has(task.task_code)) byCode.set(task.task_code, task);
		}
		const seen = new Set<string>();
		const result: Task[] = [];
		for (const code of taskCodes) {
			const task = byCode.get(code);
			if (task && !seen.has(code)) {
				seen.add(code);
				result.push(task);
			}
		}
		return result;
	}

	upsertTaskVectorEmbedding(taskId: string, vector: unknown, meta?: VectorWriteMeta): void {
		// Dense embeddings are stored as a float32 BLOB, sparse TF maps as JSON
		// TEXT — see encodeVector (TASK-038).
		//
		// PERF-003: task_vectors had NEITHER provenance column; both are added
		// here. COALESCE keeps an existing value on a NULL write (see
		// memory.vector.ts).
		this.run(
			`INSERT INTO derived.task_vectors (task_id, vector, updated_at, content_hash, model_version)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(task_id) DO UPDATE SET vector = excluded.vector, updated_at = excluded.updated_at,
				content_hash = COALESCE(excluded.content_hash, content_hash),
				model_version = COALESCE(excluded.model_version, model_version)`,
			[taskId, encodeVector(vector), new Date().toISOString(), meta?.contentHash ?? null, meta?.modelVersion ?? null]
		);
	}

	getTaskVectorCandidates(
		repo?: string,
		limit = VECTOR_CANDIDATE_CAP
	): { task_id: string; vector: string | Uint8Array }[] {
		let sql = `SELECT tv.task_id, tv.vector
			FROM derived.task_vectors tv
			JOIN ${TABLE_TASKS} t ON t.id = tv.task_id`;
		const params: (string | number)[] = [];

		if (repo) {
			sql += " WHERE t.repo = ?";
			params.push(repo);
		}

		sql += " ORDER BY tv.updated_at DESC LIMIT ?";
		params.push(limit);
		return this.all<{ task_id: string; vector: string | Uint8Array }>(sql, params);
	}

	removeTaskVector(taskId: string): void {
		this.run("DELETE FROM derived.task_vectors WHERE task_id = ?", [taskId]);
	}

	getExistingTaskCodes(owner: string, repo: string, codes: string[]): Set<string> {
		if (codes.length === 0) return new Set();
		const placeholders = codes.map(() => "?").join(",");
		const params: (string | number)[] = [repo, ...codes];
		const ownerClause = owner ? "owner = ? AND " : "";
		if (owner) {
			params.unshift(owner);
		}
		const rows = this.all<{ task_code: string }>(
			`SELECT task_code FROM ${TABLE_TASKS} WHERE ${ownerClause}repo = ? AND task_code IN (${placeholders})`,
			params
		);
		return new Set(rows.map((r) => r.task_code));
	}

	/**
	 * Bulk inserts tasks into the database within a single transaction.
	 * Pre-deduplicates against existing task_codes before the transaction.
	 * Rows whose task_code already exists in the DB are silently skipped (skip-and-continue).
	 * The per-row INSERT has no try/catch since all rows are pre-validated.
	 *
	 * @param tasks - Array of tasks to insert
	 * @returns Number of tasks actually inserted (excluding skipped duplicates)
	 */
	bulkInsertTasks(tasks: Task[]): number {
		if (tasks.length === 0) return 0;

		const owner = tasks[0].owner || "";
		const repo = tasks[0].repo;

		// Pre-deduplicate against existing task codes before the transaction
		const codes = tasks.map((t) => t.task_code);
		const existingCodes = this.getExistingTaskCodes(owner, repo, codes);

		return this.transaction(() => {
			let count = 0;
			for (const task of tasks) {
				// Skip rows whose task_code already exists in the database
				if (existingCodes.has(task.task_code)) {
					continue;
				}
				const { sql, params } = buildTaskInsert(task);
				this.run(sql, params);
				count++;
			}
			return count;
		});
	}
}
