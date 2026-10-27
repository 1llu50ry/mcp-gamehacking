import express from "express";
import { embeddingWorker } from "../lib/context";
import { jsonApiRes, handleController, HttpError, parsePageParams } from "../lib/jsonApi";
import { QueueService } from "../services/queue.service";
import { EMBEDDING_QUEUE_POISON_THRESHOLD } from "../../mcp/utils/constants";
import type { QueueJobRow, QueueJobStatus } from "../../mcp/embedding-queue/types";

/**
 * Embedding/KG outbox queue endpoint surface (TASK-013 observability,
 * TASK-296 failed-job admin).
 *
 * Wire contract:
 * - `status` in list responses / filters uses the LITERAL `QueueJobStatus`
 *   enum values (`pending | claimed | done | poison`). The UI layer renders
 *   `poison` as a "failed" label — the enum is never renamed.
 * - Optional `?repo=` scope (TASK-360) on all admin endpoints, mirroring the
 *   other dashboard controllers (KG/Codebase/System): when present, results
 *   are restricted to `entity_repo = repo` and retry/clear 404 on a job from
 *   a different repo; absent → global behavior (back-compat with the
 *   unscoped GET /api/queue/status).
 * - Reads (`status`, `jobs`) never acquire the write lock; every mutation
 *   (`retry`/`clear`/`retry-all`) runs inside `db.withWrite` via the service
 *   (TASK-102 contract).
 */

/** Literal status values accepted by the `?status=` filter (types.ts QueueJobStatus). */
const QUEUE_JOB_STATUSES: readonly QueueJobStatus[] = ["pending", "claimed", "done", "poison"];

/**
 * Parse the optional `?repo=` filter at the request boundary (TASK-360).
 * Mirrors the parseStatusFilter contract: absent/empty → `undefined` (global
 * scope, back-compat), present → trimmed. A present-but-whitespace-only value
 * is a malformed filter → 400 (fail-closed: silently falling back to the
 * GLOBAL blast radius for a destructive op is worse than a 400).
 */
function parseRepoFilter(raw: unknown): string | undefined {
	if (raw === undefined || raw === "") return undefined;
	const trimmed = String(raw).trim();
	if (!trimmed) throw new HttpError(400, "Invalid repo filter — repo must not be empty");
	return trimmed;
}

/**
 * Parse the optional comma-separated `?status=` filter at the request
 * boundary. Absent → `undefined` (service applies the admin default
 * `pending,poison`). Any non-enum token → 400 with the valid literals.
 */
function parseStatusFilter(raw: unknown): QueueJobStatus[] | undefined {
	if (raw === undefined || raw === "") return undefined;
	const tokens = String(raw)
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	if (tokens.length === 0) {
		throw new HttpError(400, `Invalid status filter. Must be one of: ${QUEUE_JOB_STATUSES.join(", ")}`);
	}
	const invalid = tokens.filter((t) => !QUEUE_JOB_STATUSES.includes(t as QueueJobStatus));
	if (invalid.length > 0) {
		throw new HttpError(
			400,
			`Invalid status value(s): ${invalid.join(", ")}. Must be one of: ${QUEUE_JOB_STATUSES.join(", ")}`
		);
	}
	return tokens as QueueJobStatus[];
}

/**
 * Wire shape for a queue job row — strips internal columns (payload snapshot,
 * content_hash, lease/lock tokens) and maps the raw timestamps onto the
 * friendly field names the UI contract consumes. `status` is the literal enum
 * value (`pending | claimed | done | poison`).
 */
function toQueueJobAttributes(row: QueueJobRow): Record<string, unknown> {
	return {
		id: row.id,
		entity_kind: row.entity_kind,
		entity_id: row.entity_id,
		entity_repo: row.entity_repo,
		status: row.status,
		attempts: row.attempts,
		max_attempts: EMBEDDING_QUEUE_POISON_THRESHOLD,
		enqueued_at: row.created_at,
		processed_at: row.updated_at,
		last_error: row.last_error
	};
}

export class QueueController {
	static async status(req: express.Request, res: express.Response) {
		await handleController(req, res, () => jsonApiRes(embeddingWorker.getStats(), "queue-status"));
	}

	/**
	 * GET /api/queue/jobs — paginated failed-job admin view.
	 * Optional `?status=` filter (comma-separated literal enum values;
	 * default `pending,poison`) and optional `?repo=` scope (TASK-360 —
	 * restrict to one `entity_repo`; absent → global, back-compat).
	 * Pure read — no write lock. Sorting is newest-first (`created_at DESC`).
	 */
	static async listJobs(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const { page, pageSize, offset } = parsePageParams(req.query);
			const statuses = parseStatusFilter(req.query.status);
			const repo = parseRepoFilter(req.query.repo);

			const result = QueueService.listJobs(statuses, pageSize, offset, repo);

			return jsonApiRes(result.items.map(toQueueJobAttributes), "queue-job", {
				meta: {
					page,
					pageSize,
					totalItems: result.total,
					totalPages: Math.ceil(result.total / pageSize)
				}
			});
		});
	}

	/**
	 * POST /api/queue/jobs/:id/retry — flip a `poison`/`done` job back to
	 * `pending` (attempts=0, last_error/backoff cleared) so the worker
	 * re-processes the stored snapshot. 404 when the job is unknown OR belongs
	 * to a different repo than the optional `?repo=` scope (TASK-360); 409
	 * when its status is not retryable. Mutation runs inside db.withWrite.
	 */
	static async retryJob(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const id = req.params.id as string;
			const repo = parseRepoFilter(req.query.repo);
			const row = await QueueService.retryJob(id, repo);
			return jsonApiRes(toQueueJobAttributes(row), "queue-job");
		});
	}

	/**
	 * POST /api/queue/jobs/:id/clear (also DELETE /api/queue/jobs/:id) —
	 * delete a specific `poison`/`done` row. 404 when unknown OR in a
	 * different repo than the optional `?repo=` scope (TASK-360); 409 when
	 * the job is live (`pending`/`claimed`). Mutation runs inside `withWrite`.
	 */
	static async clearJob(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const id = req.params.id as string;
			const repo = parseRepoFilter(req.query.repo);
			const result = await QueueService.clearJob(id, repo);
			return jsonApiRes(result, "queue-job-clear");
		});
	}

	/**
	 * POST /api/queue/retry-all — bulk flip every `poison` job to `pending`.
	 * Optional `?repo=` scope (TASK-360): flips ONLY that repo's poison rows;
	 * absent → global (back-compat). Response carries the number of jobs
	 * re-queued. Mutation runs inside `withWrite`.
	 */
	static async retryAll(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const repo = parseRepoFilter(req.query.repo);
			const retried = await QueueService.retryAllPoison(repo);
			return jsonApiRes({ id: "retry-all", retried }, "queue-retry-all", { meta: { retried } });
		});
	}
}
