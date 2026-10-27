// Tool definitions for task domain — ADR-002: only 3 unified tools.
//
// The `inputSchema` (JSON Schema) is DERIVED from the Zod schemas in
// `../../tools/schemas` via `inputSchemaFromSchema` (see `../../tools/schemas/json-schema.ts`
// for the generation + normalization rules). The Zod schemas are the single
// source of truth for tool input contracts — edit the Zod schema, never the
// derived `inputSchema` here.

import { inputSchemaFromSchema } from "../../tools/schemas/json-schema";
import { TaskDeleteSchema, TaskReadSchema, TaskWriteSchema } from "../../tools/schemas/task";

export const TASK_TOOL_DEFINITIONS = [
	{
		name: "task-write",
		title: "Task Write",
		description:
			"Creates, updates, or performs status transitions on tasks. Zero oneOf — auto-infers mode from field combination:\n" +
			"  - `tasks[]` → BULK (each item infers independently: create if phase+title+desc, update if id/code)\n" +
			"  - `interactive: true` → INTERACTIVE (elicit missing fields via form, then create)\n" +
			"  - `id` or `code` → UPDATE (single by UUID or code)\n" +
			"  - `phase` + `title` + `description` → CREATE (optionally with `code` for custom code)\n" +
			"Owner is a scope/identity field, never implicitly mutable. To re-scope a task, pass the explicit opt-in `new_owner` " +
			"with a single `id`/`code` (validated GitHub username; fails loudly if the target (owner, repo, task_code) identity " +
			"already exists — add `task_code` in the same call to rename-and-move).",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			openWorldHint: false
		},
		inputSchema: inputSchemaFromSchema(TaskWriteSchema)
	},
	{
		name: "task-read",
		title: "Task Read",
		description:
			"Unified task read: search, detail, or list. Auto-infers mode from params — query→SEARCH, id/task_code/ids/task_codes/code/codes→DETAIL, none→LIST.\n\n" +
			"SEARCH mode: hybrid keyword search across tasks with status/phase/priority filters.\n" +
			"DETAIL mode: full task object with comments, children, and depended_by (single or bulk via id/task_code or ids/task_codes).\n" +
			'LIST mode: paginated listing filtered by status (comma-separated or "all") and phase.',
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		inputSchema: inputSchemaFromSchema(TaskReadSchema)
	},
	{
		name: "task-delete",
		title: "Task Delete",
		description:
			"Soft-deletes tasks (sets status to 'canceled'). Single or bulk. Remove task vectors, release claims, expire handoffs.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: inputSchemaFromSchema(TaskDeleteSchema)
	}
];
