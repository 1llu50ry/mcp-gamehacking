export interface CodebaseFile {
	id: string;
	repo: string;
	file_path: string;
	language: string | null;
	checksum: string | null;
	lines: number;
	size_bytes: number;
	last_indexed_at: string | null;
	created_at: string;
	updated_at: string;
}

/**
 * The minimal column subset staleness/planning need from codebase_files.
 *
 * Produced by `getFilesByRepo(repo, { slim: true })` so the planner and the
 * staleness check avoid hydrating the full `CodebaseFile` (id, language,
 * lines, size_bytes, timestamps) just to compare paths/checksums.
 */
export type CodebaseFileSlim = Pick<CodebaseFile, "file_path" | "checksum" | "last_indexed_at">;

export interface CodebaseFileInsert {
	repo: string;
	file_path: string;
	language?: string | null;
	checksum?: string | null;
	lines?: number;
	size_bytes?: number;
}
