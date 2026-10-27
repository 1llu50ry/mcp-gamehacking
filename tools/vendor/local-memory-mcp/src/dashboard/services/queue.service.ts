import { db } from "../lib/context";
import { ServiceError } from "../lib/jsonApi";
import { outboxFor } from "../../mcp/embedding-queue/outbox";
import type { QueueJobRow, QueueJobStatus } from "../../mcp/embedding-queue/types";

/**
 * Embedding/KG outbox queue service layer (TASK-296).
 *
 * Dashboard queue-admin endpoints: paginated failed-job list, per-row
 * retry/clear, bulk retry. Owns ALL queue_jobs access for the dashboard
 * endpoints and the write-lock boundaries (TASK-102 — every mutation crosses
 * `db.withWrite`, reads stay outside). Controllers delegate here instead of
 * touching `db` directly — mirroring KgService.
 *
 * The status values in the API are the LITERAL `QueueJobStatus` enum values
 * (`pending | claimed | done | poison`); the UI layer translates `poison` to a
 * "failed" label — the enum is never renamed.
 */
const queueOutbox = outboxFor(db);

/** Default admin list view: in-flight + terminal-failed jobs. */
const DEFAULT_LIST_STATUSES: QueueJobStatus[] = ["pending", "poison"];

/**
 * Look up a queue row by id. When `repo` is supplied (TASK-360 multi-repo
 * scope), the row must ALSO belong to that `entity_repo` — a job living in a
 * different repo simply does not exist for this caller (same 404, no
 * cross-repo existence leak). Parameterized — the repo value is never
 * interpolated into the SQL string.
 */
function getJobById(id: string, repo?: string): QueueJobRow | undefined {
	const params: string[] = [id];
	let repoClause = "";
	if (repo) {
		repoClause = " AND entity_repo = ?";
		params.push(repo);
	}
	return db.db.prepare(`SELECT * FROM queue_jobs WHERE id = ?${repoClause}`).get(...params) as QueueJobRow | undefined;
}

/** Terminal-state guard: retry/clear only apply to poison/done rows. */
function assertTerminal(row: QueueJobRow, action: "retried" | "cleared"): void {
	if (row.status !== "poison" && row.status !== "done") {
		throw new ServiceError(
			409,
			`Queue job '${row.id}' has status '${row.status}' — only poison/done rows can be ${action}`
		);
	}
}

export const QueueService = {
	/**
	 * Paginated queue view. Pure read — NO write lock (TASK-102 contract,
	 * mirrors the "does not acquire the write lock" assertion pattern in
	 * controllers.integration.test.ts).
	 *
	 * `statuses` omitted → admin default (`pending` + `poison`); explicit
	 * values are passed through as-is (literal enum names, e.g. `["poison"]`).
	 *
	 * `repo` (TASK-360): optional multi-repo scope — when present the window
	 * is restricted to `entity_repo = repo`; absent → global (back-compat).
	 */
	listJobs(
		statuses: QueueJobStatus[] | undefined,
		limit: number,
		offset: number,
		repo?: string
	): { items: QueueJobRow[]; total: number } {
		return queueOutbox.listJobs({ statuses: statuses ?? DEFAULT_LIST_STATUSES, limit, offset, repo });
	},

	/**
	 * Flip a terminal `poison`/`done` row back to `pending` (attempts=0,
	 * last_error/backoff cleared) so the worker re-processes the stored
	 * snapshot. `repo` (TASK-360): when supplied, the job must belong to that
	 * `entity_repo` — a job in a different repo is 404 (job exists, but not in
	 * this repo), preserving the no-existence-leak contract. Mutation runs
	 * inside `db.withWrite` (TASK-102).
	 */
	async retryJob(id: string, repo?: string): Promise<QueueJobRow> {
		return db.withWrite(() => {
			const row = getJobById(id, repo);
			if (!row) throw new ServiceError(404, "Queue job not found");
			assertTerminal(row, "retried");

			// Defense-in-depth: the guarded UPDATE also filters by repo, so
			// even a read/write race inside the lock cannot flip another
			// repo's row.
			if (!queueOutbox.retryJob(id, repo)) {
				// Guarded UPDATE matched zero rows inside the lock — the row
				// changed between the read and the write; surface a conflict
				// rather than a false success.
				throw new ServiceError(409, `Queue job '${row.id}' is not retryable`);
			}
			return getJobById(id) as QueueJobRow;
		});
	},

	/**
	 * Bulk retry: flips every `poison` row back to `pending`. `repo`
	 * (TASK-360): when supplied, ONLY that repo's poison rows are flipped
	 * (a repo-scoped retry-all can never mass-reset another repo's rows).
	 * Mutation runs inside `db.withWrite` (TASK-102).
	 *
	 * @returns the number of jobs flipped (0 is a valid, idempotent outcome).
	 */
	async retryAllPoison(repo?: string): Promise<number> {
		return db.withWrite(() => queueOutbox.retryAllPoison(repo));
	},

	/**
	 * Admin clear: deletes a specific `poison`/`done` row (row-level purge).
	 * `repo` (TASK-360): when scoped, the job must belong to that
	 * `entity_repo` — a job in a different repo is 404 (no cross-repo
	 * deletion, no existence leak). Mutation runs inside `db.withWrite`
	 * (TASK-102). A live (`pending`/`claimed`) job is never removable.
	 */
	async clearJob(id: string, repo?: string): Promise<{ id: string; message: string }> {
		return db.withWrite(() => {
			const row = getJobById(id, repo);
			if (!row) throw new ServiceError(404, "Queue job not found");
			assertTerminal(row, "cleared");

			// Defense-in-depth: the guarded DELETE also filters by repo.
			if (!queueOutbox.deleteJob(id, repo)) {
				throw new ServiceError(409, `Queue job '${row.id}' is not clearable`);
			}
			return { id, message: "Deleted" };
		});
	}
};
