import { randomUUID } from "crypto";
import { SQLiteStore } from "../../storage/sqlite";
import { Task, TaskStatus, TaskPriority, VectorStore, TASK_STATUS_BACKLOG } from "../../types";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { resolveEntityCode } from "../../utils/code-generator";
import { enqueueTask } from "../../embedding-queue";
import { resolveParentId, resolveDependsOn, deriveTaskStatusTimestamps } from "../task.helpers";
import { applyDecisionRefs } from "./effects";
import { duplicateCodeMessage, missingCreateFields, missingCreateFieldsMessage } from "./errors";
import { TaskWriteParams } from "./types";

// ---------------------------------------------------------------------------
// Single CREATE
// ---------------------------------------------------------------------------

function coreCreate(params: TaskWriteParams, storage: SQLiteStore): { task: Task; code: string } {
	const { owner, repo } = params;

	if (!params.phase || !params.title || !params.description) {
		// FIX-027: list EXACTLY which of phase/title/description are absent.
		throw new Error(missingCreateFieldsMessage(missingCreateFields(params), "single"));
	}

	const resolvedCode = resolveEntityCode(params.code ?? null, owner ?? "", repo, "task", storage);

	if (params.code && resolvedCode !== params.code) {
		// FIX-027: name the existing task so the caller can update instead.
		throw new Error(duplicateCodeMessage(params.code, storage.tasks.getTaskByCode(owner, repo, params.code)));
	}

	let effectiveStatus: TaskStatus = (params.status || TASK_STATUS_BACKLOG) as TaskStatus;

	if (params.status !== "backlog" && params.status !== "pending" && params.status !== undefined) {
		throw new Error("New tasks must be created with status 'backlog' or 'pending'.");
	}

	if (params.status === "pending") {
		const stats = storage.taskStats.getTaskStats(owner, repo);
		if (stats.todo > 10) {
			effectiveStatus = TASK_STATUS_BACKLOG;
		}
	}

	const taskId = randomUUID();
	const now = new Date().toISOString();
	const statusTimestamps = deriveTaskStatusTimestamps(effectiveStatus, now);
	const finalTags = [...(params.tags || [])];
	const phaseTag = `phase:${params.phase}`;
	if (!finalTags.includes(phaseTag)) {
		finalTags.push(phaseTag);
	}

	const finalMetadata = applyDecisionRefs(params.decision_refs, params.metadata);

	const task: Task = {
		id: taskId,
		owner,
		repo,
		task_code: resolvedCode,
		phase: params.phase,
		title: params.title,
		description: params.description,
		status: effectiveStatus,
		priority: (params.priority as TaskPriority) || 3,
		agent: params.agent || "unknown",
		role: params.role || "unknown",
		doc_path: params.doc_path || null,
		created_at: now,
		updated_at: now,
		in_progress_at: statusTimestamps.in_progress_at,
		finished_at: statusTimestamps.finished_at,
		canceled_at: statusTimestamps.canceled_at,
		est_tokens: params.est_tokens ?? 0,
		tags: finalTags,
		suggested_skills: params.suggested_skills || [],
		commit_id: null,
		changed_files: [],
		metadata: finalMetadata,
		parent_id: resolveParentId(params.parent_id, owner, repo, storage),
		depends_on: resolveDependsOn(params.depends_on, owner, repo, storage)
	};

	storage.tasks.insertTask(task);

	return { task, code: resolvedCode };
}

export async function handleCreateSingle(
	params: TaskWriteParams,
	storage: SQLiteStore,
	_vectors: VectorStore
): Promise<McpResponse> {
	// Insert task + enqueue embedding/KG job atomically; enrichment (ONNX
	// vector + compromise KG) runs via the outbox worker (TASK-013).
	const { task } = storage.db
		.transaction(() => {
			const created = coreCreate(params, storage);
			enqueueTask(storage, created.task);
			return created;
		})
		.immediate();

	return createMcpResponse(
		{
			success: true,
			id: task.id,
			repo: task.repo,
			task_code: task.task_code,
			code: task.task_code,
			phase: task.phase,
			title: task.title,
			status: task.status,
			priority: task.priority,
			depends_on: task.depends_on
		},
		`Created [${task.task_code}] "${task.title}" in "${task.repo}" (phase: ${task.phase}, priority: ${task.priority}, status: ${task.status}).`,
		{ includeJson: params.json }
	);
}
