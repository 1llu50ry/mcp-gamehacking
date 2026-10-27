import { randomUUID } from "crypto";
import { SQLiteStore } from "../../storage/sqlite";
import { logger } from "../../utils/logger";
import { KG_MAX_COOCCURRENCE_ENTITIES } from "../../utils/constants";
import { KgObservationDomain, observationText } from "./observation-text";
import { cleanText, isExcludedNoun, isValidEntityName, stripLeadingDeterminer } from "./entity-filter";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONTENT_LENGTH = 5000;

export interface ExtractedEntity {
	name: string;
	type: "person" | "place" | "organization" | "concept";
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * NLP-based entity extraction using the `compromise` library.
 *
 * Extracts four entity types from textual content:
 * - **person**   – identified via `doc.people()`
 * - **place**    – identified via `doc.places()`
 * - **organization** – identified via `doc.organizations()`
 * - **concept**  – noun phrases (`doc.nouns()`) after filtering common
 *                  stopwords, pronouns, and determiners
 *
 * Deduplication is case-insensitive (first occurrence wins).
 * Very long content (>5000 chars) is truncated for performance.
 */
export async function extractEntities(content: string): Promise<ExtractedEntity[]> {
	if (!content || content.trim().length === 0) return [];

	const { default: nlp } = await import("compromise");
	const text = content.length > MAX_CONTENT_LENGTH ? content.slice(0, MAX_CONTENT_LENGTH) : content;
	const doc = nlp(text);
	const seen = new Set<string>();
	const entities: ExtractedEntity[] = [];

	function add(name: string, type: ExtractedEntity["type"]): void {
		const trimmed = name.trim();
		if (!trimmed || trimmed.length < 2) return;
		if (!isValidEntityName(trimmed)) return;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		entities.push({ name: trimmed, type });
	}

	// People
	for (const match of doc.people().json() as Array<{ text: string }>) {
		add(cleanText(match.text), "person");
	}

	// Places
	for (const match of doc.places().json() as Array<{ text: string }>) {
		add(cleanText(match.text), "place");
	}

	// Organizations
	for (const match of doc.organizations().json() as Array<{ text: string }>) {
		add(cleanText(match.text), "organization");
	}

	// Nouns → concepts (after filtering)
	for (const match of doc.nouns().json() as Array<{ text: string }>) {
		const raw = cleanText(match.text);
		const candidate = stripLeadingDeterminer(raw);
		if (!isExcludedNoun(candidate)) {
			add(candidate, "concept");
		}
	}

	return entities;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Confidence for NLP auto-extraction co-occurrence edges ([KGCONF-1] /
 * TASK-325, migration v24). The compromise extractor may misidentify entity
 * names and co-occurrence pairs, so free-text edges carry the heaviest
 * discount (spec anchor ~0.55). Full mapping documented in the v24 migration.
 */
export const KG_RELATION_CONFIDENCE_AUTO_EXTRACTION = 0.55;

/**
 * Extract entities from `content` and persist them into the knowledge-graph
 * tables (`entities`, `observations`) **plus** co-occurrence relations
 * (`relations`) in a single `BEGIN IMMEDIATE` transaction per document
 * (OPT-PERF-01).
 *
 * - Entities are inserted with `INSERT OR IGNORE` so duplicate names do not
 *   cause errors.
 * - Each extraction produces an observation record linking the entity to the
 *   content that mentioned it. The observation text comes from the shared
 *   `observationText(domain, title)` contract (TASK-045) — the delete tools
 *   remove observations by the same text, so the caller MUST pass the real
 *   domain (`memory`/`standard`/`task`), never the legacy hardcoded default.
 * - Failures are logged at `warn` level but never thrown — the caller's
 *   memory-store operation is never blocked.
 *
 * **OPT-PERF-01**: The old per-entity `ensureObservation` / per-pair
 * `ensureRelation` pattern opened a separate `BEGIN IMMEDIATE` transaction
 * per call → O(N²) transactions for N entities. Now all writes for one
 * document go through `KnowledgeGraphEntity.saveExtractionBatch`, which
 * wraps everything in a single outer transaction using the inner statements
 * directly (no nested savepoints — single transaction level). The IMMEDIATE
 * write lock is held for the full batch, so a concurrent orphan-sweep cannot
 * interleave between entity upsert and observation insert (pair atomicity
 * preserved, TASK-073 / MEM-482).
 *
 * **Audit F0 (bounded co-occurrence)**: entity + observation writes cover
 * EVERY extracted entity, but the `co_mentioned` clique is capped at
 * `KG_MAX_COOCCURRENCE_ENTITIES` entities (default 16 → at most 120 pairs per
 * document). Without the cap one document's edge cost is N(N-1)/2 in its own
 * entity count, which is how `relations` reached 77% of total DB size.
 */
export async function saveExtractions(
	content: string,
	title: string,
	owner: string,
	repo: string,
	db: SQLiteStore,
	domain: KgObservationDomain = "memory"
): Promise<void> {
	if (!content || content.trim().length === 0) return;

	let entities: ExtractedEntity[];
	try {
		entities = await extractEntities(content);
	} catch (err) {
		logger.warn("[KG-Archivist] Entity extraction failed, skipping", {
			error: String(err)
		});
		return;
	}

	if (entities.length === 0) return;

	const now = new Date().toISOString();
	const observationTextValue = observationText(domain, title);

	// Build entity-observation pairs (entity upsert + observation insert)
	const observations = entities.map((entity) => ({
		id: randomUUID(),
		name: entity.name,
		type: entity.type,
		description: null as string | null,
		observation: observationTextValue
	}));

	// Build co-occurrence relation edges. Every pair carries the auto-
	// extraction confidence 0.55 ([KGCONF-1] / TASK-325, migration v24) —
	// these are free-text NLP guesses, the most uncertain edge family.
	//
	// BOUNDED CLIQUE (audit F0): the pair count of a clique over N entities is
	// N(N-1)/2, so an unbounded clique makes the write cost of ONE document
	// quadratic in its own entity count. That is not a theoretical concern —
	// on a real corpus a single 292-entity file produced 42,486 edges, and the
	// 1.6% of documents above 30 entities produced 91.5% of all co-occurrence
	// edges in the database. `relations` then grew to 77% of total DB size at
	// ~70k edges/day with no retention pass to reclaim it.
	//
	// The cap applies ONLY to the co-occurrence fan-out: EVERY extracted
	// entity still gets its `entities` row and its `observations` row above,
	// so nothing the graph KNOWS is lost — only the density of the weakest
	// (0.55-confidence) edge family is bounded. `entities` is ordered
	// people → places → organizations → nouns, so the retained slice keeps the
	// most specific entity types and drops generic noun-phrase tail pairs.
	const relations: Array<{
		from_entity: string;
		from_type: string;
		to_entity: string;
		to_type: string;
		relation_type: string;
		confidence: number;
	}> = [];
	const cooccurring =
		KG_MAX_COOCCURRENCE_ENTITIES > 0 ? entities.slice(0, KG_MAX_COOCCURRENCE_ENTITIES) : ([] as ExtractedEntity[]);
	if (cooccurring.length > 1) {
		for (let i = 0; i < cooccurring.length; i++) {
			for (let j = i + 1; j < cooccurring.length; j++) {
				relations.push({
					from_entity: cooccurring[i].name,
					from_type: cooccurring[i].type,
					to_entity: cooccurring[j].name,
					to_type: cooccurring[j].type,
					relation_type: "co_mentioned",
					confidence: KG_RELATION_CONFIDENCE_AUTO_EXTRACTION
				});
			}
		}
	}

	if (entities.length > cooccurring.length) {
		logger.debug("[KG-Archivist] Co-occurrence clique capped", {
			title,
			domain,
			entities: entities.length,
			cooccurring: cooccurring.length,
			pairs: relations.length,
			pairsUncapped: (entities.length * (entities.length - 1)) / 2
		});
	}

	// Single BEGIN IMMEDIATE for the whole document (OPT-PERF-01)
	db.knowledgeGraph.saveExtractionBatch({
		observations,
		relations,
		repo,
		owner: owner ?? "",
		created_at: now
	});
}
