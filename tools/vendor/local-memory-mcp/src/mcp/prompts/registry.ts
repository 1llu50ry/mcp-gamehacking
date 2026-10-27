import { SQLiteStore } from "../storage/sqlite";
import { SessionContext, inferOwnerFromSession, inferRepoFromSession } from "../session";
import { rankCompletionValues } from "../utils/completion";
import { loadPromptFromMarkdown, listPromptFiles } from "./loader";
import { substitutePromptArgs } from "./substitution";
import type { LoadedPrompt } from "../interfaces";
import { logger } from "../utils/logger";
import { decodeCursor, encodeCursor } from "../utils/pagination";

interface PromptMessage {
	role: "user" | "assistant";
	content: {
		type: "text";
		text: string;
	};
}

interface PromptDefinition {
	name: string;
	description: string;
	arguments: Record<string, unknown>[];
	agent?: string;
	messages: PromptMessage[];
}

function createPromptDefinition(loaded: LoadedPrompt): PromptDefinition {
	return {
		name: loaded.name,
		description: loaded.description,
		arguments: loaded.arguments,
		agent: loaded.agent,
		messages: [
			{
				role: "user",
				content: {
					type: "text",
					text: loaded.content
				}
			}
		]
	};
}

export const PROMPTS: Record<string, PromptDefinition> = {};

// Dynamically discover and load all prompts from the definitions directory
const promptFiles = listPromptFiles();
for (const name of promptFiles) {
	try {
		PROMPTS[name] = createPromptDefinition(loadPromptFromMarkdown(name));
	} catch (e) {
		logger.warn(`Failed to load prompt ${name}: ${e}`);
	}
}

/**
 * Handles MCP 'prompts/list'
 */
export async function listPrompts(
	db: SQLiteStore,
	session?: SessionContext,
	params?: { cursor?: string; limit?: number }
) {
	const allPrompts = Object.values(PROMPTS).map((p) => ({
		name: p.name,
		description: p.description,
		arguments: p.arguments,
		metadata: p.agent ? { agent: p.agent } : undefined
	}));

	const rawLimit = typeof params?.limit === "number" && Number.isInteger(params?.limit) ? params.limit : 50;
	const limit = Math.max(1, Math.min(100, Math.trunc(rawLimit)));
	const offset = decodeCursor(params?.cursor);
	const sliced = allPrompts.slice(offset, offset + limit);
	const nextOffset = offset + sliced.length;

	return {
		prompts: sliced,
		nextCursor: nextOffset < allPrompts.length ? encodeCursor(nextOffset) : undefined
	};
}

/**
 * Handles MCP 'prompts/get'
 */
export async function getPrompt(
	name: string,
	args: Record<string, string> = {},
	db: SQLiteStore,
	session?: SessionContext
) {
	const prompt = PROMPTS[name];
	if (!prompt) {
		throw new Error(`Prompt not found: ${name}`);
	}

	// Substitute arguments in messages (shared helper — reserved context keys
	// are never honored from args, then session context is auto-injected).
	const ctx = {
		owner: inferOwnerFromSession(session) || "unknown-owner",
		repo: inferRepoFromSession(session) || "unknown-repo"
	};
	const messages = prompt.messages.map((m: PromptMessage) => {
		const text = substitutePromptArgs(m.content.text, args, ctx);

		return {
			...m,
			content: {
				...m.content,
				text
			}
		};
	});

	return {
		description: prompt.description,
		messages,
		metadata: prompt.agent ? { agent: prompt.agent } : undefined
	};
}

/**
 * Handles completion for MCP 'prompts/get' arguments
 */
export async function completePromptArgument(
	name: string,
	argName: string,
	value: string,
	contextArguments: Record<string, unknown>,
	dataSources: { tasks: { id: string }[] }
) {
	void name;
	void contextArguments;
	if (argName === "task_id") {
		const values = dataSources.tasks.map((t) => t.id);
		return rankCompletionValues(values, value);
	}

	return [];
}
