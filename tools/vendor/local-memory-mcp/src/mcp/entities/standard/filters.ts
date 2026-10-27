import { sanitizeFtsTerm } from "../../utils/fts";

/**
 * Shared filter-option shape for the non-FTS and FTS search/count paths.
 * Every public search/count entry point passes a (sub)set of these fields.
 */
export interface StandardFilterOptions {
	query?: string;
	context?: string;
	version?: string;
	language?: string;
	stack?: string;
	tag?: string;
	owner?: string;
	repo?: string;
	is_global?: boolean;
	limit?: number;
	offset?: number;
}

/**
 * Shared WHERE-clause builder for the non-FTS search/count paths.
 * `query` maps to the LIKE fallback used by both search() and count()
 * when FTS is unavailable or throws.
 */
export function buildNonFtsFilters(options: StandardFilterOptions): {
	clauses: string[];
	params: (string | number | null)[];
} {
	const { query, context, version, language, stack, tag, owner, repo, is_global } = options;
	const clauses: string[] = [];
	const params: (string | number | null)[] = [];

	if (query) {
		clauses.push("(title LIKE ? OR content LIKE ? OR context LIKE ?)");
		params.push(`%${query}%`, `%${query}%`, `%${query}%`);
	}
	if (context) {
		clauses.push("context = ?");
		params.push(context);
	}
	if (version) {
		clauses.push("version = ?");
		params.push(version);
	}
	if (language) {
		clauses.push("language = ?");
		params.push(language);
	}
	if (stack) {
		// Indexed child-table equality (OPT-PERF-07) — replaces the
		// `stack LIKE '%stack%'` scan on the stack JSON text column.
		clauses.push("EXISTS (SELECT 1 FROM standard_stack s WHERE s.standard_id = coding_standards.id AND s.stack = ?)");
		params.push(stack);
	}
	if (tag) {
		clauses.push("EXISTS (SELECT 1 FROM standard_tags t WHERE t.standard_id = coding_standards.id AND t.tag = ?)");
		params.push(tag);
	}
	if (repo !== undefined) {
		if (owner !== undefined) {
			clauses.push("((owner = ? AND repo = ?) OR is_global = 1)");
			params.push(owner, repo);
		} else {
			clauses.push("(repo = ? OR is_global = 1)");
			params.push(repo);
		}
	}
	if (is_global !== undefined) {
		clauses.push("is_global = ?");
		params.push(is_global ? 1 : 0);
	}

	return { clauses, params };
}

/**
 * Shared WHERE-clause builder for the FTS search/count paths (alias-aware:
 * `cs` refers to the joined coding_standards row, matching ftsSearch).
 * Throws when the sanitized query yields no usable FTS5 term so callers
 * fall back to the LIKE path — identical to the pre-refactor behavior.
 */
export function buildFtsFilters(options: StandardFilterOptions): {
	conditions: string[];
	params: unknown[];
} {
	const { query, context, version, language, stack, tag, owner, repo, is_global } = options;

	const safeTerm = sanitizeFtsTerm(query ?? "");
	if (!safeTerm) throw new Error("Invalid FTS5 query");

	const conditions: string[] = ["coding_standards_fts MATCH ?"];
	const params: unknown[] = [safeTerm];

	if (context) {
		conditions.push("cs.context = ?");
		params.push(context);
	}
	if (version) {
		conditions.push("cs.version = ?");
		params.push(version);
	}
	if (language) {
		conditions.push("cs.language = ?");
		params.push(language);
	}
	if (stack) {
		// Indexed child-table equality (OPT-PERF-07), alias-aware for the
		// FTS join (cs.id) — replaces `cs.stack LIKE`.
		conditions.push("EXISTS (SELECT 1 FROM standard_stack s WHERE s.standard_id = cs.id AND s.stack = ?)");
		params.push(stack);
	}
	if (tag) {
		conditions.push("EXISTS (SELECT 1 FROM standard_tags t WHERE t.standard_id = cs.id AND t.tag = ?)");
		params.push(tag);
	}
	if (repo !== undefined) {
		if (owner !== undefined) {
			conditions.push("((cs.owner = ? AND cs.repo = ?) OR cs.is_global = 1)");
			params.push(owner, repo);
		} else {
			conditions.push("(cs.repo = ? OR cs.is_global = 1)");
			params.push(repo);
		}
	}
	if (is_global !== undefined) {
		conditions.push("cs.is_global = ?");
		params.push(is_global ? 1 : 0);
	}

	return { conditions, params };
}
