// Tool definitions for coding standard domain.
//
// The `inputSchema` (JSON Schema) is DERIVED from the Zod schemas in
// `../../tools/schemas` via `inputSchemaFromSchema` (see `../../tools/schemas/json-schema.ts`
// for the generation + normalization rules). The Zod schemas are the single
// source of truth for tool input contracts — edit the Zod schema, never the
// derived `inputSchema` here.

import { inputSchemaFromSchema } from "../../tools/schemas/json-schema";
import { StandardReadSchema } from "../../tools/schemas/standard-read";
import { StandardDeleteSchema } from "../../tools/schemas/standard";
import { StandardWriteSchema } from "../../tools/schemas/standard-write";

export const STANDARD_TOOL_DEFINITIONS = [
	{
		name: "standard-read",
		title: "Standard Read",
		description:
			"Unified handler for SEARCH, DETAIL, and LIST of coding standards. Auto-infers mode: 'query' → SEARCH (hybrid scoring per SPEC-001); 'id'/'code'/'ids'/'codes' → DETAIL (single or bulk); none → LIST (paginated).",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		inputSchema: inputSchemaFromSchema(StandardReadSchema)
	},
	{
		name: "standard-write",
		title: "Standard Write",
		description:
			"Unified handler for single CREATE, UPDATE, or BULK CREATE of coding standards. Auto-infers operation: 'content' (no id/code) → CREATE; 'id'/'code' → UPDATE; 'standards[]' → BULK CREATE.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: inputSchemaFromSchema(StandardWriteSchema)
	},
	{
		name: "standard-delete",
		title: "Standard Delete",
		description: "Deletes coding standards. Single or bulk. Auto-infers: UUID→direct ID, non-UUID→code lookup.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: true,
			openWorldHint: false
		},
		inputSchema: inputSchemaFromSchema(StandardDeleteSchema)
	}
];
