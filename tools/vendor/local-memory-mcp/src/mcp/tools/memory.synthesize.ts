import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import {
	SamplingCreateMessageResult,
	SamplingRequestHandler,
	SamplingMessage,
	SamplingToolDefinition,
	extractTextFromContent,
	extractToolUses
} from "../sampling";
import { SessionContext, inferRepoFromSession } from "../session";
import { ElicitationRequestHandler, extractAcceptedElicitationContent } from "../elicitation";
import { createMcpResponse, getPrimaryTextContent, McpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";
import { MemorySynthesizeSchema, MemoryReadSchema, TaskReadSchema } from "./schemas/index";
import { inputSchemaFromSchema } from "./schemas/json-schema";
import { normalizeRepo } from "../utils/normalize";
import { normalizeToolArguments } from "../utils/normalize-args";
import { inferReadMode } from "../utils/auto-infer";
import { handleMemoryRead } from "./memory.read";
import { handleTaskRead } from "./task-read";

type SynthesizeOptions = {
	session?: SessionContext;
	sampleMessage?: SamplingRequestHandler;
	elicit?: ElicitationRequestHandler;
};

// ── First-iteration snapshot reuse (OPT-FLOW-02) ─────────────────────────
// The recap + task snapshot are already fetched for the grounding context
// below. A model tool call on the FIRST iteration only reuses that cached
// text when it reproduces the snapshot query EXACTLY (same scope, offset 0,
// and limit EXACTLY equal to the seeded size — TASK-178; for tasks also the
// exact seeded status set). Undefined or non-matching limits fall through to
// a real query, because the handlers' per-mode defaults (recap/list = 5)
// would return FEWER rows than the seed, so serving the cache would not be
// byte-identical to the handler output. Serving the cache is byte-identical
// to the handler output for matching args (recap/list output depends only on
// owner/repo/limit/offset/status/phase).
const SEEDED_RECAP_LIMIT = 8;
const SEEDED_TASK_LIMIT = 15;
// The EXACT status string the task snapshot was seeded with (line 76). The
// handler's describeStatusFilter (task-read/shared.ts) preserves input order,
// so only a byte-identical status string may be served from cache (TASK-181).
const SEEDED_TASK_STATUS_STRING = "backlog,pending,in_progress,blocked";

type SeededSnapshot = {
	owner: string;
	repo: string;
	recapText: string;
	taskText: string;
};

export async function handleMemorySynthesize(
	params: unknown,
	db: SQLiteStore,
	vectors: VectorStore,
	options: SynthesizeOptions = {}
): Promise<McpResponse> {
	const validated = MemorySynthesizeSchema.parse(params);
	const session = options.session;

	if (!options.sampleMessage || !session?.supportsSampling) {
		throw new Error("Client does not advertise MCP sampling support");
	}

	const repo = await resolveRepository(validated.repo, session, options.elicit);
	if (!repo) {
		throw new Error("repo is required when repo cannot be inferred from active MCP roots");
	}

	const repoOwner = validated.owner;
	const recap = await handleMemoryRead({ owner: repoOwner, repo, limit: 8, offset: 0 }, db, vectors);
	const recapText = getPrimaryTextContent(recap);
	const summary = validated.include_summary ? db.summaries.getSummary(repoOwner, repo)?.summary : "";

	const taskSnapshot = validated.include_tasks
		? await handleTaskRead(
				{ owner: repoOwner, repo, status: "backlog,pending,in_progress,blocked", limit: 15, offset: 0 },
				db,
				vectors
			)
		: null;
	const taskText = taskSnapshot ? getPrimaryTextContent(taskSnapshot) : "";

	// Reuse the already-fetched recap/task snapshot as the first-iteration seed
	// (OPT-FLOW-02): the model can re-read it without re-querying the DB.
	const seededSnapshot: SeededSnapshot = { owner: repoOwner, repo, recapText, taskText };

	const systemPrompt = [
		"You are a repository memory synthesizer.",
		"Answer strictly from grounded MCP context and tool results.",
		"If memory is insufficient, say so explicitly instead of inventing details.",
		"Prefer concise, technical answers with explicit caveats when evidence is incomplete."
	].join(" ");

	const contextBlock = [
		`Repository: ${repo}`,
		validated.current_file_path ? `Current file: ${validated.current_file_path}` : "",
		summary ? `Summary:\n${summary}` : "",
		recapText ? `Recent context:\n${recapText}` : "",
		taskText ? `Active tasks:\n${taskText}` : ""
	]
		.filter(Boolean)
		.join("\n\n");

	const messages: SamplingMessage[] = [
		{
			role: "user",
			content: {
				type: "text",
				text: `Objective: ${validated.objective}\n\nGrounding context:\n${contextBlock || "No additional context provided."}`
			}
		}
	];

	const toolDefinitions = buildSamplingTools(session, validated.use_tools);
	let lastResponse: SamplingCreateMessageResult | null = null;
	let totalToolCalls = 0;
	let iterations = 0;

	while (iterations < validated.max_iterations) {
		iterations += 1;

		const response = await options.sampleMessage({
			messages,
			systemPrompt,
			maxTokens: validated.max_tokens,
			tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
			toolChoice:
				toolDefinitions.length > 0 ? { mode: iterations === validated.max_iterations ? "none" : "auto" } : undefined,
			modelPreferences: {
				intelligencePriority: 0.9,
				speedPriority: 0.4
			}
		});

		lastResponse = response;
		messages.push({
			role: "assistant",
			content: response.content
		});

		const toolUses = extractToolUses(response.content);
		if (toolUses.length === 0) {
			break;
		}

		totalToolCalls += toolUses.length;
		const toolResults = await Promise.all(
			toolUses.map(async (toolUse) => {
				// Normalize exactly like the transport does (tools/index.ts,
				// router.ts): session owner/repo/scope injection happens here so
				// sampling tool calls share the SAME auto-infer/scope behavior as
				// regular MCP tool calls (OPT-FLOW-02).
				const normalizedArgs = normalizeToolArguments(toolUse.input, session) as Record<string, unknown>;

				// First iteration: serve the already-fetched recap/task snapshot
				// instead of re-querying the DB when the model re-requests it.
				const seededText =
					iterations === 1 ? matchSeededSnapshot(toolUse.name, normalizedArgs, seededSnapshot) : undefined;

				return {
					type: "tool_result" as const,
					toolUseId: toolUse.id,
					content: [
						{
							type: "text" as const,
							text: seededText ?? (await executeSamplingTool(toolUse.name, normalizedArgs, db, vectors))
						}
					]
				};
			})
		);

		messages.push({
			role: "user",
			content: toolResults
		});
	}

	const answer = lastResponse ? extractTextFromContent(lastResponse.content).trim() : "";
	if (!answer) {
		throw new Error("Sampling did not return a final text answer");
	}

	logger.info("[Tool] memory.synthesize", {
		repo,
		objective: validated.objective,
		iterations,
		toolCalls: totalToolCalls
	});

	return createMcpResponse(
		{
			repo,
			objective: validated.objective,
			answer,
			model: lastResponse?.model,
			stopReason: lastResponse?.stopReason,
			iterations,
			toolCalls: totalToolCalls
		},
		`Synthesized answer for "${validated.objective}" in "${repo}" (${iterations} iterations, ${totalToolCalls} tool calls).`,
		{
			structuredContentPathHint: "answer",
			includeJson: true
		}
	);
}

async function resolveRepository(
	repo: string | undefined,
	session: SessionContext | undefined,
	elicit: ElicitationRequestHandler | undefined
) {
	if (repo) return normalizeRepo(repo);

	const inferredRepo = inferRepoFromSession(session);
	if (inferredRepo) return normalizeRepo(inferredRepo);

	if (!session?.supportsElicitationForm || !elicit) {
		return undefined;
	}

	const elicited = extractAcceptedElicitationContent(
		await elicit({
			mode: "form",
			message: "Repository tidak bisa diinfer dari roots aktif. Pilih repository yang ingin disintesis.",
			requestedSchema: {
				type: "object",
				properties: {
					repo: {
						type: "string",
						title: "Repository",
						description: "Nama repository yang akan dipakai untuk sintesis memori.",
						minLength: 1
					}
				},
				required: ["repo"]
			}
		})
	);

	return typeof elicited.repo === "string" && elicited.repo.trim() ? normalizeRepo(elicited.repo.trim()) : undefined;
}

function buildSamplingTools(session: SessionContext | undefined, useTools: boolean): SamplingToolDefinition[] {
	if (!useTools || !session?.supportsSamplingTools) {
		return [];
	}

	// Reuse the REGISTERED tool names + schemas (types/tool-definitions, wired
	// in tools/index.ts) so the model samples against the same contract the
	// transport advertises — no legacy aliases (memory_search, memory_recap,
	// task_list) that the transport would reject (OPT-FLOW-02). The inputSchema
	// is the same derived JSON Schema the MCP server registers, and read-mode
	// resolution flows through the handlers' own inferReadMode rules.
	return [
		{
			name: "memory-read",
			description:
				"Search local repository memories (query), fetch full memories (id/code/ids/codes), or recap the most recent memories (no query). Auto-infers mode: query→search, id/code/ids/codes→detail, none→recap.",
			inputSchema: inputSchemaFromSchema(MemoryReadSchema)
		},
		{
			name: "task-read",
			description:
				"Search tasks (query), fetch task details (id/code/task_code), or list tasks filtered by status/phase (no query). Auto-infers mode: query→search, id/code→detail, none→list.",
			inputSchema: inputSchemaFromSchema(TaskReadSchema)
		}
	];
}

/**
 * Executes a sampling tool call through the SAME normalized-args path as the
 * transport: args were already run through `normalizeToolArguments` (session
 * owner/repo/scope injection) by the caller, then dispatched to the canonical
 * read handlers. Any error throws and aborts the synthesize — identical error
 * semantics to the previous internal dispatch.
 */
async function executeSamplingTool(
	toolName: string,
	normalizedArgs: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<string> {
	switch (toolName) {
		case "memory-read": {
			const response = await handleMemoryRead(normalizedArgs, db, vectors);
			return getPrimaryTextContent(response);
		}

		case "task-read": {
			const response = await handleTaskRead(normalizedArgs, db, vectors);
			return getPrimaryTextContent(response);
		}

		default:
			throw new Error(`Unsupported sampling tool: ${toolName}`);
	}
}

/**
 * Returns the cached recap/task snapshot text when the first-iteration tool
 * call is an exact match for the already-fetched seed data, or `undefined` to
 * fall through to a real query. Read-mode inference mirrors the handlers
 * (memory.read.ts / task-read/index.ts) so classification never diverges from
 * what `handleMemoryRead`/`handleTaskRead` would do.
 */
function matchSeededSnapshot(
	toolName: string,
	normalized: Record<string, unknown>,
	seed: SeededSnapshot
): string | undefined {
	// Only serve the cached snapshot for the same repo/owner scope.
	if (normalized.repo !== seed.repo || normalized.owner !== seed.owner) {
		return undefined;
	}

	if (toolName === "memory-read") {
		// Recap mode — same rule as memory-read/index.ts: no non-empty
		// identifier / query. DETAIL precedes SEARCH and both use "non-empty"
		// presence so a serialize-all `query: ""` cannot hijack the mode.
		const mode = inferReadMode(normalized, {
			rules: [
				{ mode: "detail", fields: ["id", "code", "ids", "codes"], presence: "non-empty" },
				{ mode: "search", fields: ["query"], presence: "non-empty" }
			],
			fallback: "recap"
		});
		if (mode !== "recap" || !seed.recapText) return undefined;
		if ((normalized.offset ?? 0) !== 0) return undefined;
		// EXACT limit equality required (TASK-178): the handler's schema default
		// (5) would return fewer rows than the seeded 8, so a smaller or absent
		// limit must fall through to a real query (safe cache-miss direction).
		if (normalized.limit === undefined || Number(normalized.limit) !== SEEDED_RECAP_LIMIT) return undefined;
		return seed.recapText;
	}

	if (toolName === "task-read") {
		// List mode — mirrors task-read/index.ts, including the
		// code ← task_code / codes ← task_codes detail resolution.
		// DETAIL precedes SEARCH and both use "non-empty" presence so a
		// serialize-all `query: ""` cannot hijack the mode.
		const mode = inferReadMode(normalized, {
			rules: [
				{ mode: "detail", fields: ["id", "code", "ids", "codes", "task_code", "task_codes"], presence: "non-empty" },
				// issue_ref also enters SEARCH — mirrors task-read/index.ts so the
				// mirror's classification never diverges from the handler.
				{ mode: "search", fields: ["query", "issue_ref"], presence: "non-empty" }
			],
			fallback: "list"
		});
		if (mode !== "list" || !seed.taskText) return undefined;
		if ((normalized.offset ?? 0) !== 0) return undefined;
		// EXACT limit equality required (TASK-178): the handler's list-mode
		// default (5) would return fewer rows than the seeded 15, so a smaller
		// or absent limit must fall through to a real query (safe cache-miss).
		if (normalized.limit === undefined || Number(normalized.limit) !== SEEDED_TASK_LIMIT) return undefined;
		if (normalized.phase !== undefined) return undefined;
		// json:true makes the handler skip contentSummary (task-read/list.ts:60-61),
		// returning content=[] → getPrimaryTextContent "" — serving the seeded text
		// would NOT be byte-identical, so truthy json must fall through (TASK-181).
		// json undefined/false (schema default false) serves byte-identically.
		if (normalized.json !== undefined && normalized.json !== false) return undefined;
		// EXACT status string equality (TASK-181): describeStatusFilter preserves
		// input order, so a reordered status set would embed a different label
		// than the seed's canonical-order one — only the exact seed string serves.
		if (normalized.status !== SEEDED_TASK_STATUS_STRING) return undefined;
		return seed.taskText;
	}

	return undefined;
}
