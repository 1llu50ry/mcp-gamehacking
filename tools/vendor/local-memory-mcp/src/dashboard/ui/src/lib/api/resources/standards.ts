import { apiFetch } from "../client";
import type { CodingStandard, StandardsExport, StandardsImportResult, Pagination } from "../../stores";

/** Coding standards CRUD, export/import + bulk operations. */
export const standardsApi = {
	standards: (params: {
		repo?: string;
		query?: string;
		language?: string;
		stack?: string;
		tags?: string;
		is_global?: boolean;
		page?: number;
		pageSize?: number;
	}) => {
		const q = new URLSearchParams();
		if (params.repo) q.set("repo", params.repo);
		if (params.query) q.set("query", params.query);
		if (params.language) q.set("language", params.language);
		if (params.stack) q.set("stack", params.stack);
		if (params.tags) q.set("tags", params.tags);
		if (params.is_global !== undefined) q.set("is_global", String(params.is_global));
		if (params.page) q.set("page", String(params.page));
		if (params.pageSize) q.set("pageSize", String(params.pageSize));
		return apiFetch<{ standards: CodingStandard[]; pagination: Pagination }>(`/api/standards?${q}`);
	},

	standardById: (id: string) => apiFetch<CodingStandard>(`/api/standards/${id}`),

	createStandard: (body: Partial<CodingStandard>) =>
		apiFetch<CodingStandard>("/api/standards", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		}),

	updateStandard: (id: string, updates: Partial<CodingStandard>) =>
		apiFetch<{ success: boolean }>(`/api/standards/${id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(updates)
		}),

	deleteStandard: (id: string) => apiFetch<{ success: boolean }>(`/api/standards/${id}`, { method: "DELETE" }),

	exportStandards: (params: { repo?: string; scope?: "repo" | "global" | "all" }) => {
		const q = new URLSearchParams();
		if (params.repo) q.set("repo", params.repo);
		if (params.scope) q.set("scope", params.scope);
		return apiFetch<StandardsExport>(`/api/standards/export?${q}`);
	},

	importStandards: (body: StandardsExport | { standards: Partial<CodingStandard>[]; refresh_vectors?: boolean }) =>
		apiFetch<StandardsImportResult>("/api/standards/import", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		}),

	bulkStandardAction: (action: string, ids: string[], updates?: Partial<CodingStandard>) =>
		apiFetch<{ count: number }>("/api/standards/action", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action, ids, updates })
		})
};
