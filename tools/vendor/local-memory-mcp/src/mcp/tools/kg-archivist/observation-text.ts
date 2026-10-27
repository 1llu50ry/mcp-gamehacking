/**
 * KG observation-text lifecycle contract (TASK-045).
 *
 * The exact observation text is the link between the WRITERS that create
 * observation rows (extract.ts `saveExtractions`, relations.ts
 * `saveStandardRelations` / `saveCodebaseRelations` — invoked by the embedding
 * worker) and the DELETERS that remove them (memory/task/standard delete tools
 * and the codebase-index stale-file cleanup, TASK-293). This module is the
 * single source of truth for that text: writers and deleters MUST go through
 * `observationText()` and never inline the format, otherwise a drifted format
 * makes delete-time cleanup a silent no-op and domain-derived
 * observations/entities leak in the graph.
 *
 * `codebase` domain: the "title" is the indexed FILE PATH
 * (`"Mentioned in codebase: src/foo.ts"`) — one observation text per file,
 * shared by every entity extracted from that file's symbols.
 */

export type KgObservationDomain = "memory" | "standard" | "task" | "codebase";

/** Build the observation text linking an entity to the content that mentioned it. */
export function observationText(domain: KgObservationDomain, title: string): string {
	return `Mentioned in ${domain}: ${title}`;
}
