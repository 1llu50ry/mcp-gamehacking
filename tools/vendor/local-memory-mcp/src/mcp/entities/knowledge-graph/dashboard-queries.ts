import { KG_MAX_GRAPH_EDGES } from "../../utils/constants";
import type { KgEntityRow, KgObservationRow, KgQueryRunner, KgRelationRow } from "./query-types";

/**
 * Whether an entity with the given name exists.
 */
export function entityExists(runner: KgQueryRunner, name: string, repo: string): boolean {
	return (
		runner.get<{ present: number }>("SELECT 1 AS present FROM entities WHERE name = ? AND repo = ?", [name, repo]) !==
		undefined
	);
}

/**
 * Full entity row by name (dashboard detail).
 */
export function getEntityByName(runner: KgQueryRunner, name: string, repo: string): KgEntityRow | undefined {
	return runner.get<KgEntityRow>("SELECT * FROM entities WHERE name = ? AND repo = ?", [name, repo]);
}

/**
 * Full relation rows touching the given entity (dashboard detail).
 */
export function getRelationsByName(runner: KgQueryRunner, name: string, repo: string): KgRelationRow[] {
	return runner.all<KgRelationRow>(
		"SELECT * FROM relations WHERE repo = ? AND (from_entity = ? OR to_entity = ?) ORDER BY relation_type",
		[repo, name, name]
	);
}

/**
 * Full observation rows for the given entity (dashboard detail).
 */
export function getObservationsByName(runner: KgQueryRunner, name: string, repo: string): KgObservationRow[] {
	return runner.all<KgObservationRow>(
		"SELECT * FROM observations WHERE entity_name = ? AND repo = ? ORDER BY created_at DESC",
		[name, repo]
	);
}

/**
 * Entities scoped to a repo with optional type/search filters (dashboard).
 * Supports limit/offset pagination; when omitted returns all matching rows.
 */
export function listEntities(
	runner: KgQueryRunner,
	repo: string,
	options?: { type?: string; search?: string; limit?: number; offset?: number }
): KgEntityRow[] {
	let sql = "SELECT * FROM entities WHERE repo = ?";
	const params: unknown[] = [repo];
	if (options?.type) {
		sql += " AND type = ?";
		params.push(options.type);
	}
	if (options?.search) {
		sql += " AND name LIKE ?";
		params.push(`%${options.search}%`);
	}
	sql += " ORDER BY name";
	if (options?.limit !== undefined) {
		sql += " LIMIT ?";
		params.push(options.limit);
	}
	if (options?.offset !== undefined) {
		sql += " OFFSET ?";
		params.push(options.offset);
	}
	return runner.all<KgEntityRow>(sql, params);
}

/**
 * Count entities matching the given filters (for pagination total).
 */
export function countEntities(
	runner: KgQueryRunner,
	repo: string,
	options?: { type?: string; search?: string }
): number {
	let sql = "SELECT COUNT(*) AS cnt FROM entities WHERE repo = ?";
	const params: unknown[] = [repo];
	if (options?.type) {
		sql += " AND type = ?";
		params.push(options.type);
	}
	if (options?.search) {
		sql += " AND name LIKE ?";
		params.push(`%${options.search}%`);
	}
	return runner.get<{ cnt: number }>(sql, params)?.cnt ?? 0;
}

/**
 * All relations scoped to a repo (dashboard).
 * Supports limit/offset pagination; when omitted returns all matching rows.
 */
export function listRelations(
	runner: KgQueryRunner,
	repo: string,
	options?: { limit?: number; offset?: number }
): KgRelationRow[] {
	let sql = "SELECT * FROM relations WHERE repo = ? ORDER BY from_entity, to_entity";
	const params: unknown[] = [repo];
	if (options?.limit !== undefined) {
		sql += " LIMIT ?";
		params.push(options.limit);
	}
	if (options?.offset !== undefined) {
		sql += " OFFSET ?";
		params.push(options.offset);
	}
	return runner.all<KgRelationRow>(sql, params);
}

/**
 * Count relations scoped to a repo (for pagination total).
 */
export function countRelations(runner: KgQueryRunner, repo: string): number {
	return runner.get<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM relations WHERE repo = ?", [repo])?.cnt ?? 0;
}

/**
 * Graph nodes for a repo (dashboard): entity name + type.
 *
 * Ordered by edge degree (highest first) so that each paginated page is a
 * coherent window of the highest-connectivity nodes that the top-K edges
 * actually connect — alphabetical ordering scattered degree-high nodes
 * across pages, causing near-zero edge coverage per page (TASK-145).
 * Falls back to name ordering for nodes with identical degree.
 * Supports limit/offset pagination; when omitted returns all matching rows.
 *
 * OPT-PERF (TASK-268 / audit F2): degrees come from the materialized
 * `kg_degrees` table (migration v22, maintained by relations triggers)
 * instead of a per-request CTE aggregate over ALL of the repo's relations.
 * The old CTE walked every relation of the repo (852k+ rows for edge-heavy
 * repos) on the Node event loop — ~23s warm / ~190s cold, blocking
 * /api/health. The v22 backfill seeds the table once at migration time.
 */
export function listGraphNodes(
	runner: KgQueryRunner,
	repo: string,
	options?: { limit?: number; offset?: number }
): Array<{ name: string; type: string }> {
	let sql = `SELECT e.name, e.type
		 FROM entities e
		 LEFT JOIN kg_degrees d ON d.repo = e.repo AND d.node = e.name
		 WHERE e.repo = ?
		 ORDER BY COALESCE(d.degree, 0) DESC, e.name`;
	const params: unknown[] = [repo];
	if (options?.limit !== undefined) {
		sql += " LIMIT ?";
		params.push(options.limit);
	}
	if (options?.offset !== undefined) {
		sql += " OFFSET ?";
		params.push(options.offset);
	}
	return runner.all<{ name: string; type: string }>(sql, params);
}

/**
 * Count graph nodes for a repo (for pagination total).
 */
export function countGraphNodes(runner: KgQueryRunner, repo: string): number {
	return runner.get<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM entities e WHERE e.repo = ?", [repo])?.cnt ?? 0;
}

/**
 * Graph edges for a repo (dashboard): relations joined against entities on
 * both ends so dangling references never surface.
 *
 * Server-side cap (TASK-068 S2 / TASK-070): returns the top-N highest-value
 * edges ranked by endpoint degree (degree(from) + degree(to), computed once
 * per node in a CTE) instead of serializing the whole relations table. The
 * client culls to 2,000 edges anyway (TASK-063), so shipping only the
 * highest-degree edges keeps the payload at a few hundred KB and avoids the
 * per-request 3-way join + sort over ALL relations.
 *
 * @param runner - Query accessor
 * @param repo - Repository scope
 * @param limit - Maximum edges to return (default: KG_MAX_GRAPH_EDGES)
 * @param probe - When true, queries `limit + 1` rows to detect truncation.
 *   Callers can check `result.length > limit` to determine if the graph
 *   was truncated (TASK-148). The extra probe row is never consumed by
 *   the caller — they slice to `limit` before returning to the client.
 * @returns Array of edges (may be `limit + 1` when probe=true)
 */
export function listGraphEdges(
	runner: KgQueryRunner,
	repo: string,
	limit = KG_MAX_GRAPH_EDGES,
	probe = false
): Array<{ source: string; target: string; relation_type: string; confidence: number }> {
	const effectiveLimit = probe ? limit + 1 : limit;
	return runner.all<{ source: string; target: string; relation_type: string; confidence: number }>(
		`WITH degrees AS (
		   SELECT node, COUNT(*) AS degree
		   FROM (
		     SELECT from_entity AS node FROM relations WHERE repo = ?
		     UNION ALL
		     SELECT to_entity AS node FROM relations WHERE repo = ?
		   )
		   GROUP BY node
		 )
		 SELECT r.from_entity as source, r.to_entity as target, r.relation_type, r.confidence
		 FROM relations r
		 INNER JOIN entities e1 ON r.from_entity = e1.name AND r.repo = e1.repo
		 INNER JOIN entities e2 ON r.to_entity = e2.name AND r.repo = e2.repo
		 LEFT JOIN degrees d1 ON d1.node = r.from_entity
		 LEFT JOIN degrees d2 ON d2.node = r.to_entity
		 WHERE r.repo = ?
		 ORDER BY (COALESCE(d1.degree, 0) + COALESCE(d2.degree, 0)) DESC, r.from_entity, r.to_entity
		 LIMIT ?`,
		[repo, repo, repo, effectiveLimit]
	);
}

/**
 * Graph edges for a repo restricted to a node subset (TASK-268 / audit F2).
 *
 * Only edges whose BOTH endpoints are in `nodeNames` are returned — the
 * dashboard graph renders exactly the fetched top-N window, so every shipped
 * edge is drawable and the query never walks the repo's full relation set.
 * Endpoint degrees come from the materialized `kg_degrees` cache (migration
 * v22) instead of a per-request CTE over ALL relations, and the sort is
 * bounded to the subset's edge count. For an 852k-relation repo with a
 * 300-node window this replaced a ~23s full-repo sort with a sub-second
 * index-served subset scan (OPT-PERF / TASK-268).
 *
 * @param runner - Query accessor
 * @param repo - Repository scope
 * @param nodeNames - Node window returned by `listGraphNodes`; edges must
 *   connect two nodes in this set. Empty → no edges.
 * @param limit - Maximum edges to return (default: KG_MAX_GRAPH_EDGES)
 * @param probe - When true, queries `limit + 1` rows so callers can detect
 *   truncation (TASK-148 pattern: `result.length > limit`). The probe row is
 *   never consumed by callers.
 * @returns Edges among the subset, ranked by endpoint degree
 */
export function listGraphEdgesForSubset(
	runner: KgQueryRunner,
	repo: string,
	nodeNames: string[],
	limit = KG_MAX_GRAPH_EDGES,
	probe = false
): Array<{ source: string; target: string; relation_type: string; confidence: number }> {
	if (nodeNames.length === 0) return [];
	const placeholders = nodeNames.map(() => "?").join(",");
	const effectiveLimit = probe ? limit + 1 : limit;
	return runner.all<{ source: string; target: string; relation_type: string; confidence: number }>(
		`SELECT r.from_entity as source, r.to_entity as target, r.relation_type, r.confidence
		 FROM relations r
		 JOIN kg_degrees d1 ON d1.repo = r.repo AND d1.node = r.from_entity
		 JOIN kg_degrees d2 ON d2.repo = r.repo AND d2.node = r.to_entity
		 WHERE r.repo = ? AND r.from_entity IN (${placeholders}) AND r.to_entity IN (${placeholders})
		 ORDER BY (d1.degree + d2.degree) DESC, r.from_entity, r.to_entity
		 LIMIT ?`,
		[repo, ...nodeNames, ...nodeNames, effectiveLimit]
	);
}

/**
 * Entities for the unified graph — optionally scoped to a repo.
 */
export function listEntitiesForGraph(runner: KgQueryRunner, repo: string | undefined, limit: number): KgEntityRow[] {
	if (repo) {
		return runner.all<KgEntityRow>("SELECT * FROM entities WHERE repo = ? ORDER BY name LIMIT ?", [repo, limit]);
	}
	return runner.all<KgEntityRow>("SELECT * FROM entities ORDER BY name LIMIT ?", [limit]);
}

/**
 * Relations for the unified graph — optionally scoped to a repo.
 *
 * When `entityNames` is provided, ONLY edges whose BOTH endpoints are in
 * that node subset are returned (TASK-068 S2 / TASK-070): the unified
 * graph caps nodes at `limit` and previously fetched ALL relations, so the
 * payload scaled with the total edge count (~22k) instead of the node cap.
 * Bounded by `limit` (KG_MAX_GRAPH_EDGES) and served by the composite
 * index (repo, from_entity, to_entity) (migration v12).
 */
export function listRelationsForGraph(
	runner: KgQueryRunner,
	repo: string | undefined,
	entityNames?: string[],
	limit = KG_MAX_GRAPH_EDGES
): KgRelationRow[] {
	if (entityNames) {
		// Explicit (possibly empty) subset: empty → no edges, so a graph
		// with zero entity nodes never ships dangling `ent-` edges.
		if (entityNames.length === 0) return [];
		const placeholders = entityNames.map(() => "?").join(",");
		if (repo) {
			return runner.all<KgRelationRow>(
				`SELECT * FROM relations
				 WHERE repo = ? AND from_entity IN (${placeholders}) AND to_entity IN (${placeholders})
				 ORDER BY from_entity, to_entity
				 LIMIT ?`,
				[repo, ...entityNames, ...entityNames, limit]
			);
		}
		return runner.all<KgRelationRow>(
			`SELECT * FROM relations
			 WHERE from_entity IN (${placeholders}) AND to_entity IN (${placeholders})
			 ORDER BY from_entity, to_entity
			 LIMIT ?`,
			[...entityNames, ...entityNames, limit]
		);
	}
	// Legacy behavior (no subset): bounded by the same cap.
	if (repo) {
		return runner.all<KgRelationRow>("SELECT * FROM relations WHERE repo = ? ORDER BY from_entity, to_entity LIMIT ?", [
			repo,
			limit
		]);
	}
	return runner.all<KgRelationRow>("SELECT * FROM relations ORDER BY from_entity, to_entity LIMIT ?", [limit]);
}
