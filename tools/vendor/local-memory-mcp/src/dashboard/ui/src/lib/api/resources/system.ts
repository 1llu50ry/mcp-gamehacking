import { apiFetch } from "../client";
import type {
	Memory,
	Task,
	RepoMeta,
	DashboardStats,
	RecentAction,
	TaskClaim,
	Handoff,
	HealthData,
	Pagination,
	ReferenceDataState
} from "../../stores";

/** System-wide endpoints: health, repos, dashboard stats, export, capabilities. */
export const systemApi = {
	health: () => apiFetch<HealthData>("/api/health"),

	repos: () => apiFetch<{ repos: RepoMeta[] }>("/api/repos"),

	stats: (repo?: string) => {
		const q = repo ? `?repo=${encodeURIComponent(repo)}` : "";
		return apiFetch<DashboardStats>(`/api/stats${q}`);
	},

	recentActions: (repo: string | null, page: number, pageSize: number) => {
		let url = `/api/recent-actions?page=${page}&pageSize=${pageSize}`;
		if (repo) url += `&repo=${encodeURIComponent(repo)}`;
		return apiFetch<{ actions: RecentAction[]; pagination: Pagination }>(url);
	},

	export: (repo: string) =>
		apiFetch<{ repo: string; exported_at: string; tasks: Task[]; memories: Memory[] }>(
			`/api/export?repo=${encodeURIComponent(repo)}`
		),

	capabilities: () => apiFetch<ReferenceDataState>("/api/capabilities"),

	/**
	 * TASK-269 / audit F7: ONE aggregate endpoint replacing the ~5×N per-repo
	 * fan-out the Agent Arena fired on load. Returns the same task/claim/
	 * handoff rows the per-repo endpoints returned, merged across all repos.
	 */
	arenaOverview: (signal?: AbortSignal) =>
		apiFetch<{ id?: string; tasks: Task[]; claims: TaskClaim[]; handoffs: Handoff[] }>(
			"/api/dashboard/overview",
			signal ? { signal } : undefined
		),

	callTool: (name: string, args: Record<string, unknown>) =>
		apiFetch<unknown>(`/api/tools/${encodeURIComponent(name)}/call`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(args)
		})
};
