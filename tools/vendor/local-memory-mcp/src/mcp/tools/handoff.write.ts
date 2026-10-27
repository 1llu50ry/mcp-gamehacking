import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { HandoffWriteSchema, HandoffStatusSchema } from "./schemas/index";
import { UUID_REGEX } from "../utils/uuid";
import { extractNextSteps } from "../utils/next-steps";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HandoffWriteParams = {
	// CREATE fields
	owner?: string;
	repo?: string;
	from_agent?: string;
	to_agent?: string;
	task_id?: string;
	task_code?: string;
	summary?: string;
	context?: Record<string, unknown>;
	expires_at?: string;

	// UPDATE fields
	id?: string;
	status?: string;

	// Metadata
	json: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// extractNextSteps imported from ../utils/next-steps

// ---------------------------------------------------------------------------
// Core: CREATE handoff
// ---------------------------------------------------------------------------

async function coreCreate(
	params: HandoffWriteParams,
	storage: SQLiteStore
): Promise<{ handoff: Record<string, unknown>; contentSummary: string }> {
	if (!params.owner) {
		throw new Error("CREATE requires: owner");
	}
	if (!params.repo) {
		throw new Error("CREATE requires: repo");
	}
	if (!params.from_agent) {
		throw new Error("CREATE requires: from_agent");
	}
	if (!params.summary) {
		throw new Error("CREATE requires: summary");
	}

	// Validate status is not passed for CREATE
	if (params.status) {
		throw new Error("status is not valid for CREATE — use id + status for UPDATE");
	}

	// Transfer-context validation: reject completed-work summaries without
	// a target agent, linked task, or context describing remaining work
	if (
		!params.to_agent &&
		!params.task_id &&
		!params.task_code &&
		!params.context?.next_steps &&
		!params.context?.blockers &&
		!params.context?.remaining_work
	) {
		throw new Error(
			"Handoffs must identify a target agent, linked task, next_steps, blockers, or remaining_work. " +
				"Do not create pending handoffs for completed-work summaries."
		);
	}

	// Resolve task_id from task_code if provided
	let resolvedTaskId = params.task_id ?? null;
	if (resolvedTaskId && !UUID_REGEX.test(resolvedTaskId)) {
		const task = storage.tasks.getTaskByCode(params.owner, params.repo, resolvedTaskId);
		if (!task) {
			throw new Error(`Task not found: ${resolvedTaskId} (owner="${params.owner}", repo="${params.repo}")`);
		}
		resolvedTaskId = task.id;
	}
	if (!resolvedTaskId && params.task_code) {
		const task = storage.tasks.getTaskByCode(params.owner, params.repo, params.task_code);
		if (!task) {
			throw new Error(`Task not found: ${params.task_code} (owner="${params.owner}", repo="${params.repo}")`);
		}
		resolvedTaskId = task.id;
	}

	// Mutual exclusion: task_id and task_code
	if (params.task_id && params.task_code) {
		throw new Error("Provide either task_id or task_code, not both");
	}

	const handoff = storage.handoffs.createHandoff({
		owner: params.owner,
		repo: params.repo,
		from_agent: params.from_agent,
		to_agent: params.to_agent ?? null,
		task_id: resolvedTaskId,
		summary: params.summary,
		context: params.context,
		expires_at: params.expires_at ?? null
	});

	// Auto-comment on linked task for traceability
	if (handoff.task_id) {
		const now = new Date().toISOString();
		const target = handoff.to_agent || "unassigned";
		try {
			storage.taskComments.insertTaskComment({
				id: randomUUID(),
				task_id: handoff.task_id,
				owner: params.owner,
				repo: params.repo,
				comment: `Handoff [${handoff.id.slice(0, 8)}] created: ${handoff.from_agent} → ${target} — ${handoff.summary}`,
				agent: handoff.from_agent,
				role: "unknown",
				model: "system",
				previous_status: null,
				next_status: null,
				created_at: now
			});
		} catch (e) {
			logger.error("[Tool] handoff.write — task comment failed (handoff already committed)", {
				repo: params.repo,
				handoffId: handoff.id,
				error: String(e)
			});
			storage.actions.logAction("handoff-comment-fail", params.owner, params.repo, {
				query: `handoff ${handoff.id.slice(0, 8)} — comment insert failed`
			});
		}
	}

	const excerpt = handoff.summary.length > 50 ? handoff.summary.slice(0, 50) + "..." : handoff.summary;
	const contentSummary = `Created [${handoff.id.slice(0, 8)}] "${excerpt}" — ${handoff.from_agent}→${handoff.to_agent || "unassigned"} (${handoff.status}) in "${handoff.repo}".`;

	return { handoff: handoff as unknown as Record<string, unknown>, contentSummary };
}

// ---------------------------------------------------------------------------
// Core: UPDATE handoff status
// ---------------------------------------------------------------------------

async function coreUpdate(
	params: HandoffWriteParams,
	storage: SQLiteStore
): Promise<{ result: Record<string, unknown>; contentSummary: string }> {
	if (!params.id) {
		throw new Error("UPDATE requires: id");
	}
	if (!params.status) {
		throw new Error("UPDATE requires: status");
	}

	// Validate status value
	const statusResult = HandoffStatusSchema.safeParse(params.status);
	if (!statusResult.success) {
		throw new Error(`Invalid status: "${params.status}". Must be one of: pending, accepted, rejected, expired`);
	}
	const status = statusResult.data;

	// FIX-023: resolve a short-id prefix (as displayed by handoff-read's list
	// view) to the full UUID once, then use the canonical id for the existence
	// check, the UPDATE, and the follow-up read. An ambiguous prefix throws
	// AmbiguousHandoffError (ToolError) from the entity — the transport
	// surfaces it verbatim instead of silently picking one match.
	const resolvedId = storage.handoffs.resolveHandoffId(params.id);

	const existing = storage.handoffs.getHandoffById(resolvedId);
	if (!existing) {
		throw new Error(`Handoff not found: ${params.id}`);
	}

	const success = storage.handoffs.updateHandoffStatus(resolvedId, status);
	if (!success) {
		throw new Error(`Failed to update handoff: ${params.id}`);
	}

	const updated = storage.handoffs.getHandoffById(resolvedId);
	const result = {
		success,
		id: resolvedId,
		status,
		handoff: updated
	};

	// Auto-comment on status change for traceability
	if (updated?.task_id && status !== existing.status) {
		const now = new Date().toISOString();
		let comment: string;
		if (status === "accepted") {
			const steps = extractNextSteps(existing.context as Record<string, unknown>);
			comment = `Handoff [${resolvedId.slice(0, 8)}] accepted by ${updated.to_agent || existing.from_agent}.`;
			if (steps) {
				comment += ` Next steps: ${steps}`;
			}
		} else {
			comment = `Handoff [${resolvedId.slice(0, 8)}] ${status}`;
		}
		try {
			storage.taskComments.insertTaskComment({
				id: randomUUID(),
				task_id: updated.task_id,
				owner: updated.owner,
				repo: updated.repo,
				comment,
				agent: existing.from_agent,
				role: "unknown",
				model: "system",
				previous_status: null,
				next_status: null,
				created_at: now
			});
		} catch (e) {
			logger.error("[Tool] handoff.write — task comment failed (handoff already committed)", {
				repo: updated.repo,
				handoffId: resolvedId,
				status,
				error: String(e)
			});
			storage.actions.logAction("handoff-comment-fail", updated.owner, updated.repo, {
				query: `handoff ${resolvedId.slice(0, 8)} — status-change comment failed`
			});
		}
	}

	const excerpt = existing.summary.length > 50 ? existing.summary.slice(0, 50) + "..." : existing.summary;
	const contentSummary = `Updated [${resolvedId.slice(0, 8)}] "${excerpt}" in "${existing.repo}" — ${existing.status} → ${status}.`;

	return { result, contentSummary };
}

// ---------------------------------------------------------------------------
// Main handler entry point
// ---------------------------------------------------------------------------

export async function handleHandoffWrite(params: Record<string, unknown>, storage: SQLiteStore): Promise<McpResponse> {
	const validated = HandoffWriteSchema.parse(params) as unknown as HandoffWriteParams;

	// ── UPDATE mode: id present ──
	if (validated.id) {
		const { result, contentSummary } = await coreUpdate(validated, storage);
		return createMcpResponse(result, contentSummary, {
			contentSummary,
			includeJson: validated.json
		});
	}

	// ── CREATE mode: summary + from_agent present (no id) ──
	if (validated.summary && validated.from_agent) {
		const { handoff, contentSummary } = await coreCreate(validated, storage);
		return createMcpResponse(handoff, contentSummary, {
			contentSummary,
			includeJson: validated.json
		});
	}

	// ── Nothing matched ──
	throw new Error(
		"Could not infer operation. Provide:\n" +
			"  - `summary` + `from_agent` (with `owner`, `repo`) for CREATE\n" +
			"  - `id` + `status` for UPDATE"
	);
}
