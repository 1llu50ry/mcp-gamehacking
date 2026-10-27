import { SQLiteStore } from "../../storage/sqlite";
import { Task, TaskChild, TaskComment } from "../../types";
import { createMcpResponse, McpResponse, withEnvelope } from "../../utils/mcp-response";
import { UUID_REGEX } from "../../utils/uuid";
import { logger } from "../../utils/logger";
import { assertNotOrchestratorPlaceholder } from "../../utils/placeholder-code";
import { formatDisplayTimestamp } from "../../utils/display-time";
import { fetchTaskKgContext } from "../kg-archivist/query";

function buildTaskDetailLines(
	task: Task,
	comments: TaskComment[],
	children: TaskChild[],
	depended_by: TaskChild[]
): string[] {
	const lines: string[] = [
		`Task: ${task.title}`,
		`Code: ${task.task_code}`,
		`Repo: ${task.repo}`,
		`Status: ${task.status}`,
		`Priority: ${task.priority}`,
		`ID: ${task.id}`
	];

	if (task.phase) lines.push(`Phase: ${task.phase}`);
	if (task.parent_code) lines.push(`Parent: ${task.parent_code} (${task.parent_id || ""})`);
	if (task.depends_on_code) lines.push(`Depends On: ${task.depends_on_code} (${task.depends_on || ""})`);
	if (task.doc_path) lines.push(`Doc Path: ${task.doc_path}`);
	if (task.description) lines.push(`Description: ${task.description}`);
	if (task.tags && task.tags.length > 0) lines.push(`Tags: ${task.tags.join(", ")}`);
	if (task.suggested_skills && task.suggested_skills.length > 0)
		lines.push(`Suggested Skills: ${task.suggested_skills.join(", ")}`);
	if (task.est_tokens) lines.push(`Est Tokens: ${task.est_tokens}`);
	if (task.commit_id) lines.push(`Commit: ${task.commit_id}`);
	if (task.changed_files && task.changed_files.length > 0)
		lines.push(`Changed Files: ${task.changed_files.join(", ")}`);
	if (task.metadata) lines.push(`Metadata: ${JSON.stringify(task.metadata)}`);
	if (task.comments_count !== undefined) lines.push(`Comments: ${task.comments_count}`);
	if (task.coordination) {
		if (task.coordination.active_claim_count > 0) {
			lines.push(
				`Claim: ${task.coordination.active_claim_agent || "?"} (${task.coordination.active_claim_role || ""}) since ${task.coordination.active_claim_claimed_at || ""}`
			);
		}
		if (task.coordination.pending_handoff_count > 0) {
			lines.push(
				`Handoff: ${task.coordination.pending_handoff_summary || ""} → ${task.coordination.pending_handoff_to_agent || "?"}`
			);
		}
	}
	lines.push(`Created: ${formatDisplayTimestamp(task.created_at)}`);
	if (task.updated_at) lines.push(`Updated: ${formatDisplayTimestamp(task.updated_at)}`);
	if (task.in_progress_at) lines.push(`Started: ${formatDisplayTimestamp(task.in_progress_at)}`);
	if (task.finished_at) lines.push(`Finished: ${formatDisplayTimestamp(task.finished_at)}`);
	if (task.canceled_at) lines.push(`Canceled: ${formatDisplayTimestamp(task.canceled_at)}`);

	if (children.length > 0) {
		lines.push("", "--- Children ---");
		for (const c of children) {
			lines.push(`- ${c.task_code}: ${c.title} (${c.status})`);
		}
	}

	if (depended_by.length > 0) {
		lines.push("", "--- Depended By ---");
		for (const d of depended_by) {
			lines.push(`- ${d.task_code}: ${d.title} (${d.status})`);
		}
	}

	if (comments.length > 0) {
		lines.push("", "--- History ---");
		for (const c of comments) {
			const statusChange =
				c.previous_status || c.next_status ? ` [${c.previous_status || "?"} → ${c.next_status || "?"}]` : "";
			const agentInfo = c.agent ? ` (${c.agent})` : "";
			lines.push(`- ${formatDisplayTimestamp(c.created_at)}${statusChange}${agentInfo}: ${c.comment}`);
		}
	}

	return lines;
}

// ── DETAIL mode ───────────────────────────────────────────────────────────

export async function handleDetailMode(
	owner: string,
	repo: string,
	id: string | undefined,
	code: string | undefined,
	ids: string[] | undefined,
	codes: string[] | undefined,
	isJsonRequest: boolean,
	storage: SQLiteStore
): Promise<McpResponse> {
	// ── Single detail ──
	if (id || code) {
		const identifier = id || code!;
		// FIX-021: reject reserved orchestrator template placeholders (T01/R01/
		// Q01/…) with an actionable VALIDATION_ERROR before the not-found path.
		// A non-UUID `id` is treated as a code, so both slots are checked.
		assertNotOrchestratorPlaceholder(identifier);
		let task: Task | null;
		if (id) {
			task = UUID_REGEX.test(id) ? storage.tasks.getTaskById(id) : storage.tasks.getTaskByCode(owner, repo, id);
		} else {
			task = storage.tasks.getTaskByCode(owner, repo, code!);
		}

		if (!task) {
			throw new Error(`Task not found: ${identifier} (owner="${owner}", repo="${repo}")`);
		}

		// getTaskById / getTaskByCode already load comments (batched) — reuse them
		const comments = task.comments ?? [];
		const children = storage.tasks.getChildrenByParentId(task.id);
		const depended_by = storage.tasks.getDependedByTaskId(task.id);

		let contentSummary: string | undefined;
		{
			contentSummary = buildTaskDetailLines(task, comments, children, depended_by).join("\n");
		}

		// Best-effort KG context fetch based on task title + description.
		// Gated on the json flag (audit F3): only ships in structuredContent.
		const kgContext = isJsonRequest ? fetchTaskKgContext(storage, repo, task.title, task.description || "") : null;

		const data: Record<string, unknown> = {
			...task,
			comments,
			children,
			depended_by
		};
		if (kgContext) data.kg = kgContext;

		return createMcpResponse(withEnvelope("task-read/detail", "detail", data), contentSummary || "", {
			contentSummary,
			includeJson: isJsonRequest
		});
	}

	// ── Bulk detail ──
	let tasks: Task[] = [];
	if (ids) {
		tasks = storage.tasks.getTasksByIds(ids);
	} else if (codes) {
		// FIX-021: reject reserved orchestrator placeholders in a bulk code list
		// too, so `codes: ["T01"]` cannot fall through to a bare not-found.
		for (const c of codes) assertNotOrchestratorPlaceholder(c);
		tasks = storage.tasks.getTasksByCodes(owner, repo, codes);
	}

	if (tasks.length === 0) {
		throw new Error("No tasks found for the provided identifiers");
	}

	// Enrich each task with children + depended_by in O(2) batched queries
	// (comments already attached by getTasksByIds / getTasksByCodes).
	const taskIds = tasks.map((t) => t.id);
	const childrenByParent = storage.tasks.getChildrenByParentIds(taskIds);
	const dependedByTask = storage.tasks.getDependedByTaskIds(taskIds);
	const enriched = tasks.map((t) => ({
		...t,
		comments: t.comments ?? [],
		children: childrenByParent.get(t.id) ?? [],
		depended_by: dependedByTask.get(t.id) ?? []
	}));

	// Best-effort aggregated KG context from all task titles + descriptions
	// KG context is gated on the json flag (audit F3) — the resolve+relation
	// lookup is the dominant cost of the read and only ships in
	// structuredContent, so the combined title/description text is not even
	// built for a text-mode call.
	const kgContext = isJsonRequest
		? fetchTaskKgContext(
				storage,
				repo,
				enriched.map((t) => t.title).join(" "),
				enriched
					.map((t) => t.description || "")
					.filter(Boolean)
					.join(" ")
			)
		: null;

	let contentSummary: string | undefined;
	{
		const sections: string[] = [`${enriched.length} task details — repo "${repo}"`];
		for (const entry of enriched) {
			sections.push("");
			sections.push("━".repeat(50));
			const tLines = buildTaskDetailLines(entry, entry.comments || [], entry.children || [], entry.depended_by || []);
			sections.push(tLines.join("\n"));
		}
		sections.push("");
		sections.push("━".repeat(50));
		contentSummary = sections.join("\n");
	}

	logger.info("[Tool] task-read/detail", {
		repo,
		count: enriched.length,
		bulk: !(id || code)
	});

	const data: Record<string, unknown> = {
		schema: "task-read/detail" as const,
		mode: "detail" as const,
		count: enriched.length,
		tasks: enriched
	};
	if (kgContext) data.kg = kgContext;

	return createMcpResponse(data, contentSummary || `Found ${enriched.length} tasks.`, {
		contentSummary,
		includeJson: isJsonRequest
	});
}
