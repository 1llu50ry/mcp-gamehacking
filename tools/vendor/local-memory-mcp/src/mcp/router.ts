// MCP protocol router — thin adapter over the SDK tool dispatch core.
//
// ⚠️ TEST-ADAPTER-ONLY (legacy transport) — TASK-098.
// Production uses the native SDK path only: server.ts → mcp-server.ts
// (serveStdio → createMcpServer), which registers tools/resources/prompts via
// tools/index.ts, resources/sdk-index.ts, prompts/sdk-index.ts. This router is
// a hand-rolled JSON-RPC transport kept ONLY as the test harness (router.test.ts
// + ~14 other test files call createRouter directly); it is not wired into any
// production entry point. Do not add new protocol surface here — extend the SDK
// registration paths instead.
//
// Production tool dispatch lives in tools/index.ts (registerAllTools →
// buildExecutors). This router keeps the MCP protocol envelope (tools/list,
// resources/*, prompts/*, completion/*, logging/*) for the upstream transport
// and delegates every tools/call to the SAME executor map, so there is exactly
// one dispatch core and one WRITE_TOOLS / collectAffectedResourceUris
// definition (utils/tool-plumbing.ts).
//
// Resources are served through the single shared implementation in
// resources/index.ts (listResources/listResourceTemplates/readResource); the
// SDK transport adapts those same functions in resources/sdk-index.ts.

import { listResources, listResourceTemplates, readResource } from "./resources";
import { SessionContext } from "./session";
import { logger } from "./utils/logger";
import { logToolAction } from "./utils/action-log";
import { getPrompt, listPrompts } from "./prompts/registry";
import { TOOL_DEFINITIONS } from "./tools/tool-definitions";
import { complete, type CompletionRequest } from "./completion";
import { normalizeToolArguments } from "./utils/normalize-args";
import { buildExecutors } from "./tools";
import { collectAffectedResourceUris, normalizePageLimit, WRITE_TOOLS } from "./utils/tool-plumbing";
import { toErrorResponse } from "./utils/mcp-error";
import { SQLiteStore } from "./storage/sqlite";
import { VectorStore } from "./types";
import { SamplingRequestHandler } from "./sampling";
import { ElicitationRequestHandler } from "./elicitation";
import { getLogLevel, LOG_LEVEL_VALUES, setLogLevel } from "./utils/logger";
import { getRuntimeCapabilities, isSemanticToolDemand } from "./runtime-capabilities";
import { decodeCursor, encodeCursor } from "./utils/pagination";
import { reuseTelemetry } from "./utils/reuse-telemetry";

type RouterOptions = {
	getSessionContext?: () => SessionContext;
	sampleMessage?: SamplingRequestHandler;
	elicit?: ElicitationRequestHandler;
	onResourcesMutated?: (uris: string[]) => void;
};

// Backward-compat tool names resolved to their canonical executor keys. The
// SDK registry (registerAllTools) only registers canonical names, so aliases
// must be resolved here before dispatch.
const TOOL_ALIASES: Record<string, string> = {
	"claim-release": "claim-manage",
	"task-update": "task-write"
};

export function createRouter(
	db: SQLiteStore,
	vectors: VectorStore,
	options?: RouterOptions
): (
	method: string,
	params: Record<string, unknown> | undefined,
	signal?: AbortSignal,
	onProgress?: (progress: number, total?: number) => void
) => Promise<unknown> {
	const getSessionContext = options?.getSessionContext;

	async function handleMethod(
		method: string,
		params: Record<string, unknown> | undefined,
		signal?: AbortSignal,
		onProgress?: (progress: number, total?: number) => void
	): Promise<unknown> {
		const t0 = Date.now();
		try {
			const result = await _dispatch(method, params, signal, onProgress);
			logger.debug(`[Router] ${method}`, { ms: Date.now() - t0 });
			return result;
		} catch (err) {
			logger.error(`[Router] ${method} failed`, { ms: Date.now() - t0, error: String(err) });
			throw err;
		}
	}

	async function _dispatch(
		method: string,
		params: Record<string, unknown> | undefined,
		signal?: AbortSignal,
		onProgress?: (progress: number, total?: number) => void
	): Promise<unknown> {
		switch (method) {
			// ---- tools ----
			case "tools/list":
				return listTools(getSessionContext?.(), params);

			case "tools/call":
				return await handleToolCall(
					params,
					(params as Record<string, unknown>)?.signal as AbortSignal | undefined,
					onProgress
				);

			// ---- resources ----
			case "resources/list":
				return listResources(getSessionContext?.(), params);

			case "resources/templates/list":
				return listResourceTemplates(params);

			case "resources/read": {
				const result = readResource(params?.uri as string, db, getSessionContext?.()) as Record<string, unknown>;
				// Map MCP protocol `contents` to `content` for consistency
				if (result && Array.isArray(result.contents) && !result.content) {
					result.content = result.contents;
				}
				return result;
			}

			// ---- prompts ----
			case "prompts/list":
				return listPrompts(db, getSessionContext?.(), params);

			case "logging/setLevel": {
				const requestedLevel = typeof params?.level === "string" ? params.level : "";
				const previousLevel = getLogLevel();
				const level = setLogLevel(requestedLevel);
				return {
					level,
					supportedLevels: LOG_LEVEL_VALUES,
					previousLevel
				};
			}

			case "prompts/get": {
				return getPrompt(
					params?.name as string,
					(params?.arguments as Record<string, string>) || {},
					db,
					getSessionContext?.()
				);
			}

			case "completion/complete":
				return complete(params as CompletionRequest, db, getSessionContext?.());

			default:
				throw new Error(`Unsupported method: ${method}`);
		}
	}

	async function handleToolCall(
		params: Record<string, unknown> | undefined,
		signal?: AbortSignal,
		onProgress?: (progress: number, total?: number) => void
	): Promise<unknown> {
		const { name } = params || {};
		// Normalize tool naming: accept both dot (memory.store) and hyphen (memory-store)
		const rawName = String(name).replace(/\./g, "-");
		const toolName = TOOL_ALIASES[rawName] ?? rawName;
		// The resolved canonical tool name is threaded into normalization so a
		// WRITE tool can fail loud when its scope is undeterminable (TASK-420).
		const args = normalizeToolArguments(params?.arguments, getSessionContext?.(), { toolName }) as Record<
			string,
			unknown
		>;

		// Single dispatch core shared with the production SDK path
		// (registerAllTools). Session is resolved per call to preserve the
		// dynamic getSessionContext semantics of the upstream transport.
		const executors = buildExecutors(getSessionContext?.() as SessionContext, {
			sampleMessage: options?.sampleMessage,
			elicit: options?.elicit
		});
		const executor = executors[toolName];
		if (!executor) {
			throw new Error(`Unknown tool: ${name}`);
		}

		const repo = (args?.repo as string) || ((args?.scope as Record<string, unknown>)?.repo as string) || "unknown";
		const owner = (args?.owner as string) || ((args?.scope as Record<string, unknown>)?.owner as string) || undefined;
		const isWrite = WRITE_TOOLS.has(toolName);

		logger.info(`[Tool] ${toolName}`, { repo, write: isWrite });

		// Same lazy semantic trigger as the SDK path so both transports share
		// one capability lifecycle.
		if (isSemanticToolDemand(toolName, args)) {
			void getRuntimeCapabilities().ensure("semantic");
		}

		let result: unknown;
		try {
			// Lock-scope invariant (TASK-064 / MEM-475): write handlers must not
			// await ONNX/async work under the lock — embeddings + KG enrichment run
			// via the outbox worker (TASK-013); the memory conflict check is a sync
			// TF-vector search. Lock hold time = DB work only.
			const executeToolLogic = () => executor(args, db, vectors, { onProgress, signal });

			if (isWrite) {
				result = await db.withWrite(executeToolLogic);
			} else {
				result = await executeToolLogic();
			}
		} catch (err) {
			// Convert a thrown handler error into the SAME canonical envelope the
			// native SDK transport produces (tools/index.ts) — OPT-CODE-01. This
			// eliminates the legacy "log + rethrow raw exception" divergence so
			// both transports surface identical shapes for the same failure class.
			// Attribution scope (TASK-421): owner/repo/sessionId are included so
			// bugCapture.logSink persists them into the bug_reports context.
			logger.error(`[Tool] ${toolName} failed`, {
				repo,
				owner,
				sessionId: getSessionContext?.()?.sessionId,
				error: String(err)
			});
			const errorResponse = toErrorResponse(err);
			logToolAction(db, toolName, args, errorResponse, String(args.owner ?? ""));
			return errorResponse;
		}

		// Log only { repo } — never the full result payload, so memory/task
		// content never leaks into logs at info level.
		logger.info(`[Tool] ${toolName} result`, { repo });

		try {
			// Shared with the SDK path: logToolAction gates on ACTION_LOG_TOOLS
			// (OPT-PERF-05) — read tools emit no action_log write — then derives
			// metadata from result.structuredContent and logs under the
			// no-file-lock policy.
			logToolAction(db, toolName, args, result, String(args.owner ?? ""));
			const session = getSessionContext?.();
			reuseTelemetry.recordTool({
				owner: String(args.owner ?? ""),
				repo: String(args.repo ?? "unknown"),
				session: [session?.sessionId, args.task_code ?? args.task_id ?? ""].join(":"),
				toolName,
				args,
				result
			});
			reuseTelemetry.flushIfNeeded(db);
		} catch (e) {
			logger.error("Failed to log action", { toolName, error: String(e) });
		}

		const affectedResources = collectAffectedResourceUris(toolName, args, result);
		if (affectedResources.length > 0) {
			options?.onResourcesMutated?.(affectedResources);
		}

		return result;
	}

	return handleMethod;
}

function listTools(session: SessionContext | undefined, params: Record<string, unknown> | undefined) {
	const tools = getAvailableToolDefinitions(session);
	const limit = normalizePageLimit(params?.limit, tools.length || 1);
	const start = decodeCursor(params?.cursor as string | undefined);

	// Strictly conform to MCP Tool spec: remove internal fields like outputSchema, annotations, title
	const compliantTools = tools.map((tool) => {
		const { name, description, inputSchema } = tool;
		return { name, description, inputSchema };
	});

	const page = compliantTools.slice(start, start + limit);
	const nextCursor = start + limit < tools.length ? encodeCursor(start + limit) : undefined;

	return {
		tools: page,
		nextCursor
	};
}

function getAvailableToolDefinitions(session?: SessionContext) {
	return TOOL_DEFINITIONS.filter((tool) => {
		if (tool.name === "synthesize" && !session?.supportsSampling) {
			return false;
		}

		return true;
	});
}
