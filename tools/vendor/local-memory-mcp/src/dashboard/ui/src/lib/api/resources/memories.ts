import { apiFetch } from "../client";
import type { Memory, Pagination } from "../../stores";

/** Memory CRUD + bulk operations. */
export const memoriesApi = {
	memories: (params: {
		repo: string;
		type?: string;
		search?: string;
		minImportance?: number | null;
		maxImportance?: number | null;
		sortBy?: string;
		sortOrder?: string;
		page?: number;
		pageSize?: number;
	}) => {
		const q = new URLSearchParams({ repo: params.repo });
		if (params.type) q.set("type", params.type);
		if (params.search) q.set("search", params.search);
		if (params.minImportance != null) q.set("minImportance", String(params.minImportance));
		if (params.maxImportance != null) q.set("maxImportance", String(params.maxImportance));
		if (params.sortBy) q.set("sortBy", params.sortBy);
		if (params.sortOrder) q.set("sortOrder", params.sortOrder);
		if (params.page) q.set("page", String(params.page));
		if (params.pageSize) q.set("pageSize", String(params.pageSize));
		return apiFetch<{ memories: Memory[]; pagination: Pagination }>(`/api/memories?${q}`);
	},

	memoryById: (id: string) => apiFetch<Memory>(`/api/memories/${id}`),

	createMemory: (body: Partial<Memory>) =>
		apiFetch<{ id: string }>("/api/memories", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		}),

	updateMemory: (id: string, updates: Partial<Memory>) =>
		apiFetch<{ success: boolean }>(`/api/memories/${id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(updates)
		}),

	deleteMemory: (id: string) => apiFetch<{ success: boolean }>(`/api/memories/${id}`, { method: "DELETE" }),

	bulkImportMemories: (repo: string, items: unknown[]) =>
		apiFetch<{ count: number }>("/api/memories/import", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ repo, items })
		}),

	bulkMemoryAction: (action: string, ids: string[], updates?: Partial<Memory>) =>
		apiFetch<{ count: number }>("/api/memories/action", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action, ids, updates })
		})
};
