// Tool definitions for agent-context domain.
//
// The `inputSchema` (JSON Schema) is DERIVED from the Zod schemas in
// `../../tools/schemas` via `inputSchemaFromSchema` (see `../../tools/schemas/json-schema.ts`
// for the generation + normalization rules). The Zod schemas are the single
// source of truth for tool input contracts — edit the Zod schema, never the
// derived `inputSchema` here.

import { inputSchemaFromSchema } from "../../tools/schemas/json-schema";
import { AgentContextSchema } from "../../tools/schemas/agent";
import { MemorySummarizeSchema, MemorySynthesizeSchema } from "../../tools/schemas/memory";

export const AGENT_TOOL_DEFINITIONS = [
	// ── Agent Context tools ────────────────────────────────────────────────
	{
		name: "agent-context",
		title: "Agent Context Compiler",
		description:
			"Compiles deterministic, token-budgeted context from memories, decisions, tasks, handoffs, standards, fresh observations, and indexed code pointers.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		inputSchema: inputSchemaFromSchema(AgentContextSchema)
	},
	// ── Agent Synthesis (moved from memory domain per ADR-001, ADR-007) ────

	// Canonical: synthesize (per ADR-001)
	{
		name: "synthesize",
		title: "Synthesize Context",
		description: "Synthesizes context from local memory and tasks using MCP sampling.",
		annotations: {
			readOnlyHint: true,
			idempotentHint: true,
			openWorldHint: false
		},
		execution: {
			taskSupport: "optional"
		},
		inputSchema: inputSchemaFromSchema(MemorySynthesizeSchema)
	},

	// Canonical: repo-summarize (per ADR-001)
	{
		name: "repo-summarize",
		title: "Repository Summarize",
		description: "Update the repository summary with signals.",
		annotations: {
			readOnlyHint: false,
			idempotentHint: false,
			openWorldHint: false
		},
		inputSchema: inputSchemaFromSchema(MemorySummarizeSchema)
	}
];
