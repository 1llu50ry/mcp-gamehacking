/**
 * prompt-read — unified LIST / DETAIL access to the prompt catalog.
 *
 * The MCP server registers each Markdown prompt under `src/mcp/prompts/definitions/`
 * via the SDK (`prompts/list` + `prompts/get`) — some clients (notably
 * tool-only agents such as OpenCode) can only discover and invoke TOOLS, so
 * this tool mirrors that catalog as a first-class, read-only tool.
 *
 * Auto-infer logic:
 * - `name` present → DETAIL  (loadPromptFromMarkdown + {{var}} substitution)
 * - none           → LIST    (catalog: [{ name, description, agent, arguments }])
 *
 * Reuses the existing prompt loader (loader.ts cache + PROMPT_DIR resolution)
 * and the shared substitution helper (prompts/substitution.ts) also used by
 * sdk-index.ts / registry.ts getPrompt: user args are substituted first, then
 * {{current_repo}} and {{current_owner}} are always auto-injected from the
 * session context (never read from args).
 *
 * Read-only by design: no DB access, no write lock, no cache mutation —
 * both modes are pure function calls over the loader cache.
 */

import { inferOwnerFromSession, inferRepoFromSession, type SessionContext } from "../session";
import { listPromptFiles, loadPromptFromMarkdown } from "../prompts/loader";
import { substitutePromptArgs } from "../prompts/substitution";
import { createMcpResponse, type McpResponse } from "../utils/mcp-response";
import { parseArgs } from "../utils/mcp-error";
import type { LoadedPrompt } from "../interfaces";
import { PromptReadSchema, type PromptReadInput } from "./schemas/prompt-read";

/** Structural subset used by the text renderers (catalog + detail views). */
type PromptView = Pick<LoadedPrompt, "name" | "description" | "agent"> & {
	content?: string;
	arguments?: Record<string, unknown>[];
};

// ── Text rendering helpers ─────────────────────────────────────────────

/** Catalog bullet per prompt: name — description (+ agent when declared). */
function formatCatalogItem(loaded: PromptView): string {
	const agent = loaded.agent ? ` [${loaded.agent}]` : "";
	return `- ${loaded.name} — ${loaded.description}${agent}`;
}

/** Renders the substituted prompt body as the DETAIL text content. */
function renderPromptBody(loaded: PromptView): string {
	const lines = [`# ${loaded.name}`, ""];
	if (loaded.description) {
		lines.push(loaded.description, "");
	}
	lines.push(loaded.content ?? "");
	return lines.join("\n");
}

// ── Mode handlers ───────────────────────────────────────────────────────

/** Error thrown when a requested prompt name is not in the allowlist. */
function createPromptNotFoundError(name: string): Error {
	return new Error(`Prompt not found: ${name}`);
}

/**
 * LIST — full catalog of the prompt definitions directory (loader cache).
 * Respects the `json` flag so structuredContent is emitted on request
 * (consistent with DETAIL mode).
 */
function handleListMode(validated: PromptReadInput): McpResponse {
	const prompts = listPromptFiles()
		.map((name) => {
			try {
				return loadPromptFromMarkdown(name);
			} catch {
				return null;
			}
		})
		.filter((loaded): loaded is LoadedPrompt => loaded !== null)
		.map((loaded) => ({
			name: loaded.name,
			description: loaded.description,
			agent: loaded.agent,
			arguments: loaded.arguments
		}));

	const contentSummary =
		prompts.length > 0
			? [
					`### Prompts (${prompts.length})`,
					"",
					...prompts.map((p) => formatCatalogItem(p)),
					"",
					"Use prompt-read with name for full content."
				].join("\n")
			: "No prompts found.";

	const data = {
		schema: "prompt-read" as const,
		mode: "list" as const,
		prompts,
		count: prompts.length
	};

	return createMcpResponse(data, contentSummary, { contentSummary, includeJson: validated.json });
}

/**
 * DETAIL — load one prompt and substitute {{var}} placeholders.
 * The trimmed name is validated against the loader allowlist before any file
 * access, so a traversal name can never reach the filesystem. Unknown names
 * throw a NOT_FOUND-classified error at the transport.
 */
function handleDetailMode(validated: PromptReadInput, session?: SessionContext): McpResponse {
	const name = validated.name as string;
	const trimmed = name.trim();
	const allowed = new Set(listPromptFiles());
	if (!allowed.has(trimmed)) {
		throw createPromptNotFoundError(trimmed);
	}

	const loaded = loadPromptFromMarkdown(trimmed);
	const text = substitutePromptArgs(loaded.content, validated.args, {
		owner: inferOwnerFromSession(session) || "unknown-owner",
		repo: inferRepoFromSession(session) || "unknown-repo"
	});

	const detail = {
		name: loaded.name,
		description: loaded.description,
		agent: loaded.agent,
		content: text
	};

	const data = {
		schema: "prompt-read" as const,
		mode: "detail" as const,
		prompt: detail
	};

	return createMcpResponse(data, renderPromptBody(detail), {
		contentSummary: text,
		includeJson: validated.json
	});
}

// ── Main entry point ────────────────────────────────────────────────────

/**
 * Unified prompt-read handler.
 *
 * Auto-infer logic:
 * - `name` present → DETAIL  (single prompt with substitution)
 * - none           → LIST    (catalog)
 *
 * Read-only — no DB mutation and no write lock on either path.
 */
export function handlePromptRead(params: Record<string, unknown>, session?: SessionContext): McpResponse {
	const validated = parseArgs(PromptReadSchema, params);

	if (validated.name) {
		return handleDetailMode(validated, session);
	}
	return handleListMode(validated);
}
