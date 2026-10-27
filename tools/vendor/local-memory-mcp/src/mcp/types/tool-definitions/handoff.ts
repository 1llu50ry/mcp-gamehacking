// Tool definitions for handoff and claim domain.
//
// The `inputSchema` (JSON Schema) is DERIVED from the Zod schemas in
// `../../tools/schemas` via `inputSchemaFromSchema` (see `../../tools/schemas/json-schema.ts`
// for the generation + normalization rules). The Zod schemas are the single
// source of truth for tool input contracts — edit the Zod schema, never the
// derived `inputSchema` here.

import { ClaimManageSchema, HandoffReadSchema, HandoffWriteSchema } from "../../tools/schemas/handoff";
import { inputSchemaFromSchema } from "../../tools/schemas/json-schema";

export const HANDOFF_TOOL_DEFINITIONS = [
	{
		name: "handoff-write",
		title: "Handoff Write",
		description:
			"Creates or updates a handoff. Auto-infers operation: provide summary+from_agent (with owner, repo) for CREATE; provide id+status for UPDATE.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: inputSchemaFromSchema(HandoffWriteSchema)
	},
	{
		name: "claim-manage",
		title: "Claim Manage",
		description:
			"Manages claims: CLAIM (task_id/task_code + agent), RELEASE (task_id/task_code + release:true), or LIST (query). Auto-infers operation from field presence.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: inputSchemaFromSchema(ClaimManageSchema)
	},
	{
		name: "handoff-read",
		title: "Handoff Read",
		description:
			"Reads handoffs and claims — detail, list, or search. Auto-infers operation: id for DETAIL, claim:true or agent for LIST CLAIMS, query for SEARCH handoffs, or none for LIST HANDOFFS.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			destructiveHint: false,
			openWorldHint: false
		},
		inputSchema: inputSchemaFromSchema(HandoffReadSchema)
	}
];
