import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 12,
	name: "kg-relations-composite-index",
	up: (db) => {
		// Serve the KG dashboard graph queries (TASK-068 S2 / TASK-070):
		//   - listGraphEdges: relations scoped by repo joined to entities
		//     on both endpoints (the 3-way INNER JOIN over ALL relations)
		//   - listRelationsForGraph(repo, entityNames): filtered joins
		//     WHERE repo = ? AND from_entity IN (...) AND to_entity IN (...)
		// The single-column idx_relations_repo already exists; the
		// composite (repo, from_entity, to_entity) lets SQLite satisfy the
		// repo-scoped from/to predicates without a sort or scan of other
		// repos' relations.
		db.exec("CREATE INDEX IF NOT EXISTS idx_relations_repo_from_to ON relations(repo, from_entity, to_entity)");
		logger.info("[Migration] Added idx_relations_repo_from_to (repo, from_entity, to_entity)");
	}
};
