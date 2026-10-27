import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite";
import { buildTableResult, createMcpResponse, McpResponse } from "./mcp-response";
import { UUID_REGEX } from "./uuid";
import { assertNotOrchestratorPlaceholder } from "./placeholder-code";
import { TASK_STATUS_IN_PROGRESS } from "../types";
import type { Claim, Task, TaskStatus } from "../types";
import { logger } from "./logger";

/**
 * Shared coordination lifecycle (OPT-DRY-02).
 *
 * Single source of truth for the claim/release/list plumbing previously
 * duplicated across `tools/claim.manage.ts` (the registered `claim-manage`
 * tool) and the legacy `tools/handoff.manage.ts`. OPT-FEAT-01 removed the
 * dashboard COORDINATION_TOOLS shim that depended on the legacy handlers;
 * OPT-CODE-02 deleted `handoff.manage.ts` entirely.
 *
 * Behavior contract:
 * - CLAIM auto-promotes a non-completed task to `in_progress` and writes an
 *   audited task comment. The comment insert is wrapped in try/catch +
 *   `actions.logAction` — the SAFER behavior that `handoff.manage` had and
 *   `claim.manage` had drifted away from. Unified here so a comment failure
 *   never takes down an already-committed claim.
 * - LIST renders the claim table envelope (`{ schema, claims: { columns, rows },
 *   count, offset }`) and a canonical human summary.
 * - RELEASE resolves the task, calls the entity release, and fails loudly if
 *   no active claim matched.
 */

/** Result of {@link resolveTaskByRef}: a UUID id, its task_code, and the task row. */
export interface ResolvedTaskRef {
	taskId: string;
	taskCode: string;
	task: Task;
}

/**
 * Resolves a task by UUID `task_id` or `task_code` using
 * `UUID_REGEX → getTaskByCode → getTaskById` (the sequence previously copied
 * 4× across claim.manage.ts and handoff.manage.ts).
 *
 * A non-UUID value in the `task_id` slot is treated as a code and resolved via
 * `getTaskByCode`. A UUID is looked up by id and cross-checked against the
 * request `repo`. Explicit `task_code` is honored when no `task_id` resolved.
 * Throws with a descriptive message when the task cannot be found or when
 * neither ref is provided.
 */
export function resolveTaskByRef(
	owner: string,
	repo: string,
	taskId: string | undefined,
	taskCode: string | undefined,
	storage: SQLiteStore
): ResolvedTaskRef {
	let resolvedId = taskId as string | undefined;
	let resolvedCode: string | null = taskCode ?? null;

	// FIX-021: reject reserved orchestrator template placeholders (T01/R01/Q01/…)
	// in either slot before any lookup, so an unsubstituted template yields the
	// actionable VALIDATION_ERROR instead of a bare "Task not found: T01". The
	// reserved shape can never match a UUID, so asserting on both slots is safe.
	assertNotOrchestratorPlaceholder(taskId);
	assertNotOrchestratorPlaceholder(taskCode);

	// task_code supplied in the task_id slot → resolve via code
	if (resolvedId && !UUID_REGEX.test(resolvedId)) {
		const task = storage.tasks.getTaskByCode(owner, repo, resolvedId);
		if (!task) {
			throw new Error(`Task not found: ${resolvedId} (owner="${owner}", repo="${repo}")`);
		}
		resolvedId = task.id;
		resolvedCode = task.task_code;
	}

	// resolvedId is a UUID → fetch by id (repo must match)
	if (resolvedId) {
		const task = storage.tasks.getTaskById(resolvedId);
		if (!task || task.repo !== repo) {
			throw new Error(`Task not found: ${resolvedId} (owner="${owner}", repo="${repo}")`);
		}
		return { taskId: resolvedId, taskCode: resolvedCode ?? task.task_code, task };
	}

	// explicit task_code → resolve
	if (taskCode) {
		const task = storage.tasks.getTaskByCode(owner, repo, taskCode);
		if (!task) {
			throw new Error(`Task not found: ${taskCode} (owner="${owner}", repo="${repo}")`);
		}
		return { taskId: task.id, taskCode: task.task_code, task };
	}

	throw new Error("Either task_id or task_code must be provided");
}

/**
 * CLAIM + auto-promote + audited task comment.
 *
 * Registers the claim, auto-promotes a non-completed task to `in_progress`,
 * and writes a "Claimed by <agent> — auto-promoted to in_progress" comment.
 * The comment insert is non-fatal: on failure it is logged and an
 * `handoff-comment-fail` action row is written so an already-committed claim
 * is never rolled back. (Keeps the safer `handoff.manage` audit behavior that
 * `claim.manage` had drifted away from.)
 */
export function claimWithAudit(
	task: Task,
	owner: string,
	repo: string,
	agent: string,
	role: string | undefined,
	metadata: Record<string, unknown> | undefined,
	storage: SQLiteStore
): Claim {
	const claim = storage.handoffs.claimTask({
		owner,
		repo,
		task_id: task.id,
		agent,
		role,
		metadata
	});

	if (task.status === "completed") {
		return claim;
	}

	const now = new Date().toISOString();
	storage.tasks.updateTask(task.id, { status: TASK_STATUS_IN_PROGRESS, in_progress_at: now });

	try {
		storage.taskComments.insertTaskComment({
			id: randomUUID(),
			task_id: task.id,
			owner,
			repo,
			comment: `Claimed by ${agent} — auto-promoted to in_progress`,
			agent,
			role: role || "unknown",
			model: "system",
			previous_status: task.status as TaskStatus,
			next_status: TASK_STATUS_IN_PROGRESS,
			created_at: now
		});
	} catch (e) {
		logger.error("[coordination] claim auto-promote comment failed (claim committed)", {
			repo,
			taskId: task.id,
			agent,
			error: String(e)
		});
		storage.actions.logAction("handoff-comment-fail", owner, repo, {
			query: `task ${task.task_code} — claim comment failed`
		});
	}

	return claim;
}

/**
 * Full CLAIM operation → MCP response. Resolves the task ref, claims with
 * audit, and returns the `{ ...claim, task_code }` payload + summary.
 */
export function claimCoordinated(
	owner: string,
	repo: string,
	taskId: string | undefined,
	taskCode: string | undefined,
	agent: string,
	role: string | undefined,
	metadata: Record<string, unknown> | undefined,
	json: boolean,
	storage: SQLiteStore
): McpResponse {
	const { taskId: resolvedId, taskCode: resolvedCode, task } = resolveTaskByRef(owner, repo, taskId, taskCode, storage);
	const claim = claimWithAudit(task, owner, repo, agent, role, metadata, storage);

	const responseData = {
		...claim,
		task_code: resolvedCode
	};

	const contentSummary = `Claimed [${resolvedCode || resolvedId.slice(0, 8)}] in repo "${claim.repo}": agent=${claim.agent}, role=${claim.role}.`;

	return createMcpResponse(responseData, contentSummary, {
		contentSummary,
		includeJson: json
	});
}

/** Shared claim-list table column order (`as const` for the envelope). */
export const CLAIMS_LIST_COLUMNS = [
	"id",
	"task_id",
	"task_code",
	"agent",
	"role",
	"claimed_at",
	"released_at",
	"metadata"
] as const;

/** Canonical claim list summary (sample-rich form claim.manage introduced). */
export function buildClaimListSummary(
	repo: string,
	count: number,
	agent?: string,
	activeOnly?: boolean,
	sampleClaims?: Array<{ task_code?: string | null; agent: string; role: string }>
): string {
	const parts: string[] = [`Found ${count} claim${count === 1 ? "" : "s"} in repo "${repo}".`];

	if (sampleClaims && sampleClaims.length > 0) {
		const lines = sampleClaims.slice(0, 3).map((c) => {
			const code = c.task_code || "?";
			return `  [${code}] by ${c.agent} (${c.role || "unknown"})`;
		});
		parts.push("", ...lines);
		if (count > 3) parts.push(`  ... and ${count - 3} more`);
	}

	if (agent) {
		parts.push(`  Agent filter: ${agent}.`);
	}

	if (activeOnly) {
		parts.push("  Showing active claims only.");
	}

	return parts.join("\n");
}

/**
 * FULL LIST handler → MCP response. Builds the claim table envelope
 * (`{ schema, claims: { columns, rows }, count, offset }`) and the summary.
 * `schema` is caller-controlled ("claim-manage" vs "claim-list") so the wire
 * discriminator stays behavior-identical for each consumer.
 */
export function listClaimsTable(
	owner: string,
	repo: string,
	agent: string | undefined,
	activeOnly: boolean,
	limit: number,
	offset: number,
	schema: string,
	json: boolean,
	storage: SQLiteStore
): McpResponse {
	const claims = storage.handoffs.listClaims({
		owner,
		repo,
		agent,
		active_only: activeOnly,
		limit,
		offset
	});

	const rows = claims.map((claim) => [
		claim.id,
		claim.task_id,
		claim.task_code ?? null,
		claim.agent,
		claim.role,
		claim.claimed_at,
		claim.released_at,
		claim.metadata
	]);

	const structuredData = buildTableResult(CLAIMS_LIST_COLUMNS, rows, {
		schema,
		key: "claims",
		count: rows.length,
		offset
	});

	const contentSummary = buildClaimListSummary(repo, rows.length, agent, activeOnly, claims);

	return createMcpResponse(structuredData, contentSummary, {
		contentSummary,
		includeJson: json
	});
}

/**
 * FULL RELEASE handler → MCP response. Resolves the claim ref, calls the
 * entity release, fails loudly when no active claim exists, and returns the
 * result + summary.
 */
export function releaseClaim(
	owner: string,
	repo: string,
	taskId: string | undefined,
	taskCode: string | undefined,
	agent: string | undefined,
	json: boolean,
	storage: SQLiteStore
): McpResponse {
	const { taskId: resolvedId, taskCode: resolvedCode } = resolveTaskByRef(owner, repo, taskId, taskCode, storage);

	const success = storage.handoffs.releaseClaim(resolvedId, agent);
	if (!success) {
		throw new Error(`No active claim found for task ${resolvedCode || resolvedId}`);
	}

	const result = {
		success,
		repo,
		task_id: resolvedId,
		task_code: resolvedCode,
		agent: agent ?? null
	};
	const contentSummary = `Released claim for [${resolvedCode || resolvedId.slice(0, 8)}] in repo "${repo}": agent=${agent || "any"}.`;

	return createMcpResponse(result, contentSummary, {
		contentSummary,
		includeJson: json
	});
}
