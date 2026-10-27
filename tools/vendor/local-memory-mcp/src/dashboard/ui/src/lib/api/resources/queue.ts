import { apiFetch } from "../client";
import type { QueueJob, QueueStatus } from "../types";
import type { Pagination } from "../../stores";

// ─── Queue Admin ──────────────────────────────────────────────────────────
// TASK-297 failed-job admin view. `status` values on the wire are the
// LITERAL QueueJobStatus enum names (pending|claimed|done|poison) — the UI
// layer translates `poison` to a "Failed" label, the enum is never renamed.
// `?repo=` scope mirrors the other dashboard controllers (KG/Codebase/
// System): present → restricted to that entity_repo; absent → global view.

/** Queue admin endpoints (TASK-296/297). */
export const queueApi = {
	queueStatus: () => apiFetch<QueueStatus>("/api/queue/status"),

	queueJobs: (params: { repo?: string; status?: string; page?: number; pageSize?: number }) => {
		const q = new URLSearchParams();
		if (params.repo) q.set("repo", params.repo);
		if (params.status) q.set("status", params.status);
		if (params.page) q.set("page", String(params.page));
		if (params.pageSize) q.set("pageSize", String(params.pageSize));
		return apiFetch<{ jobs: QueueJob[]; pagination: Pagination }>(`/api/queue/jobs?${q}`);
	},

	queueRetryJob: (id: string, repo?: string) => {
		const q = repo ? `?repo=${encodeURIComponent(repo)}` : "";
		return apiFetch<QueueJob>(`/api/queue/jobs/${encodeURIComponent(id)}/retry${q}`, { method: "POST" });
	},

	queueClearJob: (id: string, repo?: string) => {
		const q = repo ? `?repo=${encodeURIComponent(repo)}` : "";
		return apiFetch<{ id: string; message: string }>(`/api/queue/jobs/${encodeURIComponent(id)}/clear${q}`, {
			method: "POST"
		});
	},

	queueRetryAll: (repo?: string) => {
		const q = repo ? `?repo=${encodeURIComponent(repo)}` : "";
		return apiFetch<{ id: string; retried: number }>(`/api/queue/retry-all${q}`, { method: "POST" });
	}
};
