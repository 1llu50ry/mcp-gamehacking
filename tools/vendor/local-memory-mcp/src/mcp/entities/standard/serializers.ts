import { CodingStandardEntry } from "../../types";

/**
 * Single source of truth for the coding_standards INSERT statement
 * (TASK-108) — shared by insert() and bulkInsertStandards() so a column
 * change is made in exactly one place.
 */
export function buildStandardInsert(entry: CodingStandardEntry): { sql: string; params: unknown[] } {
	return {
		sql: `INSERT INTO coding_standards (
			id, code, title, content, parent_id, context, version, language, stack,
			is_global, owner, repo, tags, metadata, created_at, updated_at, hit_count, last_used_at, agent, model
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		params: [
			entry.id,
			entry.code ?? null,
			entry.title,
			entry.content,
			entry.parent_id,
			entry.context,
			entry.version,
			entry.language ?? null,
			entry.stack.length > 0 ? JSON.stringify(entry.stack) : null,
			entry.is_global ? 1 : 0,
			entry.owner ?? "",
			entry.repo ?? null,
			entry.tags.length > 0 ? JSON.stringify(entry.tags) : null,
			Object.keys(entry.metadata).length > 0 ? JSON.stringify(entry.metadata) : null,
			entry.created_at,
			entry.updated_at,
			entry.hit_count,
			entry.last_used_at,
			entry.agent,
			entry.model
		]
	};
}

/**
 * Pre-serialize stack/tags/metadata for the shared update-clause builder
 * (TASK-109), preserving the exact pre-refactor guards: arrays and objects
 * are JSON-serialized, anything else passes through raw. is_global
 * coercion and the id/created_at exclusion are handled by builder options.
 */
export function buildStandardUpdateMap(updates: Partial<CodingStandardEntry>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(updates)) {
		if (value === undefined) continue;
		if ((key === "stack" || key === "tags") && Array.isArray(value)) {
			result[key] = JSON.stringify(value);
		} else if (key === "metadata" && typeof value === "object" && value !== null) {
			result[key] = JSON.stringify(value);
		} else {
			result[key] = value;
		}
	}
	return result;
}
