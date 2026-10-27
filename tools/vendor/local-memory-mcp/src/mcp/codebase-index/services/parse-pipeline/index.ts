/**
 * parse-pipeline barrel — public API surface for the parse pipeline.
 *
 * Split of the former parse-pipeline.ts monolith (TASK-553). Consumers import
 * from `../services/parse-pipeline` and resolve here; behavior is unchanged.
 *
 * Module map:
 *   - constants.ts      → parse-loop bounds + canonical error strings
 *   - types.ts          → ParsePipelineOptions, ParsePipelineResult, shared stage types
 *   - read-phase.ts     → Phase 1 concurrent reads + checksums
 *   - decide-phase.ts   → Phase 2 checksum-skip + rename decision
 *   - semantic-pass.ts  → optional semantic enrichment pass (issue #89/#90)
 *   - enrich-parse.ts   → per-outcome parent-link + semantic + row mapping
 *   - batch-persist.ts  → Phase 3 parse + bounded per-batch DB flush
 *   - orchestrator.ts   → runParsePipeline + emitProgress (assembly)
 */

export { runParsePipeline, emitProgress } from "./orchestrator";
export type {
	ExistingFileEntry,
	IndexFileError,
	IndexProgress,
	ParsePipelineOptions,
	ParsePipelineResult
} from "./orchestrator";
