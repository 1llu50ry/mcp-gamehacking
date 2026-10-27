/**
 * Shared SQL fragment builders for entity UPDATE statements (TASK-109).
 *
 * Every entity previously re-implemented the same update-clause loop:
 * whitelist columns → `"col = ?"` fields, JSON-serialize array/object keys,
 * coerce boolean keys to 0/1, exclude immutable keys. This module is the
 * single source of truth for that loop so serialization rules (tags/metadata
 * as JSON, is_global as 0/1) stay consistent across entities.
 *
 * Callers still append `updated_at = ?` and the id placeholder themselves so
 * single-id and bulk (id IN ...) update paths share the same clause.
 */
export interface BuildUpdateClauseOptions {
	/** Keys whose values are JSON-serialized (arrays/objects stored as JSON text). */
	jsonKeys?: ReadonlySet<string>;
	/** Keys whose boolean values are coerced to 0/1 integers. */
	intKeys?: ReadonlySet<string>;
	/** Keys never writable via UPDATE (e.g. id, created_at). */
	excludeKeys?: ReadonlySet<string>;
	/** Whitelist of writable columns; when absent, any key (minus exclusions) is allowed. */
	validColumns?: ReadonlySet<string>;
}

/**
 * Build the `SET` clause fields/values for an UPDATE statement from a partial
 * entity map. `undefined` values are skipped (no-op updates), matching the
 * pre-refactor behavior of every entity.
 *
 * @returns `{ fields, values }` — join fields with ", " and spread values
 *          before any WHERE-placeholder values.
 */
export function buildUpdateClause(
	updates: Record<string, unknown>,
	options: BuildUpdateClauseOptions = {}
): { fields: string[]; values: unknown[] } {
	const {
		jsonKeys = new Set<string>(),
		intKeys = new Set<string>(),
		excludeKeys = new Set<string>(),
		validColumns
	} = options;
	const fields: string[] = [];
	const values: unknown[] = [];

	for (const key of Object.keys(updates)) {
		const value = updates[key];
		if (value === undefined) continue;
		if (validColumns && !validColumns.has(key)) continue;
		if (excludeKeys.has(key)) continue;
		fields.push(`${key} = ?`);
		if (jsonKeys.has(key)) {
			values.push(JSON.stringify(value));
		} else if (intKeys.has(key)) {
			values.push(value ? 1 : 0);
		} else {
			values.push(value);
		}
	}

	return { fields, values };
}
