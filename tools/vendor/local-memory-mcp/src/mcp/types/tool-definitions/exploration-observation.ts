import {
	ExplorationObservationReadSchema,
	ExplorationObservationWriteSchema
} from "../../tools/schemas/exploration-observation";
import { inputSchemaFromSchema } from "../../tools/schemas/json-schema";

export const EXPLORATION_OBSERVATION_TOOL_DEFINITIONS = [
	{
		name: "observation-write",
		title: "Exploration Observation Write",
		description:
			"Creates, updates, supersedes, atomically bulk-creates, or explicitly refreshes high-signal exploration observations with source fingerprints. Repeated normalized facts and evidence are idempotent.",
		annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false },
		inputSchema: inputSchemaFromSchema(ExplorationObservationWriteSchema)
	},
	{
		name: "observation-read",
		title: "Exploration Observation Read",
		description:
			"Reads evidence-backed exploration observations by scope, id, subject, task, file, symbol, or minimum confidence. Stale and unverifiable findings are excluded by default; evidence and fingerprint refresh are explicit.",
		annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
		inputSchema: inputSchemaFromSchema(ExplorationObservationReadSchema)
	}
];
