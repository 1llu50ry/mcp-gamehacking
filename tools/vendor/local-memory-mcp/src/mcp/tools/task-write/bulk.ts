import { SQLiteStore } from "../../storage/sqlite";
import { TaskStatus, VectorStore, TASK_STATUS_BACKLOG } from "../../types";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { createMcpErrorResponse } from "../../utils/mcp-error";
import { extractAcceptedElicitationContent } from "../../elicitation";
import { handleCreateSingle } from "./create";
import { executeBulkOperation } from "./bulk-executor";
import { TaskWriteOptions, TaskWriteParams } from "./types";

// ---------------------------------------------------------------------------
// Re-exports for public API
// ---------------------------------------------------------------------------

export { inferItemMode } from "./bulk-infer";

// ---------------------------------------------------------------------------
// Interactive (Elicitation) — build schema
// ---------------------------------------------------------------------------

function addRequiredStringField(
	properties: Record<string, unknown>,
	required: string[],
	task: Record<string, unknown>,
	field: string,
	schema: Record<string, unknown>
) {
	if (typeof task[field] === "string" && (task[field] as string).trim()) {
		return;
	}
	properties[field] = {
		type: "string",
		...schema
	};
	required.push(field);
}

function buildMissingTaskSchema(task: Record<string, unknown>) {
	const properties: Record<string, unknown> = {};
	const required: string[] = [];

	addRequiredStringField(properties, required, task, "repo", {
		title: "Repository",
		description: "Name of the repository for this task.",
		minLength: 1
	});
	addRequiredStringField(properties, required, task, "phase", {
		title: "Phase",
		description: "Project phase or milestone for this task.",
		minLength: 1
	});
	addRequiredStringField(properties, required, task, "title", {
		title: "Title",
		description: "Short task title.",
		minLength: 3,
		maxLength: 100
	});
	addRequiredStringField(properties, required, task, "description", {
		title: "Description",
		description:
			"Detailed description. MUST follow format: 1. Context & Analysis, 2. Step & Implementation, 3. Acceptance & Verification",
		minLength: 1
	});

	if (!task.status) {
		properties.status = {
			type: "string",
			title: "Status",
			description: "Initial task status.",
			enum: ["backlog", "pending"],
			default: "backlog"
		};
	}

	if (task.priority === undefined) {
		properties.priority = {
			type: "integer",
			title: "Priority",
			description: "Task priority from 1 to 5.",
			minimum: 1,
			maximum: 5,
			default: 3
		};
	}

	return {
		type: "object" as const,
		properties,
		required
	};
}

export async function handleInteractive(
	params: TaskWriteParams,
	storage: SQLiteStore,
	vectors: VectorStore,
	options: TaskWriteOptions
): Promise<McpResponse> {
	if (!options.session?.supportsElicitationForm || !options.elicit) {
		throw new Error(
			"Client does not advertise MCP elicitation form support. Provide all required fields directly: phase, title, description."
		);
	}

	const draft: Record<string, unknown> = {
		...(params as unknown as Record<string, unknown>),
		repo: params.repo || options.session?.repo || ""
	};

	const requestedSchema = buildMissingTaskSchema(draft);
	let completedDraft = draft;

	if (Object.keys(requestedSchema.properties).length > 0) {
		const elicited = extractAcceptedElicitationContent(
			await options.elicit({
				mode: "form",
				message: "Please complete the missing task details to create a new task.",
				requestedSchema
			})
		);

		completedDraft = {
			...draft,
			...elicited
		};
	}

	// Now proceed with create using completed data
	const createParams: TaskWriteParams = {
		...params,
		owner: params.owner || (completedDraft.owner as string) || "",
		repo: params.repo || (completedDraft.repo as string) || "",
		phase: completedDraft.phase as string,
		title: completedDraft.title as string,
		description: completedDraft.description as string,
		status: (completedDraft.status as TaskStatus) || TASK_STATUS_BACKLOG,
		priority: (completedDraft.priority as number) || 3,
		json: true
	};

	return handleCreateSingle(createParams, storage, vectors);
}

// ---------------------------------------------------------------------------
// BULK — thin orchestrator
// ---------------------------------------------------------------------------

export async function handleBulk(
	params: TaskWriteParams,
	storage: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const items = params.tasks ?? [];
	const owner = params.owner;
	const repo = params.repo;

	// FEAT-007: the explicit owner move is single-task only and is NOT part of
	// TaskWriteItemSchema (bulk items can never carry new_owner). Reject a
	// top-level new_owner on a tasks[] request rather than silently ignoring it.
	if (params.new_owner !== undefined) {
		throw new Error(
			"Invalid new_owner for bulk update: an owner move is single-task only. " +
				'Retry with task-write(id: "<uuid>" or code: "<CODE>", new_owner: "<owner>") for one task at a time.'
		);
	}

	const { results, allOk } = await executeBulkOperation(items, owner, repo, storage, vectors);

	const succeeded = results.filter((r) => r.success);
	const failed = results.filter((r) => !r.success);

	if (!allOk) {
		if (items.length === failed.length) {
			// All items failed — throw the first error for clear signal
			throw new Error(failed[0].error as string);
		}
		// Partial failure — return error response with results
		const message = `Processed ${succeeded.length}/${items.length} in "${repo}" (${failed.length} failed). Errors: ${failed.map((r) => `[${r.index}] ${r.error}`).join("; ")}`;
		return createMcpErrorResponse({
			code: "PARTIAL_FAILURE",
			message,
			retryable: false,
			data: {
				success: false,
				repo,
				total: items.length,
				createdCount: succeeded.length,
				errors: failed.map((r) => ({ index: r.index, error: r.error })),
				results: results.map((r) => {
					const res: Record<string, unknown> = { index: r.index, operation: r.operation, success: r.success };
					if (r.id) res.id = r.id;
					if (r.code) res.code = r.code;
					if (r.title) res.title = r.title;
					if (r.error) res.error = r.error;
					if (r.updatedFields) res.updatedFields = r.updatedFields;
					return res;
				})
			}
		});
	}

	// Build summary text matching test expectations
	const createCount = results.filter((r) => r.operation === "create" && r.success).length;
	const updateCount = results.filter((r) => r.operation === "update" && r.success).length;
	let summaryText: string;
	if (updateCount === 0) {
		const createdCodes = results
			.filter((r) => r.operation === "create" && r.success && r.code)
			.map((r) => `[${r.code}]`)
			.join(", ");
		summaryText = `Created ${createCount} ${createCount === 1 ? "task" : "tasks"} in "${repo}": ${createdCodes}.`;
	} else if (createCount === 0) {
		const codes = results
			.filter((r) => r.operation === "update" && r.success && r.code)
			.map((r) => r.code)
			.join(", ");
		summaryText = `Updated ${updateCount} ${updateCount === 1 ? "task" : "tasks"} in "${repo}": ${codes}.`;
	} else {
		const createCodes = results
			.filter((r) => r.operation === "create" && r.success && r.code)
			.map((r) => r.code)
			.join(", ");
		const updateCodes = results
			.filter((r) => r.operation === "update" && r.success && r.code)
			.map((r) => r.code)
			.join(", ");
		summaryText = `Processed ${items.length} in "${repo}" — create: ${createCodes}; update: ${updateCodes}.`;
	}

	return createMcpResponse(
		{
			success: true,
			repo,
			total: items.length,
			createdCount: succeeded.length,
			results: results.map((r) => {
				const res: Record<string, unknown> = { index: r.index, operation: r.operation, success: r.success };
				if (r.id) res.id = r.id;
				if (r.code) res.code = r.code;
				if (r.title) res.title = r.title;
				if (r.error) res.error = r.error;
				if (r.updatedFields) res.updatedFields = r.updatedFields;
				return res;
			})
		},
		summaryText,
		{ includeJson: params.json }
	);
}
