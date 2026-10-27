import { apiFetch } from "../client";
import type { Task, TaskTimeStats, Pagination } from "../../stores";

/** Task CRUD, time stats, comments + bulk operations. */
export const tasksApi = {
	tasks: (params: { repo: string; status?: string; search?: string; page?: number; pageSize?: number }) => {
		const q = new URLSearchParams({ repo: params.repo });
		if (params.status) q.set("status", params.status);
		if (params.search) q.set("search", params.search);
		if (params.page) q.set("page", String(params.page));
		if (params.pageSize) q.set("pageSize", String(params.pageSize));
		return apiFetch<{ tasks: Task[]; pagination: Pagination }>(`/api/tasks?${q}`);
	},

	taskById: (id: string) => apiFetch<Task>(`/api/tasks/${id}`),

	taskByCode: (repo: string, task_code: string) =>
		apiFetch<Task>(`/api/tasks/by-code?repo=${encodeURIComponent(repo)}&task_code=${encodeURIComponent(task_code)}`),

	taskTimeStats: (repo?: string | null) =>
		apiFetch<TaskTimeStats>(repo ? `/api/tasks/stats/time?repo=${encodeURIComponent(repo)}` : "/api/tasks/stats/time"),

	updateTask: (id: string, updates: Partial<Task>) =>
		apiFetch<Task>(`/api/tasks/${id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(updates)
		}),

	createTask: (body: Partial<Task>) =>
		apiFetch<{ id: string }>("/api/tasks", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		}),

	deleteTask: (id: string) => apiFetch<{ success: boolean }>(`/api/tasks/${id}`, { method: "DELETE" }),

	bulkImportTasks: (repo: string, items: unknown[]) =>
		apiFetch<{ count: number }>("/api/tasks/import", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ repo, items })
		}),

	bulkTaskAction: (action: string, ids: string[], updates?: Partial<Task>) =>
		apiFetch<{ count: number }>("/api/tasks/action", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action, ids, updates })
		}),

	updateTaskComment: (id: string, comment: string) =>
		apiFetch<{ success: boolean }>(`/api/tasks/comments/${id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ comment })
		}),

	deleteTaskComment: (id: string) => apiFetch<{ success: boolean }>(`/api/tasks/comments/${id}`, { method: "DELETE" })
};
