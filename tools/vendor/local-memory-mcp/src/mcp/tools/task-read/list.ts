import { SQLiteStore } from "../../storage/sqlite";
import { Task, TASK_STATUSES } from "../../types";
import { buildTableResult, createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { formatDisplayTimestamp } from "../../utils/display-time";
import { logger } from "../../utils/logger";
import { fetchAggregatedTaskKgContext } from "../kg-archivist/query";
import { capitalize, describeStatusFilter } from "./shared";

// ── LIST mode ─────────────────────────────────────────────────────────────

export async function handleListMode(
	owner: string,
	repo: string,
	status: string | undefined,
	phase: string | undefined,
	limit: number,
	offset: number,
	isJsonRequest: boolean,
	storage: SQLiteStore
): Promise<McpResponse> {
	// Default status filter matches existing task-list behaviour
	const effectiveStatus = status ?? "backlog,in_progress";

	let statuses: string[] = [];
	if (effectiveStatus !== "all") {
		statuses = effectiveStatus
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	}

	const tasks = storage.tasks.getTasksByMultipleStatuses(owner, repo, statuses, limit, offset);
	const filteredTasks = phase
		? tasks.filter((t: Task) => t.phase && t.phase.toLowerCase() === phase.toLowerCase())
		: tasks;

	const COLUMNS = ["id", "task_code", "title", "status", "priority", "updated_at", "comments_count"] as const;
	const rows = filteredTasks.map((t: Task & { comments_count?: number }) => [
		t.id,
		t.task_code,
		t.title,
		t.status,
		t.priority,
		formatDisplayTimestamp(t.updated_at),
		t.comments_count || 0
	]);

	const structuredData = buildTableResult(COLUMNS, rows, {
		schema: "task-read/list",
		mode: "list",
		key: "tasks",
		count: rows.length,
		offset
	});

	// Best-effort KG context (REFACTOR-KG-004) — gated on the json flag
	// (audit F3): `kg` lives on `structuredData`, which `createMcpResponse`
	// only emits when `includeJson` is true, so a text-mode read was paying
	// the full KG lookup and throwing the result away.
	if (isJsonRequest && filteredTasks.length > 0) {
		const kgData = fetchAggregatedTaskKgContext(storage, repo, filteredTasks);
		if (kgData) structuredData.kg = kgData;
	}

	let contentSummary: string | undefined;
	{
		const statusLabel = describeStatusFilter(effectiveStatus);
		const taskLabel = rows.length === 1 ? "task" : "tasks";

		const parts: string[] = [];

		// Group by status for display
		const tasksByStatus: Record<string, Task[]> = {};
		for (const t of filteredTasks) {
			const statusLabel = t.status === "in_progress" ? "In Progress" : capitalize(t.status);
			if (!tasksByStatus[statusLabel]) {
				tasksByStatus[statusLabel] = [];
			}
			tasksByStatus[statusLabel].push(t);
		}

		if (Object.keys(tasksByStatus).length > 0) {
			const statusBreakdown = Object.entries(tasksByStatus)
				.map(([sts, items]) => `${sts.toLowerCase()}: ${items.length}`)
				.join(" · ");
			parts.push(`### Results: ${rows.length} tasks in repo "${repo}"`);
			parts.push(statusBreakdown);
			parts.push("");

			// Sort groups by status enum order, unknowns last
			const STATUS_ORDER = [...TASK_STATUSES];
			const sortedEntries = Object.entries(tasksByStatus).sort(([, itemsA], [, itemsB]) => {
				const ai = STATUS_ORDER.indexOf(itemsA[0]?.status ?? "");
				const bi = STATUS_ORDER.indexOf(itemsB[0]?.status ?? "");
				if (ai === -1 && bi === -1) return (itemsA[0]?.status ?? "").localeCompare(itemsB[0]?.status ?? "");
				if (ai === -1) return 1;
				if (bi === -1) return -1;
				return ai - bi;
			});

			for (const [statusLabel, items] of sortedEntries) {
				parts.push(`**${statusLabel} (${items.length})**`);
				for (const t of items) {
					const phasePart = t.phase ? ` [${t.phase}]` : "";
					parts.push(`- ${t.task_code} [P${t.priority}]${phasePart} ${t.title}`);
				}
				parts.push("");
			}
		} else {
			parts.push(`Found ${rows.length} ${statusLabel} ${taskLabel} in repo "${repo}".`);
		}

		if (phase) {
			parts.push("");
			parts.push(`Phase filter: ${phase}.`);
		}

		if (rows.length > 0) {
			parts.push("");
			parts.push("See task-detail with task_code for details.");
		}

		contentSummary = parts.join("\n").trim();
	}

	logger.info("[Tool] task-read/list", {
		repo,
		status: effectiveStatus,
		phase,
		count: rows.length,
		offset
	});

	return createMcpResponse(structuredData, contentSummary || "", {
		contentSummary,
		includeJson: isJsonRequest
	});
}
