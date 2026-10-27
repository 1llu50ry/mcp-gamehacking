// Tool definitions for memory domain.
//
// The `inputSchema` (JSON Schema) is DERIVED from the Zod schemas in
// `../../tools/schemas` via `inputSchemaFromSchema` (see
// `../../tools/schemas/json-schema.ts` for the generation + normalization
// rules). The Zod schemas are the single source of truth for tool input
// contracts — edit the Zod schema, never the derived `inputSchema` here.

import { MemoryDeleteSchema, MemoryReadSchema, MemoryWriteSchema } from "../../tools/schemas/memory";
import { inputSchemaFromSchema } from "../../tools/schemas/json-schema";

export const MEMORY_TOOL_DEFINITIONS = [
	// ── Canonical tools ──────────────────────────────────────────────────
	{
		name: "memory-write",
		title: "Memory Write",
		description:
			"Create, update, or acknowledge memories. Single or bulk.\n\n" +
			"Auto-infer logic:\n" +
			"- `content` (no `id`/`code`) → CREATE single memory (was memory-store)\n" +
			"- `id`/`code` + fields → UPDATE (was memory-update)\n" +
			"- `id`/`code` + `acknowledge` → ACKNOWLEDGE (was memory-acknowledge)\n" +
			"- `memories[]` → BULK (mixed create/update/acknowledge items)",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: inputSchemaFromSchema(MemoryWriteSchema)
	},
	{
		name: "memory-delete",
		title: "Memory Delete",
		description: "Soft-delete memories. Single or bulk.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: true,
			openWorldHint: false
		},
		inputSchema: inputSchemaFromSchema(MemoryDeleteSchema)
	},
	{
		name: "memory-read",
		title: "Memory Read",
		description:
			"Unified memory read: searches, gets detail, or returns stats. Auto-infers mode from params — query→search, id/code/ids/codes→detail, none→recap.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		inputSchema: inputSchemaFromSchema(MemoryReadSchema)
	}
];
