/**
 * kg-archivist — knowledge-graph persistence and query layer.
 *
 * Backward-compatible re-exporter. The implementation now lives in
 * the `kg-archivist/` directory, split into focused modules:
 *
 *   extract.ts   — NLP entity extraction + saveExtractions
 *   relations.ts — saveTaskRelations + saveStandardRelations +
 *                  saveCodebaseRelations (TASK-293)
 *   query.ts     — kgQuery, fetchKgContext, fetchAggregatedKgContext,
 *                  fetchTaskKgContext, fetchAggregatedTaskKgContext
 */

export {
	// extract
	extractEntities,
	saveExtractions,
	type ExtractedEntity,
	// observation-text contract (TASK-045)
	observationText,
	type KgObservationDomain,
	// relations
	saveTaskRelations,
	saveStandardRelations,
	saveCodebaseRelations,
	// query
	kgQuery,
	fetchKgContext,
	fetchAggregatedKgContext,
	fetchTaskKgContext,
	fetchAggregatedTaskKgContext,
	type KgResult,
	type KgEntityResult,
	type KgRelationResult
} from "./kg-archivist/index";
