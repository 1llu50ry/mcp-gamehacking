/**
 * FileDiscoveryService — walks a directory tree, discovers source files,
 * and filters according to gitignore rules and glob patterns.
 *
 * Pure-function style (matching soul-maintenance.ts pattern):
 * the `discoverFiles` function accepts options and returns a result.
 */

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import fg from "fast-glob";
import ignoreLib from "ignore";
import { logger } from "../../utils/logger";
import type { DiscoveredFile, DiscoverFilesResult, DiscoveryError, FileDiscoveryOptions } from "../types";

// ── Unreadable-directory handling (FIX-031) ───────────────────────────

/**
 * Errno codes that mean a directory could not be read. On a real filesystem
 * many directories are legitimately unreadable (protected dotfiles, sockets,
 * root-owned paths, or a directory removed mid-walk). None of these should
 * abort discovery — the directory is skipped and reported in the summary.
 */
const UNREADABLE_DIR_ERRNO: ReadonlySet<string> = new Set(["EACCES", "EPERM", "ENOENT"]);

/** True when a `readdir` failure means "skip this directory", not "fail the scan". */
function isUnreadableDirError(error: NodeJS.ErrnoException | null | undefined): boolean {
	return error != null && typeof error.code === "string" && UNREADABLE_DIR_ERRNO.has(error.code);
}

/**
 * Collects the distinct absolute paths of directories skipped because they
 * could not be read. Deduplicated across the gitignore scan, the main walk,
 * and the allowlisted dot-directory walk.
 */
class SkippedDirectoryTracker {
	private readonly paths = new Set<string>();

	record(directoryPath: string): void {
		this.paths.add(directoryPath);
	}

	get count(): number {
		return this.paths.size;
	}

	/** Sorted, root-relative paths for the discovery summary. */
	relativePaths(root: string): string[] {
		return [...this.paths].map((p) => path.relative(root, p) || p).sort();
	}
}

/**
 * Build a fast-glob file-system adapter that intercepts directory reads and
 * records any directory that cannot be read (EACCES/EPERM/ENOENT), while
 * forwarding the error unchanged so fast-glob's `suppressErrors` handling
 * still skips it. The adapter is the only place a `readdir` failure is
 * observed, so the discovery summary can report skipped dirs instead of
 * surfacing per-path errors (FIX-031).
 */
function createScanFsAdapter(tracker: SkippedDirectoryTracker): Partial<fg.FileSystemAdapter> {
	const readdir = ((directory: string, arg1: unknown, arg2?: unknown): void => {
		const options = typeof arg1 === "function" ? undefined : (arg1 as fs.ObjectEncodingOptions);
		const callback = (typeof arg1 === "function" ? arg1 : arg2) as (
			error: NodeJS.ErrnoException | null,
			files: unknown
		) => void;
		fs.readdir(directory, options, (error, files) => {
			if (isUnreadableDirError(error)) tracker.record(directory);
			callback(error, files);
		});
	}) as fg.FileSystemAdapter["readdir"];

	const readdirSync = ((directory: string, options?: unknown): unknown => {
		try {
			return fs.readdirSync(directory, options as fs.ObjectEncodingOptions);
		} catch (error) {
			if (isUnreadableDirError(error as NodeJS.ErrnoException)) tracker.record(directory);
			throw error;
		}
	}) as fg.FileSystemAdapter["readdirSync"];

	return { readdir, readdirSync };
}

// ── Language detection ────────────────────────────────────────────────

/** File extension → language identifier mapping. */
const EXTENSION_LANGUAGE_MAP: Record<string, string> = Object.freeze({
	// TypeScript / JavaScript (tree-sitter)
	".ts": "typescript",
	".mts": "typescript",
	".cts": "typescript",
	".tsx": "typescriptreact",
	".js": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".jsx": "javascriptreact",
	".vue": "vue",
	".svelte": "svelte",
	".astro": "astro",
	// Markdown
	".md": "markdown",
	".mdx": "markdown",
	// Tree-sitter languages
	".py": "python",
	".php": "php",
	".go": "go",
	".rs": "rust",
	".java": "java",
	".rb": "ruby",
	".kt": "kotlin",
	".kts": "kotlin",
	".swift": "swift",
	".dart": "dart",
	".c": "c",
	".h": "c",
	".cpp": "cpp",
	".cc": "cpp",
	".cxx": "cpp",
	".hpp": "cpp",
	".hh": "cpp",
	".hxx": "cpp",
	// Web (generic)
	".html": "html",
	".htm": "html",
	".xhtml": "html",
	".css": "css",
	".scss": "scss",
	".sass": "sass",
	".less": "less",
	// Config & Data (generic)
	".json": "json",
	".yaml": "yaml",
	".yml": "yaml",
	".toml": "toml",
	".ini": "ini",
	".cfg": "ini",
	".conf": "ini",
	".env": "env",
	".xml": "xml",
	".svg": "xml",
	// Shell & Scripts (generic)
	".sh": "shellscript",
	".bash": "shellscript",
	".zsh": "shellscript",
	".fish": "shellscript",
	".ps1": "powershell",
	".bat": "batch",
	".cmd": "batch",
	// Backend / Scripting (generic)
	".scala": "scala",
	".cs": "csharp",
	".fs": "fsharp",
	".zig": "zig",
	".erl": "erlang",
	".ex": "elixir",
	".exs": "elixir",
	".clj": "clojure",
	".lua": "lua",
	".pl": "perl",
	".pm": "perl",
	".t": "perl",
	".r": "r",
	".jl": "julia",
	// Native / Mobile (generic)
	".m": "objectivec",
	".mm": "objectivecpp",
	// Templates (generic)
	".ejs": "ejs",
	".hbs": "handlebars",
	".mustache": "mustache",
	".njk": "nunjucks",
	".pug": "pug",
	".haml": "haml",
	".liquid": "liquid",
	".twig": "twig",
	".razor": "razor",
	".latte": "latte",
	".smarty": "smarty",
	".tpl": "smarty",
	// Framework-specific (generic)
	".webc": "webc",
	".wxp": "wxp",
	".wxt": "wxt",
	// GraphQL
	".graphql": "graphql",
	".gql": "graphql",
	// Protocol (generic)
	".proto": "protobuf",
	".thrift": "thrift",
	// Database
	".sql": "sql",
	// Apple plist / Xcode
	".plist": "plist",
	".xib": "xib",
	".storyboard": "storyboard",
	".pbxproj": "pbxproj",
	".xcconfig": "xcconfig",
	".entitlements": "entitlements",
	// Gradle
	".gradle": "gradle",
	// Docs
	".tex": "latex",
	".bib": "bibtex",
	".rst": "restructuredtext",
	".asciidoc": "asciidoc",
	".adoc": "asciidoc",
	// Misc
	".dockerfile": "dockerfile",
	".lock": "lockfile"
});

// ── Non-source extension exclusion (FIX-030) ──────────────────────────

/**
 * Extensions that are NOT indexable source and are never parseable by the
 * tree-sitter pool (`.sql`/`.lock`/`.env`/`.dockerfile`). They are excluded
 * at discovery time so the parser never sees them — previously discovery
 * admitted them (the language map below still NAMES them for the dashboard's
 * non-indexed file view), and every one produced an
 * `Unsupported extension: .sql` parse failure. Excluded files are counted in
 * `skippedByExtension`, the same counter used for unknown extensions.
 */
export const EXCLUDED_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([".sql", ".lock", ".env", ".dockerfile"]);

/** True when the path carries a known non-source extension (FIX-030). */
export function isExcludedSourceFile(filePath: string): boolean {
	return EXCLUDED_SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Map a file extension to a language identifier.
 * Returns `null` for unsupported extensions (file should be skipped).
 *
 * Exported (TASK-324): the dashboard file-content endpoint reuses this for
 * NON-indexed files (no codebase_files row to carry `language`); indexed
 * files keep the row's stored language as the authoritative value.
 *
 * NOTE (FIX-030): this is a pure NAMING map — it does not decide indexability.
 * Discovery additionally applies {@link EXCLUDED_SOURCE_EXTENSIONS} so
 * non-source extensions are skipped rather than handed to the parser.
 */
export function detectLanguage(filePath: string): string | null {
	const ext = path.extname(filePath).toLowerCase();
	if (!ext) {
		// Handle extensionless files like "Dockerfile", "Makefile"
		const basename = path.basename(filePath).toLowerCase();
		if (basename === "dockerfile") return "dockerfile";
		if (basename === "makefile") return "makefile";
		if (basename === "justfile") return "justfile";
		if (basename === "containerfile") return "dockerfile";
		return null;
	}
	return EXTENSION_LANGUAGE_MAP[ext] ?? null;
}

// ── Default patterns ──────────────────────────────────────────────────

/** Directories / globs always excluded from discovery. */
const DEFAULT_EXCLUDE_PATTERNS: readonly string[] = Object.freeze([
	"**/node_modules/**",
	"**/.git/**",
	"**/dist/**",
	"**/.next/**",
	"**/build/**",
	"**/coverage/**",
	"**/__pycache__/**",
	"**/.venv/**",
	"**/vendor/**",
	"**/target/**",
	"**/.DS_Store"
]);

/** Dot-directories explicitly allowlisted — discovered via a second dot:true stream. */
const ALLOWED_DOT_DIRS: readonly string[] = Object.freeze([".agents"]);

// ── Nested .gitignore collection ──────────────────────────────────────

/**
 * Recursively locate all `.gitignore` files under `root`, sorted by
 * directory depth (parent before child) so the `ignore` library
 * applies overrides correctly.
 *
 * ASYNC (M5, FEAT-DAEMON-002 review step 4): this previously used `fg.sync`,
 * a SYNCHRONOUS full-tree walk that blocked the event loop during a full index
 * (the main `fg.stream` enumeration was already async). It now uses the async
 * `fg` API — the SAME glob, options, and depth sort — so the file set and
 * ordering are unchanged.
 */
async function findGitignoreFiles(root: string, tracker: SkippedDirectoryTracker): Promise<string[]> {
	try {
		const files: string[] = await fg("**/.gitignore", {
			cwd: root,
			dot: true,
			absolute: false,
			onlyFiles: true,
			// A permission-denied child directory (e.g. a root-owned dir under a
			// home tree) must be SKIPPED, not abort the whole walk. Without this,
			// fast-glob rethrows EACCES from `scandir`, `discoverFiles` rejects,
			// the index never completes, and `last_indexed_at` is never recorded —
			// which made the watcher re-trigger the walk forever.
			suppressErrors: true,
			// Record unreadable dirs (EACCES/EPERM/ENOENT) in the summary instead
			// of surfacing them as per-path errors (FIX-031).
			fs: createScanFsAdapter(tracker),
			ignore: ["**/node_modules/**", "**/.git/**"]
		});
		// Sort by depth: root first, then shallow descendents, then deeper
		files.sort((a, b) => a.split("/").length - b.split("/").length);
		return files;
	} catch {
		return [];
	}
}

/**
 * Git determines whether a pattern is "anchored" (matches only relative
 * to the .gitignore directory) by the presence of a non-trailing `/`
 * or a leading `/`.
 *
 * We transform each pattern's scope so the root-aware `ignore` library
 * correctly applies it from the project root. Anchored patterns get
 * `scopePrefix/pattern`; unanchored become `scopePrefix/**&#47;pattern`.
 *
 * Negation (`!`) and directory-only trailing `/` are preserved.
 */
function transformGitignorePatterns(content: string, scopePrefix: string): string[] {
	const output: string[] = [];
	for (const rawLine of content.split("\n")) {
		const line = rawLine.trim();
		// Skip blanks and comments
		if (line === "" || line.startsWith("#")) continue;

		let isNegation = false;
		let pattern = line;
		if (line.startsWith("!")) {
			isNegation = true;
			pattern = line.slice(1).trim();
			if (pattern === "") continue; // bare "!" — skip
		}

		// git determines anchoring by presence of a non-trailing `/`
		// or a leading `/` (which we strip before scoping).
		const withoutTrailing = pattern.replace(/\/+$/, "");
		const isAnchored = withoutTrailing.includes("/") || pattern.startsWith("/");

		const clean = pattern.startsWith("/") ? pattern.slice(1) : pattern;

		let scoped: string;
		if (isAnchored) {
			scoped = scopePrefix ? `${scopePrefix}/${clean}` : clean;
		} else {
			scoped = scopePrefix ? `${scopePrefix}/**/${clean}` : `**/${clean}`;
		}

		// Preserve trailing `/` for directory-only patterns
		if (pattern.endsWith("/") && !scoped.endsWith("/")) {
			scoped += "/";
		}

		output.push(isNegation ? `!${scoped}` : scoped);
	}
	return output;
}

/**
 * Walk the repository to discover every `.gitignore` file (root + nested),
 * parse their rules, scope patterns correctly, and return a flat array of
 * root-relative ignore patterns ready for the `ignore` library.
 *
 * ASYNC (M5, FEAT-DAEMON-002 review step 4): the walk (`fg`) and the per-file
 * reads (`fs.promises.readFile`) are both asynchronous so a full index never
 * blocks the main event loop on the gitignore scan. The pattern output is
 * byte-identical to the former synchronous implementation.
 *
 * @returns All gitignore patterns across the repo, parent-before-child ordered.
 */
async function collectAllGitignoreRules(root: string, tracker: SkippedDirectoryTracker): Promise<string[]> {
	const files = await findGitignoreFiles(root, tracker);
	const allPatterns: string[] = [];

	for (const relativePath of files) {
		const scope = path.posix.dirname(relativePath);
		const scopePrefix = scope === "." ? "" : scope;
		const absPath = path.join(root, relativePath);
		let content: string;
		try {
			content = await fs.promises.readFile(absPath, "utf-8");
		} catch {
			continue;
		}
		const scoped = transformGitignorePatterns(content, scopePrefix);
		allPatterns.push(...scoped);
	}

	return allPatterns;
}

// ── Service implementation ────────────────────────────────────────────

/**
 * Interface exposed by the file discovery service.
 * (Defined here for discoverability; consumers import the function directly.)
 */
export interface FileDiscoveryService {
	discoverFiles(options: FileDiscoveryOptions): Promise<DiscoverFilesResult>;
}

/**
 * Walk a directory tree, discover source files, and filter according to
 * gitignore rules and glob patterns.
 *
 * @returns Sorted, deterministic list of discovered files with metadata.
 */
export async function discoverFiles(options: FileDiscoveryOptions): Promise<DiscoverFilesResult> {
	const startTime = performance.now();
	const errors: DiscoveryError[] = [];
	const { projectPath, includeGlobs, excludeGlobs = [], respectGitignore = true, maxFiles } = options;

	// Resolve projectPath to an absolute, normalized path
	const root = path.resolve(projectPath);

	// Tracks directories skipped because they could not be read (FIX-031).
	// Shared across the gitignore scan and both walk streams so a directory
	// unreadable in any phase is reported exactly once.
	const skippedDirTracker = new SkippedDirectoryTracker();

	// ── Parse .gitignore (root + nested) ──────────────────────────
	let gitignoreFilter: ReturnType<typeof ignoreLib> | null = null;
	if (respectGitignore) {
		const allPatterns = await collectAllGitignoreRules(root, skippedDirTracker);
		if (allPatterns.length > 0) {
			gitignoreFilter = ignoreLib().add(allPatterns as unknown as string);
			logger.debug("[FileDiscovery] Parsed .gitignore files", {
				patternCount: allPatterns.length
			});
		} else {
			logger.debug("[FileDiscovery] No .gitignore found — using defaults only");
		}
	}

	// ── Build fast-glob patterns ──────────────────────────────────
	// fast-glob handles glob matching (include + exclude) natively.
	// We pass includeGlobs as patterns and excludeGlobs as ignore.
	// This avoids needing a secondary glob library.
	const globPatterns = includeGlobs && includeGlobs.length > 0 ? includeGlobs : ["**/*"];

	// Combine default + user-specified exclude patterns
	const allExcludeGlobs = [...DEFAULT_EXCLUDE_PATTERNS, ...excludeGlobs];

	const stream = fg.stream(globPatterns, {
		cwd: root,
		absolute: true,
		dot: false,
		onlyFiles: true,
		stats: true,
		followSymbolicLinks: false,
		// Skip permission-denied directories instead of rejecting the walk (see
		// findGitignoreFiles). The index must complete so `last_indexed_at` is
		// recorded and the watcher stops retrying. The fs adapter records each
		// unreadable dir in the discovery summary (FIX-031).
		suppressErrors: true,
		fs: createScanFsAdapter(skippedDirTracker),
		ignore: allExcludeGlobs
	});

	// ── Iterate stream ────────────────────────────────────────────
	const discovered: DiscoveredFile[] = [];
	let totalFiles = 0;
	let supportedFiles = 0;
	let skippedFiles = 0;
	let skippedByExtension = 0;
	let skippedByGitignore = 0;

	for await (const entry of stream) {
		totalFiles++;
		const item = entry as unknown as { path: string; stats: fs.Stats; dirent: fs.Dirent };
		const absolutePath = item.path;

		try {
			// 1. Skip symlinks (safety check — fast-glob already filters with onlyFiles)
			if (item.dirent.isSymbolicLink()) {
				skippedFiles++;
				continue;
			}

			const relativePath = path.relative(root, absolutePath);

			// 2. Check gitignore rules
			if (gitignoreFilter && gitignoreFilter.ignores(relativePath)) {
				skippedFiles++;
				skippedByGitignore++;
				continue;
			}

			// 3. Skip known non-source extensions (.sql/.lock/.env/.dockerfile)
			//    before language detection so the parser never receives them
			//    (FIX-030). Counted as extension skips.
			if (isExcludedSourceFile(relativePath)) {
				skippedFiles++;
				skippedByExtension++;
				continue;
			}

			// 4. Detect language — skip unsupported extensions
			const language = detectLanguage(relativePath);
			if (language === null) {
				skippedFiles++;
				skippedByExtension++;
				continue;
			}

			discovered.push({
				path: relativePath,
				absolutePath,
				language,
				sizeBytes: item.stats.size,
				mtimeMs: item.stats.mtimeMs
			});
			supportedFiles++;

			// 5. Early exit if maxFiles limit reached
			if (maxFiles !== undefined && discovered.length >= maxFiles) {
				break;
			}
		} catch (err) {
			skippedFiles++;
			const message = err instanceof Error ? err.message : String(err);
			errors.push({
				path: absolutePath,
				error: message
			});
		}
	}

	// ── Allowlisted dot-directory stream (.agents) ───────────────
	// Main stream uses dot:false so dot-directories are skipped. Run a
	// second targeted stream with dot:true over ALLOWED_DOT_DIRS only, then
	// merge results before the deterministic sort. Other dot dirs (.git,
	// .github, .opencode, .cache, …) remain excluded via dot:false on the
	// main stream and DEFAULT_EXCLUDE_PATTERNS.
	if (ALLOWED_DOT_DIRS.length > 0) {
		const allowedDotPatterns = ALLOWED_DOT_DIRS.map((dir) => `**/${dir}/**`);
		const dotStream = fg.stream(allowedDotPatterns, {
			cwd: root,
			absolute: true,
			dot: true,
			onlyFiles: true,
			stats: true,
			followSymbolicLinks: false,
			suppressErrors: true,
			fs: createScanFsAdapter(skippedDirTracker),
			ignore: allExcludeGlobs
		});

		for await (const entry of dotStream) {
			// Respect global maxFiles cap across both streams
			if (maxFiles !== undefined && discovered.length >= maxFiles) {
				break;
			}
			totalFiles++;
			const item = entry as unknown as { path: string; stats: fs.Stats; dirent: fs.Dirent };
			const absolutePath = item.path;

			try {
				if (item.dirent.isSymbolicLink()) {
					skippedFiles++;
					continue;
				}

				const relativePath = path.relative(root, absolutePath);

				if (gitignoreFilter && gitignoreFilter.ignores(relativePath)) {
					skippedFiles++;
					skippedByGitignore++;
					continue;
				}

				// Non-source extensions (.sql/.lock/.env/.dockerfile) are skipped
				// here too — the dot-directory stream shares the filter (FIX-030).
				if (isExcludedSourceFile(relativePath)) {
					skippedFiles++;
					skippedByExtension++;
					continue;
				}

				const language = detectLanguage(relativePath);
				if (language === null) {
					skippedFiles++;
					skippedByExtension++;
					continue;
				}

				discovered.push({
					path: relativePath,
					absolutePath,
					language,
					sizeBytes: item.stats.size,
					mtimeMs: item.stats.mtimeMs
				});
				supportedFiles++;
			} catch (err) {
				skippedFiles++;
				const message = err instanceof Error ? err.message : String(err);
				errors.push({
					path: absolutePath,
					error: message
				});
			}
		}
	}

	// ── Sort for deterministic output ─────────────────────────────
	discovered.sort((a, b) => a.path.localeCompare(b.path));

	const durationMs = Math.round(performance.now() - startTime);

	// Directories skipped because they could not be read (FIX-031). Reported
	// in the summary; never surfaced as per-path errors and never abort the scan.
	const skippedDirectories = skippedDirTracker.relativePaths(root);

	logger.info("[FileDiscovery] Discovery complete", {
		projectPath: root,
		totalFiles,
		supportedFiles,
		skippedFiles,
		skippedByExtension,
		skippedByGitignore,
		skippedDirectories: skippedDirectories.length,
		durationMs,
		errorCount: errors.length
	});

	return {
		files: discovered,
		totalFiles,
		supportedFiles,
		skippedFiles,
		skippedByExtension,
		skippedByGitignore,
		skippedDirectories,
		durationMs,
		errors
	};
}
