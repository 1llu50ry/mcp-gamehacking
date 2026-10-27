import { randomUUID } from "crypto";
import { db, mcpClient } from "../lib/context";
import { ServiceError } from "../lib/jsonApi";
import { purgeEntityAndCleanup } from "../../mcp/utils/purge-entity-cleanup";
import type { Task } from "../../mcp/types";

/**
 * Resolves the owner for dashboard task writes.
 *
 * Precedence: explicit `owner` attribute → `DASHBOARD_OWNER` env (acts as the
 * dashboard's session owner) → "" (caller must reject empty).
 */
function resolveWriteOwner(owner: unknown): string {
	const explicit = typeof owner === "string" ? owner.trim() : "";
	return explicit || process.env.DASHBOARD_OWNER || "";
}

/**
 * Build the MCP tool-update args for a task mutation.
 * Shared by single-update and bulk-update/status paths (NIT dedup).
 */
function buildToolArgs(
	existingTask: Task,
	attributes: Record<string, unknown>,
	idOverride?: string
): Record<string, unknown> {
	const toolArgs: Record<string, unknown> = {
		repo: existingTask.repo,
		owner: existingTask.owner || undefined,
		id: idOverride ?? existingTask.id,
		agent: "dashboard",
		role: "user",
		model: "web-ui",
		structured: true
	};

	for (const [key, value] of Object.entries(attributes)) {
		// The existing task row's owner is authoritative — updates can never
		// reassign owner, and forwarding it (vs. omitting it) stops the MCP
		// server from re-inferring an owner from the dashboard CWD
		// (FIX-OWNER-INFER).
		if (key === "owner") continue;
		if (value !== undefined) {
			toolArgs[key] = value;
		}
	}

	if (attributes.status && attributes.status !== existingTask.status && !toolArgs.comment) {
		toolArgs.comment = `Status updated via dashboard to ${attributes.status}`;
	}

	if (attributes.status === "completed") {
		if (toolArgs.est_tokens === undefined) {
			toolArgs.est_tokens = existingTask.est_tokens || 0;
		}
		if (toolArgs.commit_id === undefined) {
			if (existingTask.commit_id) {
				toolArgs.commit_id = existingTask.commit_id;
			}
		}
		if (toolArgs.changed_files === undefined) {
			toolArgs.changed_files = existingTask.changed_files || [];
		}
	}

	return toolArgs;
}

export interface TaskListParams {
	repo: string;
	status?: string;
	search?: string;
	limit: number;
	offset: number;
}

export interface TaskListResult {
	tasks: Task[];
	totalItems: number;
}

/**
 * Service layer for task business logic.
 *
 * Owns CRUD orchestration, owner resolution, MCP delegation for updates,
 * and action logging. Controllers delegate here instead of touching `db` directly.
 */
export const TaskService = {
	list(params: TaskListParams): TaskListResult {
		const { repo, status, search, limit, offset } = params;

		let tasks;
		let totalItems;

		if (status && status.includes(",")) {
			const statuses = status.split(",");
			tasks = db.tasks.getTasksByMultipleStatuses("", repo, statuses, limit, offset, search);
			totalItems = db.tasks.countTasksByMultipleStatuses("", repo, statuses, search);
		} else {
			// Soft-delete status scoping (TASK-209): with no explicit ?status
			// filter, canceled (soft-deleted) tasks are hidden — mirrors the
			// memories list hiding archived by default. An explicit
			// `?status=canceled` still returns them.
			tasks = db.tasks.getTasksByRepo("", repo, status, limit, offset, search, !status);
			totalItems = db.tasks.countTasks("", repo, status, search, !status);
		}

		return { tasks, totalItems };
	},

	/** Side-effect-free existence check (no action log). */
	exists(id: string): boolean {
		return db.tasks.getTaskById(id) !== null;
	},

	/**
	 * GET endpoint: returns task. Read-only — no action_log write
	 * (POLICY 2 / TASK-186: reads never write; mutations below still log).
	 */
	getById(id: string): Task | null {
		return db.tasks.getTaskById(id);
	},

	getByCode(repo: string, task_code: string): Task | null {
		return db.tasks.getTaskByCode("", repo, task_code) || null;
	},

	async create(attributes: {
		repo: string;
		task_code: string;
		title: string;
		owner?: string;
		[key: string]: unknown;
	}): Promise<string> {
		const { repo, task_code } = attributes;
		const owner = resolveWriteOwner(attributes.owner);
		if (!owner) throw new ServiceError(400, "owner is required (or set DASHBOARD_OWNER)");
		if (db.tasks.isTaskCodeDuplicate(owner, repo, task_code)) {
			throw new ServiceError(400, "Duplicate task_code");
		}
		const id = randomUUID();
		await db.withWrite(() => {
			db.tasks.insertTask({
				...attributes,
				owner,
				id,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString()
			} as Task);
			db.actions.logAction("write", owner, repo, { taskId: id });
		});
		return id;
	},

	async update(id: string, attributes: Record<string, unknown>): Promise<Task> {
		const existingTask = db.tasks.getTaskById(id);
		if (!existingTask) throw new ServiceError(404, "Task not found");

		if (!mcpClient.isConnected()) await mcpClient.start();

		const toolArgs = buildToolArgs(existingTask, attributes);

		await mcpClient.callTool("task-update", toolArgs);
		await db.refresh();

		const updatedTask = db.tasks.getTaskById(id);
		if (!updatedTask) {
			throw new ServiceError(500, "Task updated but could not be reloaded");
		}

		return updatedTask;
	},

	async delete(id: string): Promise<void> {
		const task = db.tasks.getTaskById(id);
		if (!task) throw new ServiceError(404, "Task not found");
		// Route through the shared purge + cleanup contract (OPT-DRY-03): soft
		// cancel + child detach + vector removal + claim release + handoff
		// expiry + queue_jobs purge + repo-scoped KG cleanup — identical to the
		// MCP task-delete tool and the dashboard bulk path. This closes the
		// single-vs-bulk divergence (single used to hard-delete while
		// bulk/tool soft-cancel; TASK-207).
		await db.withWrite(() => {
			purgeEntityAndCleanup(db, "task", [{ id, title: task.title, repo: task.repo }]);
			db.actions.logAction("delete", task.owner || "", task.repo, { taskId: id });
		});
	},

	async bulkCreate(items: Array<Record<string, unknown>>, repo: string): Promise<number> {
		const tasks = items.map((item) => ({
			...item,
			id: (item.id as string) || randomUUID(),
			owner: resolveWriteOwner(item.owner),
			repo,
			task_code: (item.task_code as string) || randomUUID().substring(0, 8),
			created_at: (item.created_at as string) || new Date().toISOString(),
			updated_at: (item.updated_at as string) || new Date().toISOString()
		}));

		if (tasks.some((t) => !t.owner)) {
			throw new ServiceError(400, "owner is required on every item (or set DASHBOARD_OWNER)");
		}

		return db.withWrite(() => {
			const n = db.tasks.bulkInsertTasks(tasks as Task[]);
			db.actions.logAction("write", tasks[0]?.owner ?? "", repo, {
				query: `Bulk imported ${n} tasks`
			});
			return n;
		});
	},

	async bulkAction(action: string, ids: string[], updates?: Record<string, unknown>): Promise<number> {
		let count = 0;

		if (action === "delete") {
			count = await db.withExclusiveWrite(async () => {
				// Route through the shared purge + cleanup contract (OPT-DRY-03):
				// soft-cancel + claim release + handoff expiry + vector removal +
				// queue_jobs purge + child detach + KG cleanup — identical to
				// canonical task-delete (no more hard-delete divergence).
				const existing = db.tasks.getTasksByIds(ids);
				const byId = new Map(existing.map((t) => [t.id, t]));
				await purgeEntityAndCleanup(
					db,
					"task",
					ids.map((id) => {
						const task = byId.get(id);
						return task ? { id, title: task.title, repo: task.repo } : { id };
					})
				);
				if (ids.length > 0) {
					const task = db.tasks.getTaskById(ids[0]);
					db.actions.logAction(action, task?.owner || "", task?.repo || "unknown", {
						query: `Bulk ${action} applied to ${existing.length} tasks`
					});
				}
				return existing.length;
			});
		} else if (action === "update" || action === "status") {
			if (!updates || Object.keys(updates).length === 0) {
				throw new ServiceError(400, "'updates' required for update/status action");
			}

			if (!mcpClient.isConnected()) await mcpClient.start();

			const errors: string[] = [];
			for (const id of ids) {
				const existingTask = db.tasks.getTaskById(id);
				if (!existingTask) {
					errors.push(`Task ${id} not found`);
					continue;
				}

				const toolArgs = buildToolArgs(existingTask, updates, id);

				try {
					await mcpClient.callTool("task-update", toolArgs);
					count++;
				} catch (e) {
					errors.push(`Task ${id}: ${e instanceof Error ? e.message : String(e)}`);
				}
			}

			await db.refresh();

			if (ids.length > 0) {
				const task = db.tasks.getTaskById(ids[0]);
				db.actions.logAction(action, task?.owner || "", task?.repo || "unknown", {
					query: `Bulk ${action} applied to ${count} tasks${errors.length > 0 ? ` (${errors.length} errors)` : ""}`
				});
			}

			if (errors.length > 0 && count === 0) {
				throw new ServiceError(422, `All tasks failed: ${errors.join("; ")}`);
			}
		} else {
			throw new ServiceError(400, "Invalid action: must be 'delete', 'update', or 'status'");
		}

		return count;
	},

	getTimeStats(repo: string | null): Record<string, unknown> {
		const targetRepo = typeof repo === "string" && repo.length > 0 ? repo : null;

		return {
			daily: {
				...db.taskStats.getTaskTimeStats("", targetRepo, "daily"),
				history: db.taskStats.getTaskComparisonSeries("", targetRepo, "daily")
			},
			weekly: {
				...db.taskStats.getTaskTimeStats("", targetRepo, "weekly"),
				history: db.taskStats.getTaskComparisonSeries("", targetRepo, "weekly")
			},
			monthly: {
				...db.taskStats.getTaskTimeStats("", targetRepo, "monthly"),
				history: db.taskStats.getTaskComparisonSeries("", targetRepo, "monthly")
			},
			overall: {
				...db.taskStats.getTaskTimeStats("", targetRepo, "overall"),
				history: db.taskStats.getTaskComparisonSeries("", targetRepo, "overall")
			}
		};
	},

	async updateComment(id: string, comment: string): Promise<void> {
		const existingComment = db.taskComments.getTaskCommentById(id);
		if (!existingComment) throw new ServiceError(404, "Comment not found");
		await db.withWrite(() => db.taskComments.updateTaskComment(id, { comment }));
	},

	async deleteComment(id: string): Promise<void> {
		// Mirror updateComment: an unknown id is a 404, not a silent no-op —
		// delete-by-id must be symmetric with update-by-id (REFACTOR-TST-008).
		const existingComment = db.taskComments.getTaskCommentById(id);
		if (!existingComment) throw new ServiceError(404, "Comment not found");
		await db.withWrite(() => db.taskComments.deleteTaskComment(id));
	}
};
