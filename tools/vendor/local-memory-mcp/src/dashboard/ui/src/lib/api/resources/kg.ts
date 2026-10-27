import { apiFetch } from "../client";
import type { KGNode, KGEdge, KGEntity, Pagination } from "../../stores";

/** Knowledge-graph endpoints: graph, entities, relations. */
export const kgApi = {
	// ─── Knowledge Graph ──────────────────────────────────────────────────────

	kgGraph: (
		repo: string,
		params?: { page?: number; pageSize?: number; graphLimit?: number; signal?: AbortSignal; includeEdges?: boolean }
	) => {
		const q = new URLSearchParams({ repo });
		// TASK-213: top-N-by-degree mode sends `graphLimit` INSTEAD of page/pageSize.
		// The server treats graphLimit as authoritative — it bypasses the pageSize
		// clamp ([100,1000]) and forces offset=0, so sending page alongside would
		// be ambiguous. graphLimit mode ignores page/pageSize entirely.
		if (params?.graphLimit) {
			q.set("graphLimit", String(params.graphLimit));
		} else {
			if (params?.page) q.set("page", String(params.page));
			if (params?.pageSize) q.set("pageSize", String(params.pageSize));
		}
		// TASK-198: only an explicit `false` opts out of the edge payload (up to
		// 4000 edges). Absent/true leave the query unchanged (server default).
		if (params?.includeEdges === false) q.set("includeEdges", "false");
		return apiFetch<{ nodes: KGNode[]; edges: KGEdge[]; truncated: boolean; pagination: Pagination }>(
			`/api/kg/graph?${q}`,
			params?.signal ? { signal: params.signal } : undefined
		);
	},

	kgEntityDetail: (name: string, repo: string) =>
		apiFetch<{ entity: Record<string, unknown>; relations: unknown[]; observations: unknown[] }>(
			`/api/kg/entities/${encodeURIComponent(name)}?repo=${encodeURIComponent(repo)}`
		),

	kgEntities: (repo: string, params?: { type?: string; search?: string; page?: number; pageSize?: number }) => {
		const q = new URLSearchParams({ repo });
		if (params?.type) q.set("type", params.type);
		if (params?.search) q.set("search", params.search);
		if (params?.page) q.set("page", String(params.page));
		if (params?.pageSize) q.set("pageSize", String(params.pageSize));
		return apiFetch<{ entities: KGEntity[]; pagination: Pagination }>(`/api/kg/entities?${q}`);
	},

	kgCreateEntity: (body: { name: string; type?: string; description?: string; repo: string }) =>
		apiFetch<{ id: string }>("/api/kg/entities", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		}),

	kgDeleteEntity: (name: string, repo: string) =>
		apiFetch<{ success: boolean }>(`/api/kg/entities/${encodeURIComponent(name)}?repo=${encodeURIComponent(repo)}`, {
			method: "DELETE"
		}),

	kgCreateRelation: (body: { from_entity: string; to_entity: string; relation_type: string; repo: string }) =>
		apiFetch<{ success: boolean }>("/api/kg/relations", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		}),

	kgDeleteRelation: (body: { from_entity: string; to_entity: string; relation_type: string; repo: string }) =>
		apiFetch<{ success: boolean }>("/api/kg/relations", {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		})
};
