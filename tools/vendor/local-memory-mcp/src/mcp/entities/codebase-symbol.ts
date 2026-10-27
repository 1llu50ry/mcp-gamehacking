import { BaseEntity } from "../storage/base";
import {
	CodebaseSymbol,
	CodebaseSymbolRow,
	CodebaseSymbolInsert,
	SymbolCountGroupRow,
	SymbolSearchQuery,
	SymbolSearchResult,
	SymbolPrefixSearchQuery
} from "../types";
import { randomUUID } from "crypto";
import { sanitizeFtsTerm } from "../utils/fts";

export class CodebaseSymbolEntity extends BaseEntity {
	bulkUpsertSymbols(symbols: CodebaseSymbolInsert[]): number {
		return this.transaction(() => {
			const now = new Date().toISOString();
			const stmt = this.db.prepare(`
				INSERT INTO derived.codebase_symbols (
					id, repo, file_path, name, kind, exported, default_export,
					start_line, start_col, end_line, end_col, signature, doc_comment,
					parent_symbol_id, semantic_signature, semantic_source, semantic_updated_at, source_fingerprint,
					created_at, updated_at
				) VALUES (
					?, ?, ?, ?, ?, ?, ?,
					?, ?, ?, ?, ?, ?,
					?, ?, ?, ?, ?,
					?, ?
				)
			`);

			let count = 0;
			for (const sym of symbols) {
				// Pre-assigned ids (TASK-300 parent linking) are honored; legacy
				// callers without `id` keep the entity-generated UUID behavior.
				const id = sym.id ?? randomUUID();
				stmt.run(
					id,
					sym.repo,
					sym.file_path,
					sym.name,
					sym.kind,
					sym.exported ? 1 : 0,
					sym.default_export ? 1 : 0,
					sym.start_line ?? null,
					sym.start_col ?? null,
					sym.end_line ?? null,
					sym.end_col ?? null,
					sym.signature ?? null,
					sym.doc_comment ?? null,
					sym.parent_symbol_id ?? null,
					sym.semantic_signature ?? null,
					sym.semantic_source ?? null,
					sym.semantic_updated_at ?? null,
					sym.source_fingerprint ?? null,
					now,
					now
				);
				count++;
			}
			return count;
		});
	}

	/**
	 * Persist an incremental semantic-signature enrichment for a single symbol
	 * (issue #89, TASK-015). Used by the bounded two-phase enrichment pass AFTER
	 * structural indexing so the optional TS-compiler inference never blocks or
	 * overwrites the structural `signature`. Idempotent — safe to re-run on
	 * incremental re-index; only writes the inferred fields.
	 */
	updateSymbolSemantic(
		id: string,
		semanticSignature: string,
		semanticSource: string,
		semanticUpdatedAt: string = new Date().toISOString()
	): void {
		this.db
			.prepare(
				`UPDATE derived.codebase_symbols
				 SET semantic_signature = ?, semantic_source = ?, semantic_updated_at = ?, updated_at = ?
				 WHERE id = ?`
			)
			.run(semanticSignature, semanticSource, semanticUpdatedAt, semanticUpdatedAt, id);
	}

	getSymbolsByFile(repo: string, filePath: string): CodebaseSymbol[] {
		return this.all<CodebaseSymbolRow>(
			"SELECT * FROM derived.codebase_symbols WHERE repo = ? AND file_path = ? ORDER BY start_line ASC",
			[repo, filePath]
		).map((r) => this.rowToSymbol(r));
	}

	/**
	 * Exported symbols of one file (exported=1 OR default_export=1) — the
	 * canonical import-target surface (issue #83). Used by import-resolution
	 * to map an imported name to its same-file exported symbol; ordered by
	 * start line so the first default export wins deterministically.
	 */
	getExportedSymbolsByFile(repo: string, filePath: string): CodebaseSymbol[] {
		return this.all<CodebaseSymbolRow>(
			`SELECT * FROM derived.codebase_symbols
			 WHERE repo = ? AND file_path = ? AND (exported = 1 OR default_export = 1)
			 ORDER BY start_line ASC`,
			[repo, filePath]
		).map((r) => this.rowToSymbol(r));
	}

	getSymbolByName(repo: string, name: string): CodebaseSymbol[] {
		return this.all<CodebaseSymbolRow>(
			"SELECT * FROM derived.codebase_symbols WHERE repo = ? AND name = ? ORDER BY file_path ASC, start_line ASC",
			[repo, name]
		).map((r) => this.rowToSymbol(r));
	}

	searchSymbols(query: SymbolSearchQuery): SymbolSearchResult {
		const limit = Math.min(query.limit ?? 50, 200);
		const offset = query.offset ?? 0;

		// Try FTS5 first; only use if it returned actual results
		const ftsResult = this.tryFtsSearch(query, limit, offset);
		if (ftsResult && ftsResult.symbols.length > 0) return ftsResult;

		// Fallback to LIKE search
		return this.likeSearch(query, limit, offset);
	}

	/**
	 * Case-insensitive prefix search on symbol names (autocomplete), served by
	 * the idx_symbols_name_lower expression index (migration v20, issue #63).
	 *
	 * Consumption contract: the prefix is expressed as an EXCLUSIVE RANGE on
	 * the lowercased name — `LOWER(name) >= lower(prefix) AND LOWER(name) <
	 * lower(prefix) || X'...'` (upper bound = prefix + U+FFFF). The literal
	 * `LOWER(name) LIKE 'prefix%'` form is NOT used because SQLite's LIKE
	 * optimization requires a plain column (not an expression) on the
	 * left-hand side, so it falls back to a full table scan (verified on
	 * SQLite 3.53). The range form reports `USING INDEX
	 * idx_symbols_name_lower` in EXPLAIN QUERY PLAN. The trailing repo/kind
	 * predicates are covered by the composite index's trailing columns.
	 */
	searchByPrefix(query: SymbolPrefixSearchQuery): SymbolSearchResult {
		const limit = Math.min(query.limit ?? 50, 200);
		const offset = query.offset ?? 0;
		const prefix = (query.prefix ?? "").toLowerCase();
		// U+FFFF upper bound: the smallest string greater than every string
		// that starts with `prefix` for identifier-name characters (< U+FFFF).
		const prefixUpper = `${prefix}\uffff`;

		const conditions: string[] = ["LOWER(cs.name) >= ? AND LOWER(cs.name) < ?"];
		const params: unknown[] = [prefix, prefixUpper];

		if (query.kind) {
			conditions.push("cs.kind = ?");
			params.push(query.kind);
		}

		const whereClause = conditions.join(" AND ");

		const symbols = this.all<CodebaseSymbolRow>(
			`SELECT cs.* FROM derived.codebase_symbols cs
			 WHERE cs.repo = ? AND ${whereClause}
			 ORDER BY LOWER(cs.name) ASC LIMIT ? OFFSET ?`,
			[query.repo, ...params, limit, offset]
		).map((r) => this.rowToSymbol(r));

		const countRow = this.get<{ total: number }>(
			`SELECT COUNT(*) as total FROM derived.codebase_symbols cs WHERE cs.repo = ? AND ${whereClause}`,
			[query.repo, ...params]
		);

		const total = countRow?.total ?? symbols.length;
		return {
			symbols,
			total,
			hasMore: offset + limit < total
		};
	}

	deleteSymbolsByFile(repo: string, filePath: string): number {
		const result = this.run("DELETE FROM derived.codebase_symbols WHERE repo = ? AND file_path = ?", [repo, filePath]);
		return result.changes;
	}

	transferSymbolsFilePath(repo: string, oldPath: string, newPath: string): number {
		const now = new Date().toISOString();
		const result = this.run(
			`UPDATE derived.codebase_symbols SET file_path = ?, updated_at = ?
			 WHERE repo = ? AND file_path = ?`,
			[newPath, now, repo, oldPath]
		);
		return result.changes;
	}

	getSymbolsByRepo(repo: string, limit?: number): CodebaseSymbol[] {
		let sql = "SELECT * FROM derived.codebase_symbols WHERE repo = ? ORDER BY file_path ASC, start_line ASC";
		const params: (string | number)[] = [repo];
		if (limit !== undefined) {
			sql += " LIMIT ?";
			params.push(limit);
		}
		return this.all<CodebaseSymbolRow>(sql, params).map((r) => this.rowToSymbol(r));
	}

	getSymbolCountByRepo(repo: string): number {
		const row = this.get<{ count: number }>("SELECT COUNT(*) as count FROM derived.codebase_symbols WHERE repo = ?", [
			repo
		]);
		return row?.count ?? 0;
	}

	/**
	 * Symbol-kind counts per file for a repo, aggregated in SQL via
	 * `GROUP BY file_path, kind` (OPT-PERF-08). Used by ARCHITECTURE reads so
	 * per-file/per-directory symbol counts are derived from O(distinct
	 * file×kind pairs) rows instead of hydrating every symbol row.
	 */
	getSymbolCountsByRepoGrouped(repo: string): SymbolCountGroupRow[] {
		return this.all<SymbolCountGroupRow>(
			`SELECT file_path, kind, COUNT(*) as count
			 FROM derived.codebase_symbols
			 WHERE repo = ?
			 GROUP BY file_path, kind
			 ORDER BY file_path ASC, kind ASC`,
			[repo]
		);
	}

	/**
	 * Top-level exports for a repo (exported symbols with no parent), bounded
	 * by `limit` (OPT-PERF-08). Used by ARCHITECTURE reads instead of
	 * filtering the full symbol set in memory; the row count never exceeds
	 * `limit`, so the payload is constant regardless of repo symbol count.
	 */
	getTopLevelExportsByRepo(repo: string, limit: number): CodebaseSymbol[] {
		return this.all<CodebaseSymbolRow>(
			`SELECT * FROM derived.codebase_symbols
			 WHERE repo = ? AND exported = 1 AND parent_symbol_id IS NULL
			 ORDER BY file_path ASC, start_line ASC
			 LIMIT ?`,
			[repo, limit]
		).map((r) => this.rowToSymbol(r));
	}

	/**
	 * Top-level symbols for a repo (parent_symbol_id IS NULL — exported OR
	 * internal), bounded by `limit` (TASK-319 dead-code candidate scan).
	 *
	 * Dead-code candidates are deliberately restricted to top-level symbols:
	 * members (methods/fields) share names across containers, so name-based
	 * reference rows (ADR-002) aggregate same-name members and would both
	 * hide truly-unused members and over-report used ones — top-level names
	 * are trustworthy under the name-based model, and the pool is a small
	 * fraction of the repo's total symbol count. Index-served by the
	 * (repo, exported, parent_symbol_id) prefix of idx_cs_repo_exported_parent.
	 */
	getTopLevelSymbolsByRepo(repo: string, limit: number): CodebaseSymbol[] {
		return this.all<CodebaseSymbolRow>(
			`SELECT * FROM derived.codebase_symbols
			 WHERE repo = ? AND parent_symbol_id IS NULL
			 ORDER BY file_path ASC, start_line ASC
			 LIMIT ?`,
			[repo, limit]
		).map((r) => this.rowToSymbol(r));
	}

	getAllSymbols(limit?: number): CodebaseSymbol[] {
		let sql = "SELECT * FROM derived.codebase_symbols ORDER BY repo ASC, file_path ASC, start_line ASC";
		const params: (string | number)[] = [];
		if (limit !== undefined) {
			sql += " LIMIT ?";
			params.push(limit);
		}
		return this.all<CodebaseSymbolRow>(sql, params).map((r) => this.rowToSymbol(r));
	}

	deleteSymbolsByRepo(repo: string): number {
		const result = this.run("DELETE FROM derived.codebase_symbols WHERE repo = ?", [repo]);
		return result.changes;
	}

	private tryFtsSearch(query: SymbolSearchQuery, limit: number, offset: number): SymbolSearchResult | null {
		try {
			// The full query is sanitized here (FTS5 metacharacters stripped, no
			// wildcards). The v18 FTS5 index covers name, doc_comment AND
			// signature, so a MATCH on the whole table row is enough — no
			// per-column MATCH needed. Signature tokens are therefore sanitized
			// through the same sanitizeFtsTerm() path as name/doc_comment.
			const safeTerm = sanitizeFtsTerm(query.query);
			if (!safeTerm) return null;

			// FTS5 MATCH cannot be schema-qualified (`derived.x MATCH ?` is read
			// as schema.table and rejected), so the derived FTS table is invoked
			// as a table-valued function with the match term as its first bound
			// parameter — the verified cross-schema form (TASK-037).
			const conditions: string[] = [];
			const params: unknown[] = [safeTerm];

			if (query.repos && query.repos.length > 0) {
				const placeholders = query.repos.map(() => "?").join(", ");
				conditions.push(`cs.repo IN (${placeholders})`);
				params.push(...query.repos);
			} else if (query.repo) {
				conditions.push("cs.repo = ?");
				params.push(query.repo);
			}
			if (query.kind) {
				if (Array.isArray(query.kind) && query.kind.length > 0) {
					const placeholders = query.kind.map(() => "?").join(", ");
					conditions.push(`cs.kind IN (${placeholders})`);
					params.push(...query.kind);
				} else if (typeof query.kind === "string") {
					conditions.push("cs.kind = ?");
					params.push(query.kind);
				}
			}
			if (query.filePath) {
				conditions.push("cs.file_path = ?");
				params.push(query.filePath);
			}
			if (query.exportedOnly) {
				conditions.push("cs.exported = 1");
			}

			// Single-pass results + unpaged total (issue #75 / OPT-PERF). A
			// window function `COUNT(*) OVER ()` runs without any PARTITION so it
			// counts across the FULL matched row set BEFORE LIMIT/OFFSET, and
			// every returned row carries that count. The hot path therefore needs
			// only ONE query instead of a separate results query + standalone
			// COUNT query.
			const sql = `
				SELECT cs.*, rank, COUNT(*) OVER () AS total_count
				FROM derived.codebase_symbols_fts(?) fts
				JOIN derived.codebase_symbols cs ON cs.rowid = fts.rowid
				WHERE ${conditions.length > 0 ? conditions.join(" AND ") : "1 = 1"}
				ORDER BY rank
				LIMIT ? OFFSET ?
			`;
			params.push(limit, offset);

			const rows = this.all<CodebaseSymbolRow & { rank: number; total_count: number }>(sql, params);
			const symbols = rows.map((r) => this.rowToSymbol(r));

			// Empty FTS pages are never returned: searchSymbols falls back to
			// likeSearch (which computes the authoritative total) whenever this
			// page has zero rows, so the total here is only ever read from a
			// non-empty page where the window function materializes it. A
			// standalone COUNT fallback would be discarded work.
			const total = rows[0]?.total_count ?? 0;
			return {
				symbols,
				total,
				hasMore: offset + limit < total
			};
		} catch {
			return null;
		}
	}

	private likeSearch(query: SymbolSearchQuery, limit: number, offset: number): SymbolSearchResult {
		const likeTerm = `%${query.query}%`;
		// signature is included for parity with the FTS5 tier (v18): a symbol
		// findable by its signature token via FTS stays findable via the LIKE
		// fallback (e.g. when sanitizeFtsTerm produces an empty MATCH term).
		const conditions: string[] = [
			"(cs.name LIKE ? OR cs.doc_comment LIKE ? OR cs.file_path LIKE ? OR cs.signature LIKE ?)"
		];
		const params: unknown[] = [likeTerm, likeTerm, likeTerm, likeTerm];

		if (query.repos && query.repos.length > 0) {
			const placeholders = query.repos.map(() => "?").join(", ");
			conditions.push(`cs.repo IN (${placeholders})`);
			params.push(...query.repos);
		} else if (query.repo) {
			conditions.push("cs.repo = ?");
			params.push(query.repo);
		}
		if (query.kind) {
			if (Array.isArray(query.kind) && query.kind.length > 0) {
				const placeholders = query.kind.map(() => "?").join(", ");
				conditions.push(`cs.kind IN (${placeholders})`);
				params.push(...query.kind);
			} else if (typeof query.kind === "string") {
				conditions.push("cs.kind = ?");
				params.push(query.kind);
			}
		}
		if (query.filePath) {
			conditions.push("cs.file_path = ?");
			params.push(query.filePath);
		}
		if (query.exportedOnly) {
			conditions.push("cs.exported = 1");
		}

		const whereClause = conditions.join(" AND ");

		const symbols = this.all<CodebaseSymbolRow>(
			`SELECT cs.* FROM derived.codebase_symbols cs WHERE ${whereClause} ORDER BY cs.name ASC LIMIT ? OFFSET ?`,
			[...params, limit, offset]
		).map((r) => this.rowToSymbol(r));

		const countRow = this.get<{ total: number }>(
			`SELECT COUNT(*) as total FROM derived.codebase_symbols cs WHERE ${whereClause}`,
			params
		);

		const total = countRow?.total ?? symbols.length;
		return {
			symbols,
			total,
			hasMore: offset + limit < total
		};
	}
}
