/**
 * Defensive free-text `key:value` tag extraction for search queries (TASK-443).
 *
 * Models that don't comply with structured Zod params can still get correct
 * filtering by embedding `key:value` tags inside the free-text `query` string
 * (e.g. `auth language:php stack:laravel tag:a,b`). This module extracts those
 * tags into a structured `filters` object and returns the *cleaned* residual
 * query with the tags stripped.
 *
 * Why strip the tags: the FTS sanitizer (utils/fts.ts) replaces `:` with a
 * space, so an un-stripped `language:php` would become the spurious keywords
 * `language` + `php` and pollute lexical/vector ranking. Stripping the residual
 * query prevents that.
 *
 * Behaviour:
 * - Whitespace tokenization; a `key:value` token whose key (lower-cased) is NOT
 *   in the keyMap stays verbatim in the residual query (unknown keys like
 *   `label:ddd` are treated as plain text).
 * - Array entries split the value on `,` into a deduped string[].
 * - Scalar entries take the first comma-part.
 * - Boolean entries parse `true`/`1` → true and `false`/`0` → false.
 * - Scope-nested keys (`scope:true` or a dotted `param` like `scope.language`)
 *   are collected into a single `filters.scope` object.
 *
 * Dependency-free: no new packages.
 */

export type KeyMapEntry = {
	/** Target filter field. May be dotted (e.g. `scope.language`) to nest. */
	param: string;
	/** Split value on `,` into a string[] (deduped across tokens). */
	array?: boolean;
	/** Restrict this tag to a specific mode (informational for the caller). */
	mode?: "CODE" | "SYMBOL";
	/** Key the owner/repo-style scope fields under `filters.scope`. */
	scope?: boolean;
	/** Parse the value as a boolean (true/1 → true, false/0 → false). */
	bool?: boolean;
};

export type KeyMap = Record<string, KeyMapEntry>;

export interface ParsedTagQuery {
	/** Residual query with all recognized `key:value` tags removed. */
	query: string;
	/** Extracted structured filters (arrays unioned, scope nested). */
	filters: Record<string, unknown>;
}

/** Set a value at a dotted path inside a nested object, creating intermediates. */
function setNestedPath(target: Record<string, unknown>, path: string[], value: unknown): void {
	let cur = target;
	for (let i = 0; i < path.length - 1; i++) {
		const seg = path[i]!;
		const existing = cur[seg];
		if (typeof existing !== "object" || existing === null) {
			const next: Record<string, unknown> = {};
			cur[seg] = next;
			cur = next;
		} else {
			cur = existing as Record<string, unknown>;
		}
	}
	cur[path[path.length - 1]!] = value;
}

/** Union + dedupe an arbitrary number of string lists (preserves first-seen order). */
export function unionStrings(...lists: Array<string[] | undefined>): string[] {
	const out: string[] = [];
	for (const list of lists) {
		if (!list) continue;
		for (const item of list) {
			if (item && !out.includes(item)) out.push(item);
		}
	}
	return out;
}

/**
 * Parse `key:value` tags out of a free-text query.
 *
 * @param raw    The raw query string (may be empty).
 * @param keyMap Maps lower-cased tag keys → how to map them to a filter.
 * @returns `{ query: cleanedResidual, filters }`.
 */
export function parseTaggedQuery(raw: string, keyMap: KeyMap): ParsedTagQuery {
	if (!raw || !raw.trim()) {
		return { query: (raw ?? "").trim(), filters: {} };
	}

	const residualTokens: string[] = [];
	const filters: Record<string, unknown> = {};
	const arrays = new Map<string, string[]>();

	for (const token of raw.split(/\s+/)) {
		if (!token) continue;

		const match = /^([a-zA-Z_]+):(.+)$/.exec(token);
		if (!match) {
			residualTokens.push(token);
			continue;
		}

		const key = match[1]!.toLowerCase();
		const entry = keyMap[key];
		if (!entry) {
			// Unknown tag key → leave as plain text in the residual query.
			residualTokens.push(token);
			continue;
		}

		const value = match[2]!;
		const parts = value
			.split(",")
			.map((p) => p.trim())
			.filter((p) => p.length > 0);

		if (entry.array) {
			const collected = arrays.get(entry.param) ?? [];
			for (const p of parts) {
				if (!collected.includes(p)) collected.push(p);
			}
			arrays.set(entry.param, collected);
			continue;
		}

		if (entry.bool) {
			const first = parts[0] ?? "";
			filters[entry.param] = first === "true" || first === "1";
			continue;
		}

		// Scalar (possibly nested under a scope object).
		const scalar = parts[0];
		if (entry.scope) {
			// scope:true entries are keyed by the original tag key (owner/repo).
			setNestedPath(filters, ["scope", key], scalar);
		} else if (entry.param.includes(".")) {
			setNestedPath(filters, entry.param.split("."), scalar);
		} else {
			filters[entry.param] = scalar;
		}
	}

	// Flush collected arrays into filters (last, so arrays win over any scalar).
	for (const [param, arr] of arrays) {
		filters[param] = arr;
	}

	return { query: residualTokens.join(" ").trim(), filters };
}

// ── Per-tool tag key maps (derived from the REAL Zod schemas) ───────────────

export const STANDARD_READ_TAG_KEYS: KeyMap = {
	language: { param: "language" },
	lang: { param: "language" },
	framework: { param: "stack", array: true },
	stack: { param: "stack", array: true },
	tag: { param: "tags", array: true },
	tags: { param: "tags", array: true },
	context: { param: "context" },
	version: { param: "version" },
	is_global: { param: "is_global", bool: true },
	owner: { param: "scope", scope: true },
	repo: { param: "scope", scope: true }
};

export const MEMORY_READ_TAG_KEYS: KeyMap = {
	tag: { param: "current_tags", array: true },
	tags: { param: "current_tags", array: true },
	lang: { param: "scope.language" },
	language: { param: "scope.language" },
	branch: { param: "scope.branch" },
	folder: { param: "scope.folder" },
	path: { param: "current_file_path" },
	owner: { param: "scope", scope: true },
	repo: { param: "scope", scope: true }
};

export const CODEBASE_READ_TAG_KEYS: KeyMap = {
	language: { param: "language", mode: "CODE" },
	lang: { param: "language", mode: "CODE" },
	kind: { param: "kind", array: true, mode: "SYMBOL" },
	file: { param: "filePath" },
	path: { param: "filePath" }
};
