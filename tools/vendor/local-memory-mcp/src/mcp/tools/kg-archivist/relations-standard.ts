import { randomUUID } from "crypto";
import type { SQLiteStore } from "../../storage/sqlite";
import { logger } from "../../utils/logger";
import { KG_MAX_TASK_RELATION_ENTITIES } from "../../utils/constants";
import { KG_RELATION_CONFIDENCE_SEMANTIC } from "./relations-conf";
import { extractEntities, type ExtractedEntity } from "./extract";
import { observationText } from "./observation-text";

// ---------------------------------------------------------------------------
// Standard-specific semantic relations
// ---------------------------------------------------------------------------

/**
 * Extracts entities from standard supplementary fields (title, context, stack)
 * and creates semantic KG relations for coding standards:
 *
 * - **parent_id → `extends`**: Links entities from the current standard to
 *   entities extracted from the parent standard's title/content.
 * - **similarity → `related_to`**: Links entities from the current standard
 *   to entities from semantically similar standards (using vector search).
 *
 * Entity extraction from the standard's main `content` field is handled
 * separately by `saveExtractions()`. This function handles the supplementary
 * fields that are specific to standards (context, stack, title).
 *
 * Observations: Each entity also generates an observation record.
 * Failures are logged at `warn` level but never thrown.
 *
 * **Bounded cross-products (audit F13).** `extends` is
 * `|entities| × |parent entities|` and `related_to` is
 * `|entities| × |similar entities| × up to 5 similar standards` — the widest
 * fan-out of any writer in the graph. Both sides of both products are capped at
 * `KG_MAX_TASK_RELATION_ENTITIES` so one standard write can add at most
 * N² + 5N² edges instead of an unbounded product of three document sizes.
 */
export async function saveStandardRelations(
	standard: {
		id: string;
		title: string;
		content: string;
		context: string;
		stack: string[];
		parent_id: string | null;
		owner: string;
		repo: string | null;
	},
	db: SQLiteStore
): Promise<void> {
	// ── 1. Extract entities from supplementary fields (title + context + stack) ──
	const supplementaryText = [standard.title, standard.context, ...(standard.stack ?? [])].filter(Boolean).join("\n");

	if (!supplementaryText.trim()) return;

	let entities: ExtractedEntity[];
	try {
		entities = await extractEntities(supplementaryText);
	} catch (err) {
		logger.warn("[KG-Archivist] Entity extraction failed for standard relations, skipping", {
			error: String(err)
		});
		return;
	}

	if (entities.length === 0) return;

	const now = new Date().toISOString();
	const repo = standard.repo ?? "";
	const owner = standard.owner ?? "";
	// Bounded relation fan-out (audit F13) — the entity/observation writes
	// below still cover EVERY extracted entity; only the cross-products are
	// capped.
	const relationEntities = entities.slice(0, KG_MAX_TASK_RELATION_ENTITIES);
	const entityNames = relationEntities.map((e) => e.name);
	const entityTypeByName = new Map(relationEntities.map((e) => [e.name, e.type]));

	const observationTextValue = observationText("standard", standard.title);
	for (const entity of entities) {
		try {
			// ensureObservation upserts the entity AND inserts the observation
			// in one BEGIN IMMEDIATE transaction, so a concurrent
			// orphan-sweep (deleteOrphanEntities) cannot delete the fresh
			// entity between the upsert and the observation insert — the
			// observations.entity_name → entities(name) FK can never fail
			// (TASK-073 / MEM-482).
			db.knowledgeGraph.ensureObservation({
				id: randomUUID(),
				name: entity.name,
				type: entity.type,
				description: null,
				observation: observationTextValue,
				repo,
				owner,
				created_at: now
			});
		} catch (err) {
			logger.warn("[KG-Archivist] Failed to save standard entity", {
				error: String(err),
				entity: entity.name
			});
		}
	}

	// ── 2. parent_id → extends relations ──
	if (standard.parent_id) {
		const parentStandard = db.standards.getById(standard.parent_id);
		if (parentStandard) {
			let parentEntities: ExtractedEntity[];
			try {
				const parentText = `${parentStandard.title}\n${parentStandard.content}`;
				parentEntities = await extractEntities(parentText);
			} catch (err) {
				logger.warn("[KG-Archivist] Entity extraction failed for parent standard, skipping extends relations", {
					error: String(err)
				});
				parentEntities = [];
			}

			if (parentEntities.length > 0) {
				for (const entityName of entityNames) {
					for (const parentEntity of parentEntities.slice(0, KG_MAX_TASK_RELATION_ENTITIES)) {
						try {
							// Upsert both endpoints first (parent entities come from
							// another document and may have been swept) so the FK
							// on relations.from_entity/to_entity cannot fail
							// (TASK-065 / MEM-473).
							db.knowledgeGraph.ensureRelation({
								from_entity: entityName,
								from_type: entityTypeByName.get(entityName) ?? "concept",
								to_entity: parentEntity.name,
								to_type: parentEntity.type,
								relation_type: "extends",
								repo,
								owner,
								created_at: now,
								confidence: KG_RELATION_CONFIDENCE_SEMANTIC
							});
							db.knowledgeGraph.insertObservation({
								id: randomUUID(),
								entity_name: entityName,
								// Contract-format text (audit F12 / TASK-045): the old
								// free-form `"extends relation: A → B"` could not be
								// matched by any deleter, so it leaked forever and
								// pinned its entity against the orphan sweep.
								observation: observationTextValue,
								repo,
								owner,
								created_at: now
							});
						} catch (err) {
							logger.warn("[KG-Archivist] Failed to save extends relation", {
								error: String(err),
								from: entityName,
								to: parentEntity.name
							});
						}
					}
				}
			}
		}
	}

	// ── 3. similarity → related_to relations ──
	try {
		const similarStandards = db.standards.searchBySimilarity(standard.content, {
			owner: standard.owner || undefined,
			repo: standard.repo || undefined,
			limit: 5,
			minScore: 0.6
		});

		const relatedStandards = similarStandards.filter((s) => s.id !== standard.id);

		for (const similar of relatedStandards) {
			// Skip if already linked via parent_id→extends
			if (similar.id === standard.parent_id) continue;

			let similarEntities: ExtractedEntity[];
			try {
				const similarText = `${similar.title}\n${similar.content}`;
				similarEntities = await extractEntities(similarText);
			} catch (err) {
				logger.warn("[KG-Archivist] Entity extraction failed for similar standard, skipping related_to", {
					error: String(err),
					standardId: similar.id
				});
				continue;
			}

			if (similarEntities.length === 0) continue;

			for (const entityName of entityNames) {
				for (const similarEntity of similarEntities.slice(0, KG_MAX_TASK_RELATION_ENTITIES)) {
					try {
						// Upsert both endpoints first (similar-standard entities come
						// from another document and may have been swept) so the FK
						// on relations.from_entity/to_entity cannot fail
						// (TASK-065 / MEM-473).
						db.knowledgeGraph.ensureRelation({
							from_entity: entityName,
							from_type: entityTypeByName.get(entityName) ?? "concept",
							to_entity: similarEntity.name,
							to_type: similarEntity.type,
							relation_type: "related_to",
							repo,
							owner,
							created_at: now,
							confidence: KG_RELATION_CONFIDENCE_SEMANTIC
						});
						db.knowledgeGraph.insertObservation({
							id: randomUUID(),
							entity_name: entityName,
							// Contract-format text (audit F12 / TASK-045) — see above.
							observation: observationTextValue,
							repo,
							owner,
							created_at: now
						});
					} catch {
						// Silent: relation may already exist
					}
				}
			}
		}
	} catch (err) {
		logger.warn("[KG-Archivist] Failed to search similar standards for related_to relations", {
			error: String(err)
		});
	}
}
