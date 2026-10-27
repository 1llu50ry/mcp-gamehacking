import { apiFetch } from "../client";
import type { TaskClaim, Handoff, Pagination } from "../../stores";

/** Coordination endpoints: claims + handoffs. */
export const coordinationApi = {
	coordinationClaims: (params: {
		repo: string;
		agent?: string;
		active_only?: boolean;
		page?: number;
		pageSize?: number;
	}) => {
		const q = new URLSearchParams({ repo: params.repo });
		if (params.agent) q.set("agent", params.agent);
		if (params.active_only !== undefined) q.set("active_only", String(params.active_only));
		if (params.page) q.set("page", String(params.page));
		if (params.pageSize) q.set("pageSize", String(params.pageSize));
		return apiFetch<{ claims: TaskClaim[]; pagination: Pagination }>(`/api/coordination/claims?${q}`);
	},

	releaseClaim: (body: { repo: string; task_id?: string; task_code?: string; agent?: string }) =>
		apiFetch<{ success: boolean; task_id: string; task_code?: string | null; agent?: string | null }>(
			"/api/coordination/claims/release",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body)
			}
		),

	coordinationHandoffs: (params: {
		repo: string;
		status?: string;
		to_agent?: string;
		from_agent?: string;
		page?: number;
		pageSize?: number;
	}) => {
		const q = new URLSearchParams({ repo: params.repo });
		if (params.status) q.set("status", params.status);
		if (params.to_agent) q.set("to_agent", params.to_agent);
		if (params.from_agent) q.set("from_agent", params.from_agent);
		if (params.page) q.set("page", String(params.page));
		if (params.pageSize) q.set("pageSize", String(params.pageSize));
		return apiFetch<{ handoffs: Handoff[]; pagination: Pagination }>(`/api/coordination/handoffs?${q}`);
	},

	createHandoff: (body: {
		repo: string;
		from_agent: string;
		to_agent?: string;
		task_code?: string;
		summary: string;
		context?: Record<string, unknown>;
		expires_at?: string;
	}) =>
		apiFetch<{ success: boolean; handoff: Handoff }>("/api/coordination/handoffs", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		}),

	updateHandoffStatus: (body: { id: string; status: string }) =>
		apiFetch<{ success: boolean; handoff: Handoff }>("/api/coordination/handoffs/status", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		})
};
