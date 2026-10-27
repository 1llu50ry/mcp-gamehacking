import { McpServer } from "@modelcontextprotocol/server";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { SessionContext, inferRepoFromSession, inferOwnerFromSession } from "../session";
import { listPromptFiles, loadPromptFromMarkdown } from "./loader";
import { substitutePromptArgs } from "./substitution";
import type { LoadedPrompt } from "../interfaces";
import { logger } from "../utils/logger";

/**
 * Builds the description advertised by the SDK's prompts/list handler.
 *
 * argsSchema is omitted (SDK bundles zod/v4 internally, incompatible with
 * the project's zod v3), so the SDK can only surface `description` in
 * prompts/list. Append the frontmatter argument definitions here so clients
 * can discover each prompt's arguments.
 */
function buildPromptDescription(loaded: LoadedPrompt): string {
	let description = loaded.description;

	if (loaded.arguments.length > 0) {
		const argLines = loaded.arguments
			.map((arg) => {
				const name = String(arg.name ?? "");
				const argDescription = arg.description ? String(arg.description) : "";
				const required = arg.required === true ? " (required)" : "";
				return `- ${name}: ${argDescription}${required}`;
			})
			.join("\n");
		description += `\n\nArguments:\n${argLines}`;
	}

	return description;
}

/**
 * Registers all prompts via SDK registerPrompt().
 *
 * Each prompt is defined as a Markdown file in ./definitions/ with
 * frontmatter containing name, description, arguments, and agent metadata.
 *
 * The callback substitutes template variables ({{argName}}) with
 * provided argument values, and auto-injects {{current_repo}} and
 * {{current_owner}} from the session context.
 *
 * Note: argsSchema is omitted because the SDK bundles zod/v4 internally
 * (incompatible with the project's zod v3). Argument definitions from
 * prompt frontmatter are surfaced via the `description` field instead.
 * Completions for prompt arguments (e.g. task_id) continue to work via
 * the old completion handler in completion.ts.
 */
export function registerAllPrompts(
	server: McpServer,
	store: SQLiteStore,
	_vectors: VectorStore,
	session: SessionContext
): void {
	const _db = store;

	// Discover and load all prompt definitions
	const promptNames = listPromptFiles();

	for (const name of promptNames) {
		let loaded: LoadedPrompt;
		try {
			loaded = loadPromptFromMarkdown(name);
		} catch (e) {
			logger.warn(`[prompts] Failed to load prompt ${name}: ${e}`);
			continue;
		}

		// Register prompt without argsSchema (zod/v4 incompatibility).
		// Arguments are documented in the prompt description.
		server.registerPrompt(
			loaded.name,
			{
				title: loaded.name,
				description: buildPromptDescription(loaded)
			},
			async (args: Record<string, unknown>, _extra) => {
				// Substitute arguments (shared helper — reserved context keys are
				// never honored from args), then auto-inject session context.
				const stringArgs = Object.fromEntries(Object.entries(args).map(([key, value]) => [key, String(value)]));
				const text = substitutePromptArgs(loaded.content, stringArgs, {
					owner: inferOwnerFromSession(session) || "unknown-owner",
					repo: inferRepoFromSession(session) || "unknown-repo"
				});

				return {
					description: loaded.description,
					messages: [
						{
							role: "user" as const,
							content: {
								type: "text" as const,
								text
							}
						}
					],
					...(loaded.agent ? { _meta: { agent: loaded.agent } } : {})
				};
			}
		);

		logger.debug(`[prompts] Registered prompt: ${loaded.name}`);
	}
}
