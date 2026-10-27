/**
 * ── File naming convention in this directory (TASK-094) ───────────────────
 *
 * `src/mcp/tools/` intentionally mixes two naming styles:
 *
 *   1. Kebab-case subdirectories — the CANONICAL home for handler logic:
 *      memory-write/, standard-read/, standard-write/, task-read/,
 *      task-write/, kg-archivist/, schemas/. All NEW code and new imports
 *      must target these paths.
 *
 *   2. Dotted legacy files (memory.read.ts, task.read.ts, claim.manage.ts,
 *      standard.delete.ts, handoff.read.ts, codebase.read.ts, ...) — kept
 *      as-is, no mass rename. They are either thin backward-compat
 *      re-exporters for domains that were split into a kebab-case dir
 *      (memory.write → memory-write/, task.read → task-read/,
 *      standard.read → standard-read/, standard.write → standard-write/,
 *      task.write → task-write/) or the original single-file implementation
 *      for domains not yet split (memory.read, claim.manage, handoff.*,
 *      *.delete, memory.synthesize, ...).
 *
 * WHY the dotted files stay (DECISION: accept-and-document, no codemod):
 * their dotted names mirror the legacy dotted tool names (memory.read ↔
 * memory-read). The router normalizes tool names dots→hyphens
 * (router.ts: `String(name).replace(/\./g, "-")`) and existing tests and
 * imports reference these file paths directly, so a mass rename would break
 * the legacy tool-name→file mapping for zero functional gain.
 *
 * Migration path for future domain splits: move logic into a kebab-case
 * subdirectory and leave a thin re-exporter at the old dotted path — exactly
 * what memory.write → memory-write/ already does.
 */

import { performance } from "node:perf_hooks";
import { McpServer, CallToolResult, fromJsonSchema } from "@modelcontextprotocol/server";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { SessionContext } from "../session";
import { logger } from "../utils/logger";
import { metrics } from "../utils/metrics";
import { normalizeToolArguments } from "../utils/normalize-args";
import { SamplingRequestHandler } from "../sampling";
import { ElicitationRequestHandler } from "../elicitation";

// ── Handler imports ──────────────────────────────────────────────────────
import { handleMemoryWrite } from "./memory-write";
import { handleMemorySummarize } from "./memory.summarize";
import { handleMemorySynthesize } from "./memory.synthesize";
import { handleMemoryDelete } from "./memory.delete";
import { handleMemoryRead } from "./memory.read";
import { handleHandoffWrite } from "./handoff.write";
import { handleHandoffRead } from "./handoff.read";
import { handleClaimManage } from "./claim.manage";
import { handleStandardDelete } from "./standard.delete";
import { handleStandardWrite } from "./standard-write";
import { handleStandardRead } from "./standard-read";
import { handleTaskWrite } from "./task-write";
import { handleTaskDelete } from "./task.delete";
import { handleTaskRead } from "./task-read";
import { handleAgentContext } from "./agent-context";
import { handleCodebaseIndex } from "./codebase-index-sdk";
import { handleCodebaseRead } from "./codebase.read";
import { handleExplorationObservationWrite } from "./exploration-observation.write";
import { handleExplorationObservationRead } from "./exploration-observation.read";
import { handlePromptRead } from "./prompt.read";
import { McpResponse } from "../utils/mcp-response";
import { toErrorResponse } from "../utils/mcp-error";
import { logToolAction } from "../utils/action-log";
import { collectAffectedResourceUris, WRITE_TOOLS } from "../utils/tool-plumbing";
import { getRuntimeCapabilities, isSemanticToolDemand } from "../runtime-capabilities";
import { reuseTelemetry } from "../utils/reuse-telemetry";

// ── Tool definitions ────────────────────────────────────────────────────
import { TOOL_DEFINITIONS } from "./tool-definitions";

// ── Types ────────────────────────────────────────────────────────────────

export type RegisterAllOptions = {
	/** Client sampling handler (required for memory-synthesize) */
	sampleMessage?: SamplingRequestHandler;
	/** Client elicitation handler (required for interactive task creation via task-write) */
	elicit?: ElicitationRequestHandler;
	/** Called after write tools with the set of affected resource URIs */
	onResourcesMutated?: (uris: string[]) => void;
};

// ── Write-lock + resource-mutation plumbing ──────────────────────────────
// WRITE_TOOLS and collectAffectedResourceUris live in utils/tool-plumbing.ts
// (shared with the router.ts adapter) — single source of truth.

// ── Action logging ───────────────────────────────────────────────────────
// The action-log gate + metadata derivation live in ONE place:
// logToolAction (utils/action-log.ts) reads `result.structuredContent` — the
// field McpResponse actually exposes (mcp-response.ts) — so memoryId /
// taskId / resultCount are populated on the SDK path. Only MUTATING tools
// emit a row (ACTION_LOG_TOOLS in utils/tool-plumbing.ts, OPT-PERF-05); reads
// perform no action_log write. logAction enforces the no-file-lock policy and
// never throws (see utils/action-log.ts header).

// ── Response conversion (McpResponse → CallToolResult) ──────────────────

function toCallToolResult(response: McpResponse): CallToolResult {
	const content = Array.isArray(response.content)
		? response.content.map((item) => {
				if (item.type === "image") {
					return { type: "image" as const, data: item.data, mimeType: item.mimeType };
				}
				if (item.type === "resource") {
					return {
						type: "text" as const,
						text: item.resource.text ?? JSON.stringify(item.resource)
					};
				}
				return { type: "text" as const, text: (item as { text?: string }).text ?? "" };
			})
		: [];
	return {
		content,
		isError: response.isError ?? false,
		...(response.structuredContent !== undefined ? { structuredContent: response.structuredContent } : {})
	};
}

// ── Executor extra context (progress / cancellation) ────────────────────

export type ExecutorExtra = {
	onProgress?: (progress: number, total?: number) => void;
	signal?: AbortSignal;
};

// ── Tool executor dispatch ───────────────────────────────────────────────

export function buildExecutors(
	session: SessionContext,
	options?: RegisterAllOptions
): Record<
	string,
	(args: Record<string, unknown>, db: SQLiteStore, vectors: VectorStore, extra?: ExecutorExtra) => Promise<McpResponse>
> {
	const sampleMessage = options?.sampleMessage;
	const elicit = options?.elicit;

	return {
		// New canonical handlers
		"memory-write": (args, db, vectors, _extra) => handleMemoryWrite(args, db, vectors),
		"memory-read": (args, db, vectors, _extra) => handleMemoryRead(args, db, vectors),
		"memory-delete": (args, db, vectors, extra) => handleMemoryDelete(args, db, vectors, extra?.onProgress),
		// New canonical names per ADR-001
		synthesize: (args, db, vectors, _extra) =>
			handleMemorySynthesize(args, db, vectors, {
				session,
				sampleMessage,
				elicit
			}),
		"repo-summarize": (args, db, _vectors, _extra) => handleMemorySummarize(args, db),
		// New canonical handlers
		"handoff-write": (args, db, _vectors, _extra) => handleHandoffWrite(args, db),
		"handoff-read": (args, db, _vectors, _extra) => handleHandoffRead(args, db),
		"claim-manage": (args, db, _vectors, _extra) => handleClaimManage(args, db),
		// New canonical handlers
		"standard-write": (args, db, vectors, _extra) => handleStandardWrite(args, db, vectors),
		"standard-read": (args, db, vectors, _extra) => handleStandardRead(args, db, vectors),
		"standard-delete": (args, db, vectors, _extra) => handleStandardDelete(args, db, vectors),
		// New canonical handlers
		"task-write": (args, db, vectors, _extra) =>
			handleTaskWrite(args, db, vectors, { session, elicit: options?.elicit }),
		"task-read": (args, db, vectors, _extra) => handleTaskRead(args, db, vectors),
		"task-delete": (args, db, _vectors, _extra) => handleTaskDelete(args, db),

		"agent-context": (args, db, vectors, _extra) =>
			handleAgentContext(session.sessionId ? { ...args, session_id: session.sessionId } : args, db, vectors),
		"observation-write": (args, db, _vectors, _extra) => handleExplorationObservationWrite(args, db),
		"observation-read": (args, db, _vectors, _extra) => handleExplorationObservationRead(args, db),
		"prompt-read": async (args, _db, _vectors, _extra) => handlePromptRead(args, session),
		// Codebase index tools — only 2 canonical names
		"codebase-index": (args, db, _vectors, _extra) => handleCodebaseIndex(args, db, _vectors),
		"codebase-read": (args, db, _vectors, _extra) => handleCodebaseRead(args, db, _vectors)
	};
}

// ── Main registration function ───────────────────────────────────────────

export function registerAllTools(
	server: McpServer,
	store: SQLiteStore,
	vectors: VectorStore,
	session: SessionContext,
	options?: RegisterAllOptions
): void {
	const executors = buildExecutors(session, options);

	// Filter tool definitions by client capabilities
	const definitions = TOOL_DEFINITIONS.filter((def) => {
		if (def.name === "synthesize" && !session.supportsSampling) {
			return false;
		}
		return true;
	});

	for (const def of definitions) {
		const toolName = def.name;
		const executor = executors[toolName];

		if (!executor) {
			logger.warn(`[registerAllTools] No executor for tool: ${toolName} — skipping`);
			continue;
		}

		const isWrite = WRITE_TOOLS.has(toolName);

		server.registerTool(
			toolName,
			{
				description: def.description ?? "",
				inputSchema: def.inputSchema ? fromJsonSchema(def.inputSchema as never) : undefined
			},
			async (args, extra) => {
				const rawArgs = (args ?? {}) as Record<string, unknown>;
				// The canonical tool name is threaded into normalization so a WRITE
				// tool can fail loud when its scope is undeterminable (TASK-420).
				const normalizedArgs = normalizeToolArguments(rawArgs, session, { toolName }) as Record<string, unknown>;
				// Dispatch instrumentation (OPT-OBS-01): measure the full tool
				// call with performance.now() so slow tools are visible in logs
				// AND the in-process metrics registry (p50/p95 per tool).
				const toolStartMs = performance.now();

				logger.info(`[Tool] ${toolName}`, {
					repo: (normalizedArgs?.repo as string) || "unknown",
					write: isWrite
				});

				// Build progress callback from the SDK's ServerContext
				const progressToken = extra?.mcpReq?._meta?.progressToken;
				const executorExtra: ExecutorExtra = {
					onProgress:
						progressToken !== undefined
							? (progress: number, total?: number) => {
									void extra.mcpReq
										.notify({
											method: "notifications/progress",
											params: { progressToken, progress, total }
										})
										.catch(() => {});
								}
							: undefined,
					signal: extra?.mcpReq?.signal
				};

				// Trigger lazy semantic startup only for calls that can use it. The
				// capability-aware vector store still degrades to lexical results if
				// the profile disables semantic search or initialization fails.
				if (isSemanticToolDemand(toolName, normalizedArgs)) {
					void getRuntimeCapabilities().ensure("semantic");
				}

				// Execute tool logic under write lock if needed.
				//
				// Lock-scope invariant (TASK-064 / MEM-475): handlers MUST NOT
				// await expensive ONNX/async work while holding the lock. All
				// embeddings + KG enrichment run via the outbox worker
				// (TASK-013) — memory/task/standard handlers only enqueue sync
				// LWW jobs — so lock hold time stays at µs–ms DB work. The
				// memory-write conflict check is a synchronous TF-vector search
				// (memory.vector.checkConflicts), not ONNX. Do not reintroduce
				// awaited model inference inside write handlers.
				//
				// Write-handler duration timing (OPT-OBS-01 / TASK-161): wrapped
				// in its own try/finally so the duration is measured even if the
				// handler throws — a slow write handler is a queue-latency red
				// flag for every write tool.
				const executeFn = () => executor(normalizedArgs, store, vectors, executorExtra);

				let result: McpResponse;
				try {
					if (isWrite) {
						const writeStartMs = performance.now();
						try {
							result = await store.withWrite(executeFn);
						} finally {
							// Write-handler duration (TASK-161 / OPT-PERF-09): the
							// fast-path withWrite holds no file lock, so this
							// measures handler dispatch latency, not lock hold.
							metrics.recordWriteHandler(toolName, performance.now() - writeStartMs);
						}
					} else {
						result = await executeFn();
					}
				} catch (err) {
					// Canonical error envelope — shared with router.ts so both
					// transports surface identical shapes (OPT-CODE-01).
					// Instrumented on the error path too: a fast-failing tool
					// must still show up in per-tool latency stats.
					const errDurationMs = performance.now() - toolStartMs;
					metrics.recordTool(toolName, errDurationMs, "error");
					// Attribution scope (TASK-421): owner/repo/sessionId are added to
					// the error log data so bugCapture.logSink persists them into the
					// bug_reports.context JSON. Without these, captured tool failures
					// cannot be tied back to a client/project/session.
					logger.error(`[Tool] ${toolName} failed`, {
						error: String(err),
						durationMs: Math.round(errDurationMs * 100) / 100,
						owner: normalizedArgs.owner,
						repo: normalizedArgs.repo,
						sessionId: session.sessionId
					});
					const errorResponse = toErrorResponse(err);
					logToolAction(store, toolName, normalizedArgs, errorResponse, String(normalizedArgs.owner ?? ""));
					return toCallToolResult(errorResponse);
				}

				const durationMs = performance.now() - toolStartMs;
				const structured = result.structuredContent as { code?: unknown; degraded?: unknown } | undefined;
				const outcome = result.isError
					? structured?.code === "PARTIAL_FAILURE"
						? "partial"
						: "error"
					: structured?.degraded === true
						? "degraded"
						: "success";
				metrics.recordTool(toolName, durationMs, outcome);
				logger.info(`[Tool] ${toolName} result`, {
					repo: (normalizedArgs?.repo as string) || "unknown",
					durationMs: Math.round(durationMs * 100) / 100
				});

				// Action logging — one row per MUTATING tool call only
				// (OPT-PERF-05). Read tools skip the DB write entirely; the gate
				// lives in logToolAction (utils/action-log.ts) over
				// ACTION_LOG_TOOLS (utils/tool-plumbing.ts), shared with router.ts.
				logToolAction(store, toolName, normalizedArgs, result, String(normalizedArgs.owner ?? ""));
				reuseTelemetry.recordTool({
					owner: String(normalizedArgs.owner ?? ""),
					repo: String(normalizedArgs.repo ?? "unknown"),
					session: [session.sessionId, normalizedArgs.task_code ?? normalizedArgs.task_id ?? ""].join(":"),
					toolName,
					args: normalizedArgs,
					result
				});
				reuseTelemetry.flushIfNeeded(store);

				// Resource mutation notifications
				const affectedUris = collectAffectedResourceUris(toolName, normalizedArgs, result);
				if (affectedUris.length > 0) {
					options?.onResourcesMutated?.(affectedUris);
				}

				return toCallToolResult(result);
			}
		);

		logger.debug(`[registerAllTools] Registered tool: ${toolName}`);
	}
}
