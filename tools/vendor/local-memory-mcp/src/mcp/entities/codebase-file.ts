import { BaseEntity } from "../storage/base";
import { CodebaseFile, CodebaseFileInsert } from "../types";
import { randomUUID } from "crypto";
import { chunksOf } from "../utils/chunk";
import { BULK_UPDATE_CHUNK_SIZE } from "../utils/constants";

/**
 * Persistence for `derived.codebase_files` rows. The table lives in the derived
 * database (schema `derived`), so every statement is schema-qualified.
 */
export class CodebaseFileEntity extends BaseEntity {
	upsertFile(file: CodebaseFileInsert): CodebaseFile {
		const now = new Date().toISOString();
		const id = randomUUID();

		// Single-statement upsert keyed by the unique (repo, file_path) index.
		// created_at is intentionally NOT in the DO UPDATE SET list, so it is
		// preserved on conflict. RETURNING * returns the exact stored row on both
		// insert (new id) and update (original id preserved).
		const row = this.get<CodebaseFile>(
			`INSERT INTO derived.codebase_files (id, repo, file_path, language, checksum, lines, size_bytes, last_indexed_at, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(repo, file_path) DO UPDATE SET
				language = excluded.language,
				checksum = excluded.checksum,
				lines = excluded.lines,
				size_bytes = excluded.size_bytes,
				last_indexed_at = excluded.last_indexed_at,
				updated_at = excluded.updated_at
			RETURNING *`,
			[
				id,
				file.repo,
				file.file_path,
				file.language ?? null,
				file.checksum ?? null,
				file.lines ?? 0,
				file.size_bytes ?? 0,
				now,
				now,
				now
			]
		);

		return row!;
	}

	getFile(repo: string, filePath: string): CodebaseFile | undefined {
		return this.get<CodebaseFile>("SELECT * FROM derived.codebase_files WHERE repo = ? AND file_path = ?", [
			repo,
			filePath
		]);
	}

	/**
	 * Batch existence read for a set of file paths (OPT-PERF-03 pattern —
	 * used by the embedding worker's codebase_symbol precheck, TASK-293).
	 * One IN(...) query replaces one getFile() per job in the claimed batch.
	 * Chunked at BULK_UPDATE_CHUNK_SIZE via the shared chunksOf helper so the
	 * bound-variable limit is never exceeded (TASK-139).
	 */
	getFilesByPaths(repo: string, filePaths: string[]): CodebaseFile[] {
		if (filePaths.length === 0) return [];
		const unique = [...new Set(filePaths)];
		const rows: CodebaseFile[] = [];
		for (const chunk of chunksOf(unique, BULK_UPDATE_CHUNK_SIZE)) {
			const placeholders = chunk.map(() => "?").join(",");
			rows.push(
				...this.all<CodebaseFile>(
					`SELECT * FROM derived.codebase_files WHERE repo = ? AND file_path IN (${placeholders})`,
					[repo, ...chunk]
				)
			);
		}
		return rows;
	}

	/**
	 * List files for a repo ordered by path.
	 *
	 * Default (full) mode returns complete `CodebaseFile` rows. Pass
	 * `{ slim: true }` to project only the columns staleness/planning need
	 * (`file_path`, `checksum`, `last_indexed_at` — see `CodebaseFileSlim`);
	 * the non-selected `CodebaseFile` fields are `undefined` on those rows, so
	 * slim results must only be used by callers that read that subset.
	 */
	getFilesByRepo(repo: string, opts?: { slim?: boolean }): CodebaseFile[] {
		if (opts?.slim) {
			return this.all<CodebaseFile>(
				"SELECT file_path, checksum, last_indexed_at FROM derived.codebase_files WHERE repo = ? ORDER BY file_path ASC",
				[repo]
			);
		}
		return this.all<CodebaseFile>("SELECT * FROM derived.codebase_files WHERE repo = ? ORDER BY file_path ASC", [repo]);
	}

	getFileCountByRepo(repo: string): number {
		const row = this.get<{ count: number }>("SELECT COUNT(*) as count FROM derived.codebase_files WHERE repo = ?", [
			repo
		]);
		return row?.count ?? 0;
	}

	getFilesByStatus(repo: string, status: string): CodebaseFile[] {
		if (status === "indexed") {
			return this.all<CodebaseFile>(
				"SELECT * FROM derived.codebase_files WHERE repo = ? AND last_indexed_at IS NOT NULL ORDER BY file_path ASC",
				[repo]
			);
		}
		if (status === "pending") {
			return this.all<CodebaseFile>(
				"SELECT * FROM derived.codebase_files WHERE repo = ? AND last_indexed_at IS NULL ORDER BY file_path ASC",
				[repo]
			);
		}
		return this.getFilesByRepo(repo);
	}

	deleteFile(repo: string, filePath: string): boolean {
		const result = this.run("DELETE FROM derived.codebase_files WHERE repo = ? AND file_path = ?", [repo, filePath]);
		return result.changes > 0;
	}

	transferFile(repo: string, oldPath: string, newPath: string): boolean {
		const now = new Date().toISOString();
		const result = this.run(
			`UPDATE derived.codebase_files SET file_path = ?, last_indexed_at = ?, updated_at = ?
			 WHERE repo = ? AND file_path = ?`,
			[newPath, now, now, repo, oldPath]
		);
		return result.changes > 0;
	}

	deleteFilesByRepo(repo: string): number {
		const result = this.run("DELETE FROM derived.codebase_files WHERE repo = ?", [repo]);
		return result.changes;
	}
}
