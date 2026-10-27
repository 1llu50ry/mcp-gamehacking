import { randomUUID } from "crypto";
import type { SQLiteStore } from "../../storage/sqlite";
import { logger } from "../../utils/logger";
import { KG_MAX_CONTEXT_ENTITIES, KG_MAX_GRAPH_EDGES } from "../../utils/constants";
import { KG_RELATION_CONFIDENCE_CODEBASE } from "./relations-conf";
import { observationText } from "./observation-text";
import type { CodebaseReference, CodebaseSymbol } from "../../types";

// ---------------------------------------------------------------------------
// Codebase-specific semantic relations (TASK-293)
// ---------------------------------------------------------------------------

/**
 * Creates KG entities + relations for ONE indexed codebase file:
 *
 * 1. **Symbol entities** — every symbol declared in the file becomes an
 *    entity (type = the symbol kind, e.g. "function" | "class" | "interface")
 *    with the file-scoped observation `observationText("codebase", filePath)`
 *    (shared with `saveExtractions`, so the worker's extraction step and this
 *    writer converge on the same observation row via INSERT OR IGNORE).
 * 2. **Reference edges** — every `codebase_references` row whose
 *    `caller_file` is THIS file becomes a relation from the calling symbol
 *    (`caller_name`, falling back to the file path) to the referenced symbol
 *    (`symbol_name`), with `relation_type` = the reference kind
 *    ('call' | 'instantiation' | 'import' | 'extends' | 'implements'). This
 *    is the "codebase observation domain" wiring: the KG graph mirrors the
 *    indexed call/import/heritage graph (ADR-002 name-based resolution; the
 *    v23 `target_symbol_id`/`target_file` columns point at the referenced
 *    symbol when resolvable — the target's type is resolved by name here,
 *    keeping the graph name-keyed like every other domain).
 *
 * Mirrors the `saveStandardRelations` pattern: entity/observation upserts run
 * per entity, relation upserts per edge, each failure is logged at `warn` and
 * never thrown (the worker's job completes; extraction itself is handled by
 * `saveExtractions`).
 *
 * Bounds (TASK-293): entities capped at `KG_MAX_CONTEXT_ENTITIES`, edges at
 * `KG_MAX_GRAPH_EDGES` — extraction tokens stay bounded for generated /
 * megafiles.
 */
export async function saveCodebaseRelations(
	file: { filePath: string; owner: string; repo: string },
	db: SQLiteStore
): Promise<void> {
	const filePath = file.filePath;
	const repo = file.repo ?? "";
	if (!filePath || !repo) return;

	const now = new Date().toISOString();
	const owner = file.owner ?? "";

	// ── 1. This file's symbols → entities (type = symbol kind) ──
	let symbols: CodebaseSymbol[];
	try {
		symbols = db.codebaseSymbols.getSymbolsByFile(repo, filePath);
	} catch (err) {
		logger.warn("[KG-Archivist] Failed to read file symbols for codebase relations", {
			error: String(err),
			filePath
		});
		return;
	}

	// ── 2. Reference edges FROM this file → referenced symbols ──
	// Read refs BEFORE the both-empty guard: the enqueue gate
	// (indexing-writer.ts:245 `(symbols && symbols.length > 0) || (refs &&
	// refs.length > 0)`) deliberately enqueues files with references but zero
	// extracted symbols (entry-point scripts, side-effect-import files, setup
	// files), and codebaseSymbolJobPayload's docstring promises those caller
	// edges still reach the KG. Guarding on symbols alone silently dropped
	// every ref-only file's KG rows (TASK-339 / review F2).
	let refs: CodebaseReference[];
	try {
		refs = db.codebaseReferences.getReferencesByFile(repo, filePath);
	} catch (err) {
		logger.warn("[KG-Archivist] Failed to read references for codebase relations", {
			error: String(err),
			filePath
		});
		return;
	}

	// Both empty → nothing to write (extraction already handled concept-only
	// files; no symbols AND no refs means no signal at all).
	if (symbols.length === 0 && refs.length === 0) return;

	const typeByName = new Map(symbols.map((s) => [s.name, s.kind]));
	const observationTextValue = observationText("codebase", filePath);

	if (symbols.length > 0) {
		for (const symbol of symbols.slice(0, KG_MAX_CONTEXT_ENTITIES)) {
			try {
				// ensureObservation upserts entity + observation atomically, so a
				// concurrent orphan-sweep cannot delete the fresh entity between
				// the upsert and the insert (TASK-073 / MEM-482).
				db.knowledgeGraph.ensureObservation({
					id: randomUUID(),
					name: symbol.name,
					type: symbol.kind,
					description: null,
					observation: observationTextValue,
					repo,
					owner,
					created_at: now
				});
			} catch (err) {
				logger.warn("[KG-Archivist] Failed to save codebase symbol entity", {
					error: String(err),
					entity: symbol.name
				});
			}
		}
	}

	if (refs.length > 0) {
		// Resolve referenced-symbol types once per unique name (name-based,
		// ADR-002) instead of once per edge — bounded by the unique referenced
		// name count, not the edge count.
		const refTypeByName = new Map<string, string>();
		for (const ref of refs) {
			if (refTypeByName.has(ref.symbol_name)) continue;
			try {
				const target = db.codebaseSymbols.getSymbolByName(repo, ref.symbol_name)[0];
				refTypeByName.set(ref.symbol_name, target?.kind ?? "symbol");
			} catch {
				refTypeByName.set(ref.symbol_name, "symbol");
			}
		}

		for (const ref of refs.slice(0, KG_MAX_GRAPH_EDGES)) {
			const fromName = ref.caller_name ?? filePath;
			const fromType = typeByName.get(fromName) ?? "symbol";
			const toType = refTypeByName.get(ref.symbol_name) ?? "symbol";
			try {
				// ensureRelation upserts BOTH endpoints + the edge atomically
				// (TASK-073 / MEM-482); the target entity may live in another
				// file/repo and may have been orphan-swept.
				db.knowledgeGraph.ensureRelation({
					from_entity: fromName,
					from_type: fromType,
					to_entity: ref.symbol_name,
					to_type: toType,
					relation_type: ref.kind,
					repo,
					owner,
					created_at: now,
					confidence: KG_RELATION_CONFIDENCE_CODEBASE
				});
				db.knowledgeGraph.insertObservation({
					id: randomUUID(),
					entity_name: fromName,
					// Contract-format text (audit F12 / TASK-045): the old
					// free-form `"${kind} relation: A → B"` was unreachable by
					// every deleter (`deleteObservationsAndOrphans` matches on
					// `observationText(domain, title)`), so those rows leaked
					// forever and pinned their entities against the orphan sweep
					// — 18,275 rows (41% of the observations table) on a real
					// database, 938 entity/repo pairs existing ONLY through them.
					// The file-scoped text is also what `cleanStaleFiles` and the
					// rename path already delete, so caller edges now vanish with
					// their file.
					observation: observationTextValue,
					repo,
					owner,
					created_at: now
				});
			} catch (err) {
				logger.warn("[KG-Archivist] Failed to save codebase reference relation", {
					error: String(err),
					from: fromName,
					to: ref.symbol_name,
					kind: ref.kind
				});
			}
		}
	}
}
