import { BaseEntity } from "../storage/base";
import {
	CodebaseReference,
	CodebaseReferenceInsert,
	CodebaseReferenceRow,
	SymbolReferenceCounts,
	TopReferencedSymbolRow
} from "../types";
import { randomUUID } from "crypto";

/**
 * CodebaseReferenceEntity — persistence for reference edge rows
 * (migration v21 call-site edges, issue #64 / TASK-236; migrated to generalized
 * edge table with target_file/target_symbol_id in v23, TASK-299).
 *
 * Mirrors the CodebaseSymbolEntity persistence pattern: bulk upsert (insert →
 * replace-by-file is the caller's job), delete-by-file (the indexing writer
 * deletes a re-parsed file's refs then bulk-inserts the fresh set inside the
 * same batch transaction), and read-by-symbol for traceSymbol.
 *
 * The table is keyed by `caller_file` (the file HOLDING the call / heritage
 * site), not `file_path`, so all delete/transfer helpers operate on
 * `caller_file`.
 */
export class CodebaseReferenceEntity extends BaseEntity {
	bulkUpsertReferences(repo: string, refs: CodebaseReferenceInsert[]): number {
		return this.transaction(() => {
			const now = new Date().toISOString();
			const stmt = this.db.prepare(`
				INSERT INTO derived.codebase_references (
					id, repo, symbol_name, caller_file, caller_line, caller_name, kind,
					target_file, target_symbol_id, role,
					local_name, imported_name, module_specifier, import_kind, created_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`);

			let count = 0;
			for (const r of refs) {
				stmt.run(
					randomUUID(),
					r.repo,
					r.symbol_name,
					r.caller_file,
					r.caller_line ?? null,
					r.caller_name ?? null,
					r.kind,
					r.target_file ?? null,
					r.target_symbol_id ?? null,
					r.role ?? null,
					r.local_name ?? null,
					r.imported_name ?? null,
					r.module_specifier ?? null,
					r.import_kind ?? null,
					now
				);
				count++;
			}
			return count;
		});
	}

	getReferencesByFile(repo: string, filePath: string): CodebaseReference[] {
		return this.all<CodebaseReferenceRow>(
			"SELECT * FROM derived.codebase_references WHERE repo = ? AND caller_file = ? ORDER BY caller_line ASC, symbol_name ASC",
			[repo, filePath]
		).map((r) => this.rowToReference(r));
	}

	/** All call sites for a symbol within a repo (serves traceSymbol). */
	getReferencesBySymbol(repo: string, symbolName: string): CodebaseReference[] {
		return this.all<CodebaseReferenceRow>(
			"SELECT * FROM derived.codebase_references WHERE repo = ? AND symbol_name = ? ORDER BY caller_file ASC, caller_line ASC",
			[repo, symbolName]
		).map((r) => this.rowToReference(r));
	}

	/**
	 * 'import' reference rows for a resolved module target (issue #83) — the
	 * inverse of getReferencesBySymbol: given a repo-relative target file,
	 * return the import edges that point AT it (target_file resolved at parse
	 * time). Served by the (repo, caller_file) index prefix when `callerFile`
	 * is provided; without it the kind filter is a cheap row scan (import
	 * rows are a small fraction of a repo's reference set).
	 */
	getImportsByTargetFile(repo: string, targetFile: string, callerFile?: string): CodebaseReference[] {
		if (callerFile) {
			return this.all<CodebaseReferenceRow>(
				`SELECT * FROM derived.codebase_references
				 WHERE repo = ? AND caller_file = ? AND kind = 'import' AND target_file = ?
				 ORDER BY caller_line ASC`,
				[repo, callerFile, targetFile]
			).map((r) => this.rowToReference(r));
		}
		return this.all<CodebaseReferenceRow>(
			`SELECT * FROM derived.codebase_references
			 WHERE repo = ? AND kind = 'import' AND target_file = ?
			 ORDER BY caller_file ASC, caller_line ASC`,
			[repo, targetFile]
		).map((r) => this.rowToReference(r));
	}

	/**
	 * ALL reference rows for a repo (TASK-324 code-graph edge assembly).
	 *
	 * Served by the (repo, caller_file) index prefix (idx_refs_repo_file) with
	 * the same ordering — the graph service filters by kind in memory because
	 * no (repo, kind) index exists (deliberate v23 stance; a kind-filtered
	 * query would scan, not seek). Optional `kinds` narrows the set before
	 * hydration (cheap row filter, still index-served by the repo prefix).
	 */
	getReferencesByRepo(repo: string, kinds?: string[]): CodebaseReference[] {
		if (kinds && kinds.length > 0) {
			const placeholders = kinds.map(() => "?").join(", ");
			return this.all<CodebaseReferenceRow>(
				`SELECT * FROM derived.codebase_references
				 WHERE repo = ? AND kind IN (${placeholders})
				 ORDER BY caller_file ASC, caller_line ASC, symbol_name ASC`,
				[repo, ...kinds]
			).map((r) => this.rowToReference(r));
		}
		return this.all<CodebaseReferenceRow>(
			"SELECT * FROM derived.codebase_references WHERE repo = ? ORDER BY caller_file ASC, caller_line ASC, symbol_name ASC",
			[repo]
		).map((r) => this.rowToReference(r));
	}

	/**
	 * Reference-row counts for a SET of symbol names (TASK-319 dead-code).
	 *
	 * Aggregates `GROUP BY symbol_name, kind` served by idx_refs_repo_symbol —
	 * one bounded query instead of N `getReferencesBySymbol` calls. A symbol
	 * absent from the returned map has ZERO reference rows of every kind ⇒
	 * dead-code candidate. Names are sent in IN-clause chunks of 500 so a
	 * large candidate pool never trips SQLite's variable limit.
	 */
	countReferencesBySymbol(repo: string, symbolNames: string[]): Map<string, SymbolReferenceCounts> {
		const counts = new Map<string, SymbolReferenceCounts>();
		const CHUNK = 500;
		for (let i = 0; i < symbolNames.length; i += CHUNK) {
			const chunk = symbolNames.slice(i, i + CHUNK);
			const placeholders = chunk.map(() => "?").join(", ");
			const rows = this.all<{ symbol_name: string; kind: string; count: number }>(
				`SELECT symbol_name, kind, COUNT(*) as count
				 FROM derived.codebase_references
				 WHERE repo = ? AND symbol_name IN (${placeholders})
				 GROUP BY symbol_name, kind
				 ORDER BY symbol_name ASC, kind ASC`,
				[repo, ...chunk]
			);
			for (const row of rows) {
				let entry = counts.get(row.symbol_name);
				if (!entry) {
					entry = { total: 0, countsByKind: {} };
					counts.set(row.symbol_name, entry);
				}
				entry.total += row.count;
				entry.countsByKind[row.kind] = row.count;
			}
		}
		return counts;
	}

	/**
	 * Top-N referenced symbol names by total reference count (TASK-319
	 * hotspots). Aggregates `GROUP BY symbol_name, kind` for the whole repo
	 * (bounded by distinct symbol×kind pairs — the OPT-PERF-08 discipline),
	 * sums per kind, sorts by total DESC, slices to `limit`.
	 */
	getTopReferencedSymbols(repo: string, limit: number): TopReferencedSymbolRow[] {
		const rows = this.all<{ symbol_name: string; kind: string; count: number }>(
			`SELECT symbol_name, kind, COUNT(*) as count
			 FROM derived.codebase_references
			 WHERE repo = ?
			 GROUP BY symbol_name, kind`,
			[repo]
		);
		const byName = new Map<string, SymbolReferenceCounts>();
		for (const row of rows) {
			let entry = byName.get(row.symbol_name);
			if (!entry) {
				entry = { total: 0, countsByKind: {} };
				byName.set(row.symbol_name, entry);
			}
			entry.total += row.count;
			entry.countsByKind[row.kind] = (entry.countsByKind[row.kind] ?? 0) + row.count;
		}
		return [...byName.entries()]
			.map(([symbol_name, counts]) => ({ symbol_name, ...counts }))
			.sort((a, b) => b.total - a.total || a.symbol_name.localeCompare(b.symbol_name))
			.slice(0, limit);
	}

	/**
	 * Total reference rows for a repo (cheap COUNT — the honesty gate for
	 * dead-code analysis: zero rows means no language evidence exists in this
	 * index, so candidate claims would be garbage).
	 */
	countReferencesByRepo(repo: string): number {
		const row = this.get<{ count: number }>(
			"SELECT COUNT(*) as count FROM derived.codebase_references WHERE repo = ?",
			[repo]
		);
		return row?.count ?? 0;
	}

	/**
	 * Languages that OBSERVED reference emission in this repo's index
	 * (TASK-319 language honesty). Joins reference caller files back to
	 * derived.codebase_files: a language appears here only when at least one of its
	 * indexed files produced reference rows — proof the emitter ran for that
	 * language in the CURRENT index (vs an index that predates reference
	 * emission, where zero refs would lie).
	 */
	getReferenceLanguagesByRepo(repo: string): string[] {
		return this.all<{ language: string }>(
			`SELECT DISTINCT f.language
			 FROM derived.codebase_references r
			 JOIN derived.codebase_files f ON f.repo = r.repo AND f.file_path = r.caller_file
			 WHERE r.repo = ? AND f.language IS NOT NULL
			 ORDER BY f.language ASC`,
			[repo]
		).map((r) => r.language);
	}

	deleteReferencesByFile(repo: string, filePath: string): number {
		const result = this.run("DELETE FROM derived.codebase_references WHERE repo = ? AND caller_file = ?", [
			repo,
			filePath
		]);
		return result.changes;
	}

	transferReferencesFilePath(repo: string, oldPath: string, newPath: string): number {
		const result = this.run(
			`UPDATE derived.codebase_references SET caller_file = ?
			 WHERE repo = ? AND caller_file = ?`,
			[newPath, repo, oldPath]
		);
		return result.changes;
	}

	deleteReferencesByRepo(repo: string): number {
		const result = this.run("DELETE FROM derived.codebase_references WHERE repo = ?", [repo]);
		return result.changes;
	}

	private rowToReference(row: CodebaseReferenceRow): CodebaseReference {
		return {
			id: row.id,
			repo: row.repo,
			symbol_name: row.symbol_name,
			caller_file: row.caller_file,
			caller_line: row.caller_line,
			caller_name: row.caller_name,
			kind: row.kind,
			target_file: row.target_file,
			target_symbol_id: row.target_symbol_id,
			role: row.role ?? null,
			local_name: row.local_name ?? null,
			imported_name: row.imported_name ?? null,
			module_specifier: row.module_specifier ?? null,
			import_kind: row.import_kind ?? null,
			created_at: row.created_at
		};
	}
}
