import { SQLiteStore } from "../../storage/sqlite";
import { logger } from "../../utils/logger";
import { KG_MAX_CONTEXT_ENTITIES } from "../../utils/constants";
import { observationText } from "./observation-text";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KgEntityResult {
	name: string;
	type: string;
	source_domain: string;
}

export interface KgRelationResult {
	from: string;
	to: string;
	type: string;
}

export interface KgResult {
	entities: KgEntityResult[];
	relations: KgRelationResult[];
}

// ---------------------------------------------------------------------------
// Shared KG query
// ---------------------------------------------------------------------------

/**
 * Query entities + relations for a given set of entity names.
 * Best-effort — never throws.
 *
 * OPT-PERF-04: the resolved name set is sliced to KG_MAX_CONTEXT_ENTITIES
 * before the IN() scans on entities/relations, so KG-context enrichment cost
 * stays bounded even when the caller resolved a large name set (e.g. an
 * aggregated memory/task read). Truncation semantics: the highest-relevance
 * names (FTS bm25 ORDER BY rank for the task path, observation-insertion
 * order for the memory/standard path) are kept; the tail beyond the cap is
 * dropped.
 *
 * Audit F2/F6: the relation lookup is additionally bounded by
 * `KG_MAX_CONTEXT_RELATIONS` (a 50-name window over a hub-heavy repo resolved
 * 37,815 edges ≈ 184k tokens in one read), and the entity lookup is no longer
 * repo-filtered so entities are never dropped while their edges ship.
 */
export function kgQuery(db: SQLiteStore, repo: string, entityNames: string[], sourceDomain: string): KgResult | null {
	try {
		if (entityNames.length === 0) return { entities: [], relations: [] };

		const uniqueNames = [...new Set(entityNames)];
		const capped = uniqueNames.slice(0, KG_MAX_CONTEXT_ENTITIES);

		const entities = db.knowledgeGraph
			.getEntitiesFor(capped, repo)
			.map((e) => ({ name: e.name, type: e.type, source_domain: sourceDomain }));

		const relations = db.knowledgeGraph.getRelationsFor(capped, repo);

		return { entities, relations };
	} catch (error) {
		logger.warn("[KG-Archivist] KG query failed", { error: String(error), repo });
		return null;
	}
}

/**
 * Fetch KG entities + relations related to a memory or standard by matching
 * observation text `"Mentioned in {domain}: {title}"`.
 */
export function fetchKgContext(
	db: SQLiteStore,
	repo: string,
	title: string,
	domain: "memory" | "standard"
): KgResult | null {
	try {
		const entityNames = db.knowledgeGraph.getEntityNamesByObservation(observationText(domain, title), repo);

		if (entityNames.length === 0) return { entities: [], relations: [] };

		return kgQuery(db, repo, entityNames, domain);
	} catch (error) {
		logger.warn(`[KG-Archivist] KG context fetch failed for ${domain}`, {
			error: String(error),
			title
		});
		return null;
	}
}

/**
 * Aggregate KG context across multiple memory or standard titles.
 */
export function fetchAggregatedKgContext(
	db: SQLiteStore,
	repo: string,
	titles: string[],
	domain: "memory" | "standard"
): KgResult | null {
	try {
		if (titles.length === 0) return { entities: [], relations: [] };

		const patterns = titles.map((t) => observationText(domain, t));

		const entityNames = db.knowledgeGraph.getEntityNamesByObservations(patterns, repo);

		if (entityNames.length === 0) return { entities: [], relations: [] };

		return kgQuery(db, repo, [...new Set(entityNames)], domain);
	} catch (error) {
		logger.warn(`[KG-Archivist] Aggregated KG context fetch failed for ${domain}`, {
			error: String(error),
			count: titles.length
		});
		return null;
	}
}

/**
 * Fetch KG entities + relations related to a task by matching title/description
 * text against entity names (FTS5 token index, OPT-PERF-04 — bounded, never
 * an unbounded scan). Best-effort — never throws.
 */
export function fetchTaskKgContext(
	db: SQLiteStore,
	repo: string,
	taskTitle: string,
	taskDescription: string
): KgResult | null {
	try {
		const searchText = [taskTitle, taskDescription].filter(Boolean).join(" ");
		if (!searchText.trim()) return { entities: [], relations: [] };

		const entityNames = db.knowledgeGraph.getEntityNamesByText(repo, searchText);

		if (entityNames.length === 0) return { entities: [], relations: [] };

		return kgQuery(db, repo, entityNames, "task");
	} catch (error) {
		logger.warn("[KG-Archivist] Task KG context fetch failed", {
			error: String(error),
			title: taskTitle
		});
		return null;
	}
}

/**
 * Aggregate KG context across multiple task titles + descriptions.
 */
export function fetchAggregatedTaskKgContext(
	db: SQLiteStore,
	repo: string,
	tasks: Array<{ title: string; description?: string | null }>
): KgResult | null {
	try {
		if (tasks.length === 0) return { entities: [], relations: [] };

		const searchText = tasks
			.map((t) => [t.title, t.description ?? ""].filter(Boolean).join(" "))
			.filter(Boolean)
			.join(" ");
		if (!searchText.trim()) return { entities: [], relations: [] };

		const entityNames = db.knowledgeGraph.getEntityNamesByText(repo, searchText);

		if (entityNames.length === 0) return { entities: [], relations: [] };

		return kgQuery(db, repo, entityNames, "task");
	} catch (error) {
		logger.warn("[KG-Archivist] Aggregated task KG context fetch failed", {
			error: String(error),
			count: tasks.length
		});
		return null;
	}
}
