// Tool definitions for the prompt catalog domain (prompt-read proxy).
//
// The `inputSchema` (JSON Schema) is DERIVED from the Zod schemas in
// `../../tools/schemas` via `inputSchemaFromSchema` (see `../../tools/schemas/json-schema.ts`
// for the generation + normalization rules). The Zod schemas are the single
// source of truth for tool input contracts — edit the Zod schema, never the
// derived `inputSchema` here.

import { inputSchemaFromSchema } from "../../tools/schemas/json-schema";
import { PromptReadSchema } from "../../tools/schemas/prompt-read";

export const PROMPT_TOOL_DEFINITIONS = [
	{
		name: "prompt-read",
		title: "Prompt Read",
		description:
			"Read-only catalog + detail access to the MCP prompt library. Auto-infers mode: `name` → DETAIL (loads the prompt with {{var}} substitution, auto-injecting {{current_repo}}/{{current_owner}}); none → LIST (catalog of all prompts with name, description, agent, arguments).",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: inputSchemaFromSchema(PromptReadSchema)
	}
];
