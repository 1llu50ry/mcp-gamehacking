/**
 * Codebase Index — shared types for file discovery and indexing.
 */

/** A discovered source file with metadata. */
export interface DiscoveredFile {
	/** Relative path from project root (e.g. "src/mcp/server.ts"). */
	path: string;
	/** Absolute file-system path. */
	absolutePath: string;
	/** Language identifier (e.g. "typescript", "javascript", "markdown"). */
	language: string;
	/** File size in bytes. */
	sizeBytes: number;
	/**
	 * File modification time in epoch milliseconds (from fast-glob stats).
	 * Used as a free pre-filter: a file whose mtime is <= its last_indexed_at
	 * is content-unchanged and can skip readFile + checksum entirely.
	 */
	mtimeMs: number;
}

/** Options controlling which files are discovered. */
export interface FileDiscoveryOptions {
	/** Absolute path to the project root to scan. */
	projectPath: string;
	/**
	 * Include-only glob patterns.
	 * When specified, only files matching at least one pattern are included.
	 * Patterns are matched against the relative path (from projectPath).
	 * Example: ["**\/*.ts", "**\/*.tsx"]
	 */
	includeGlobs?: string[];
	/**
	 * Extra exclude glob patterns applied AFTER gitignore rules.
	 * Default exclude patterns (`node_modules`, `.git`, `dist`, etc.) are
	 * always applied regardless of this option.
	 */
	excludeGlobs?: string[];
	/**
	 * If true, the `.gitignore` file at `projectPath` is parsed and its rules
	 * are applied. Defaults to true.
	 */
	respectGitignore?: boolean;
	/**
	 * Maximum number of source files to discover before stopping the scan.
	 * Useful for capping memory usage on very large repositories.
	 * When omitted, all matching files are discovered.
	 */
	maxFiles?: number;
}

/** Aggregate result from a discovery run. */
export interface DiscoverFilesResult {
	/** Discovered files that passed all filters, sorted by path. */
	files: DiscoveredFile[];
	/** Total number of file-system entries found by the glob scan. */
	totalFiles: number;
	/** Files that matched a supported language and passed all filters. */
	supportedFiles: number;
	/** Files skipped (symlinks, unsupported extensions, gitignore/exclude matches, errors). */
	skippedFiles: number;
	/** Files skipped due to unsupported extension (no language detection). */
	skippedByExtension: number;
	/** Files skipped due to gitignore rule match. */
	skippedByGitignore: number;
	/**
	 * Root-relative paths of directories skipped because they could not be
	 * read (EACCES/EPERM/ENOENT). Discovery continues past them; this is the
	 * skip summary, not an error list (FIX-031).
	 */
	skippedDirectories: string[];
	/** Wall-clock duration of the discovery in milliseconds. */
	durationMs: number;
	/** Non-fatal per-file errors (e.g. permission denied). */
	errors: DiscoveryError[];
}

/** A non-fatal error encountered while walking a specific path. */
export interface DiscoveryError {
	/** The path that caused the error. */
	path: string;
	/** Human-readable error message. */
	error: string;
}
