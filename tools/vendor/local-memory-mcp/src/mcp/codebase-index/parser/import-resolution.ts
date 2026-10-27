/**
 * import-resolution — parse-time import → canonical target resolution (issue
 * #83, TASK-009, semantic-graph epic P0).
 *
 * Given a module specifier written in an import statement plus the caller
 * file + the repo's indexed symbol surface, resolve the CANONICAL target of
 * the import: the file (`targetFile`) and — for named/default imports — the
 * same-file exported symbol (`targetSymbolId`).
 *
 * Resolution strategy (name-based per ADR-002 — no LSP, no TypeScript API at
 * parse time; the index itself is the only authority):
 *
 *   1. MODULE → FILE
 *        a. Relative specifiers (`./user`, `../shared/helper`): resolve
 *           against the caller file's directory, then apply the extension /
 *           index / barrel fallbacks.
 *        b. tsconfig `baseUrl` + `paths` (TS-style, JSON5-tolerant parse):
 *           the longest matching `paths` pattern wins; `*` in the pattern
 *           substitutes the matched wildcard segment.
 *        c. Bare specifiers with no match → unresolved (null).
 *      File lookup is done against a caller-supplied indexed-files set (the
 *      repo's codebase_files paths), so only files that are ACTUALLY INDEXED
 *      can become targets — an import into an unindexed file stays null.
 *
 *   2. FILE → EXPORTED SYMBOL (named/default imports only)
 *        a. Named: the same-file exported symbol whose name equals the
 *           IMPORTED name (the name as written in the module — NOT the local
 *           alias).
 *        b. Default: the same-file default-exported symbol.
 *        c. Namespace / side-effect: the file resolves but no symbol — the
 *           edge carries targetFile only (null targetSymbolId).
 *
 * Failure is silent and total: `resolveImport` NEVER throws — every
 * resolution miss degrades to `{ targetFile: null, targetSymbolId: null }`
 * and the import row is still persisted (acceptance: unresolved imports stay
 * VISIBLE with null targets; rows are never dropped).
 */

import type { CodebaseSymbol, ImportResolution } from "../../types";

// ── Module-to-file resolution ──────────────────────────────────────────────

/** Candidate extensions appended to extension-less relative/path-alias targets, in order. */
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".d.ts"];

/** Index files tried when a specifier points at a directory (barrel resolution). */
const INDEX_FILES = ["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs", "index.cjs", "index.d.ts"];

/** A tsconfig `paths` entry — sorted longest-pattern-first. */
export interface TsconfigPaths {
	baseUrl: string | null;
	patterns: Array<{ pattern: string; targets: string[] }>;
}

/**
 * Parse a tsconfig/jsconfig body with JSON5 tolerance (comments + trailing
 * commas) but WITHOUT a JSON5 dependency — a small character scanner that
 * strips line comments, block comments and trailing commas. Non-parseable
 * input yields `null` (callers degrade to relative-only resolution).
 */
export function parseTsconfigJson5(raw: string): TsconfigPaths | null {
	try {
		const cleaned = stripJson5CommentsAndTrailingCommas(raw);
		const parsed = JSON.parse(cleaned) as {
			compilerOptions?: {
				baseUrl?: string;
				paths?: Record<string, string | string[]>;
			};
		};
		const baseUrl = parsed.compilerOptions?.baseUrl ?? null;
		const rawPaths = parsed.compilerOptions?.paths ?? {};
		const patterns: Array<{ pattern: string; targets: string[] }> = [];
		for (const [pattern, targets] of Object.entries(rawPaths)) {
			const list = Array.isArray(targets) ? targets : [targets];
			const cleanTargets = list.filter((t): t is string => typeof t === "string" && t.length > 0);
			if (cleanTargets.length > 0) patterns.push({ pattern, targets: cleanTargets });
		}
		// Longest pattern first — the first match wins (TS semantics).
		patterns.sort((a, b) => b.pattern.length - a.pattern.length);
		return { baseUrl, patterns };
	} catch {
		return null;
	}
}

/** Strip line/block comments + trailing commas from a JSON5-ish string (string-aware). */
export function stripJson5CommentsAndTrailingCommas(src: string): string {
	let out = "";
	let inString = false;
	let inLineComment = false;
	let inBlockComment = false;
	let i = 0;
	while (i < src.length) {
		const ch = src[i];
		const next = src[i + 1];
		if (inLineComment) {
			if (ch === "\n") {
				inLineComment = false;
				out += ch;
			}
			i++;
			continue;
		}
		if (inBlockComment) {
			if (ch === "*" && next === "/") {
				inBlockComment = false;
				i += 2;
			} else {
				i++;
			}
			continue;
		}
		if (inString) {
			out += ch;
			if (ch === "\\" && next) {
				out += next;
				i += 2;
				continue;
			}
			if (ch === '"') inString = false;
			i++;
			continue;
		}
		if (ch === '"') {
			inString = true;
			out += ch;
			i++;
			continue;
		}
		if (ch === "/" && next === "/") {
			inLineComment = true;
			i += 2;
			continue;
		}
		if (ch === "/" && next === "*") {
			inBlockComment = true;
			i += 2;
			continue;
		}
		if (ch === ",") {
			// Trailing comma: drop it when the next non-whitespace is a closing bracket.
			let j = i + 1;
			while (j < src.length && /\s/.test(src[j])) j++;
			if (src[j] === "}" || src[j] === "]") {
				i++;
				continue;
			}
		}
		out += ch;
		i++;
	}
	return out;
}

/**
 * Try to match a specifier against tsconfig `paths` patterns (longest first).
 * Returns the substituted target path(s) in tsconfig-space (relative to
 * baseUrl) or null when no pattern matches.
 */
function matchPathsPatterns(specifier: string, paths: TsconfigPaths): string[] | null {
	for (const { pattern, targets } of paths.patterns) {
		const starIdx = pattern.indexOf("*");
		if (starIdx === -1) {
			if (specifier === pattern) return targets;
			continue;
		}
		const prefix = pattern.slice(0, starIdx);
		const suffix = pattern.slice(starIdx + 1);
		if (
			specifier.startsWith(prefix) &&
			specifier.endsWith(suffix) &&
			specifier.length >= prefix.length + suffix.length
		) {
			const wildcard = specifier.slice(prefix.length, specifier.length - suffix.length);
			return targets.map((t) => t.replace("*", wildcard));
		}
	}
	return null;
}

/**
 * Normalize a repo-relative path: collapse `.` segments, resolve `..`
 * segments against the remaining stack, and drop empty/duplicate slashes.
 * `src/./user` → `src/user`; `src/a/../user` → `src/user`. The result has no
 * leading `./` and no trailing slash.
 */
function normalizeTargetPath(target: string): string {
	const stack: string[] = [];
	for (const seg of target.split("/")) {
		if (!seg || seg === ".") continue;
		if (seg === "..") {
			stack.pop();
			continue;
		}
		stack.push(seg);
	}
	return stack.join("/");
}

/**
 * Resolve a module specifier to a repo-relative indexed file path.
 *
 * Returns null when the specifier cannot be mapped to an INDEXED file. Never
 * throws. `callerFile` may be "" (visitor-only tests) — relative specifiers
 * then resolve against the repo root and are only kept when they map to an
 * indexed file (a bare `./user` from an unknown caller stays null).
 */
export function resolveModuleToFile(
	specifier: string,
	callerFile: string,
	indexedFiles: ReadonlySet<string>,
	tsconfig: TsconfigPaths | null
): string | null {
	const spec = specifier.trim();
	if (!spec) return null;

	// ── 1. Relative specifiers: `./user`, `../shared/helper` ──
	if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") {
		if (!callerFile) return null; // no caller context — cannot resolve
		const dir = callerFile.includes("/") ? callerFile.slice(0, callerFile.lastIndexOf("/")) : "";
		// `./user` from src/app.ts → `src/./user` → normalize → `src/user`.
		const joined = dir ? `${dir}/${spec}` : spec;
		return resolveWithFallbacks(joined, indexedFiles);
	}

	// ── 2. tsconfig baseUrl / paths aliases: `@/domain/user`, `~lib/foo` ──
	if (tsconfig) {
		const matched = matchPathsPatterns(spec, tsconfig);
		if (matched && matched.length > 0) {
			for (const target of matched) {
				const base = tsconfig.baseUrl ? `${tsconfig.baseUrl}/${target}` : target;
				const normalized = normalizeTargetPath(base);
				const resolved = resolveWithFallbacks(normalized, indexedFiles);
				if (resolved) return resolved;
			}
		}
		if (tsconfig.baseUrl && !spec.startsWith(".")) {
			// Bare non-aliased specifiers are also probed against baseUrl
			// (`import 'utils/helper'` with baseUrl "src" → src/utils/helper.ts).
			const normalized = normalizeTargetPath(`${tsconfig.baseUrl}/${spec}`);
			const resolved = resolveWithFallbacks(normalized, indexedFiles);
			if (resolved) return resolved;
		}
	}

	// ── 3. Bare package specifier (`react`, `lodash/fp`): probe the
	//    node_modules-free indexed set directly (monorepo workspace packages
	//    and root-relative dirs), then give up. ──
	const direct = resolveWithFallbacks(spec, indexedFiles);
	if (direct) return direct;

	return null;
}

/**
 * Apply the extension / index / package-main fallbacks to a repo-relative
 * path and return the first form present in `indexedFiles`.
 */
function resolveWithFallbacks(path: string, indexedFiles: ReadonlySet<string>): string | null {
	const normalized = normalizeTargetPath(path);
	if (indexedFiles.has(normalized)) return normalized;

	// `./user` → `./user.ts`, `./user.tsx`, `./user.js`, …
	for (const ext of EXTENSIONS) {
		if (indexedFiles.has(normalized + ext)) return normalized + ext;
	}

	// `./user` → `./user/index.ts` (barrel / directory import)
	for (const indexFile of INDEX_FILES) {
		if (indexedFiles.has(`${normalized}/${indexFile}`)) return `${normalized}/${indexFile}`;
	}

	// `./user` → `./user/package.json`: when the package.json IS indexed
	// (rare), the `main`/`module` field is NOT consulted — its value lives in
	// file content, not the index, and resolution stays synchronous + DB-only.
	// The package dir itself therefore stays unresolved (documented limitation
	// of the synchronous, index-only resolver).
	const pkgPath = `${normalized}/package.json`;
	if (indexedFiles.has(pkgPath)) {
		return null;
	}

	return null;
}

// ── Symbol-target resolution ───────────────────────────────────────────────

/**
 * Resolve the canonical exported symbol of an imported name within a file.
 *
 * `importedName` is the name AS WRITTEN in the module (the `User` of
 * `import { User as DomainUser }`); for default imports the caller passes
 * `"default"` and the file's default export is matched. Namespace and
 * side-effect imports pass `null` → no symbol (file-only resolution).
 */
export function findExportTarget(
	filePath: string,
	importedName: string | null,
	symbolsByFile: Map<string, CodebaseSymbol[]>
): { targetFile: string; targetSymbolId: string | null } | null {
	const fileSymbols = symbolsByFile.get(filePath);
	if (!fileSymbols || fileSymbols.length === 0) return { targetFile: filePath, targetSymbolId: null };

	if (importedName === null) {
		// Namespace / side-effect: the module resolves, the symbol does not.
		return { targetFile: filePath, targetSymbolId: null };
	}
	if (importedName === "default") {
		const def = fileSymbols.find((s) => s.default_export === true);
		return def ? { targetFile: filePath, targetSymbolId: def.id } : { targetFile: filePath, targetSymbolId: null };
	}
	// Named import: the symbol must be EXPORTED (per the import contract) —
	// unexported same-name symbols are not importable and do not qualify.
	const named = fileSymbols.find((s) => s.name === importedName && s.exported === true);
	return named ? { targetFile: filePath, targetSymbolId: named.id } : { targetFile: filePath, targetSymbolId: null };
}

// ── Composite resolution ───────────────────────────────────────────────────

/**
 * Resolve an import to its canonical target (file + symbol id).
 *
 * @param specifier     raw module specifier (`'@/domain/user'`, `'./user'`)
 * @param callerFile    repo-relative path of the importing file ("" in
 *                      visitor-only unit tests → path aliases resolve against
 *                      the repo root, relative specifiers stay unresolved)
 * @param indexedFiles  repo-relative paths of ALL indexed files (codebase_files)
 * @param symbolsByFile same-file symbol lookup (repo's codebase_symbols,
 *                      grouped by file_path)
 * @param tsconfig      parsed tsconfig baseUrl/paths, or null
 *
 * Never throws. Every miss degrades to nulls — the import row is still
 * persisted (unresolved imports stay visible with null targets, issue #83).
 */
export function resolveImport(
	specifier: string,
	callerFile: string,
	indexedFiles: ReadonlySet<string>,
	symbolsByFile: Map<string, CodebaseSymbol[]>,
	tsconfig: TsconfigPaths | null,
	importedName: string | null
): ImportResolution {
	const targetFile = resolveModuleToFile(specifier, callerFile, indexedFiles, tsconfig);
	if (!targetFile) return { targetFile: null, targetSymbolId: null };

	const target = findExportTarget(targetFile, importedName, symbolsByFile);
	if (!target) return { targetFile, targetSymbolId: null };
	return { targetFile: target.targetFile, targetSymbolId: target.targetSymbolId };
}

// ── Pipeline-facing resolver (issue #83 / FIX-83) ─────────────────────────

/** Immutable context the import resolver needs from the index. */
export interface ImportResolverContext {
	/** Repo-relative paths of all indexed files (codebase_files). */
	indexedFiles: ReadonlySet<string>;
	/** Repo symbols grouped by `file_path`. */
	symbolsByFile: Map<string, CodebaseSymbol[]>;
	/** Parsed tsconfig baseUrl/paths (nullable). */
	tsconfig: TsconfigPaths | null;
}

/**
 * Per-file import → canonical target resolver for the parse pipeline.
 *
 * A thin, stateless wrapper over {@link resolveImport} that snapshots the
 * repo's already-indexed lookup surface ONCE per pipeline run (mirroring
 * {@link ReexportResolver}). Single-hop by design: imports never recurse, so
 * cycles are structurally impossible and no `visiting` set is needed.
 *
 * Namespace imports (`import * as ns`) carry the sentinel imported name "*"
 * in their v27 metadata; a namespace has no single exported name, so they are
 * normalized to `null` before resolution — the module resolves to its file
 * with a null symbol target (matching `findExportTarget`'s namespace stance).
 * Side-effect imports (`import 'x'`) carry a null imported name already and
 * fall through the same file-only path.
 */
export class ImportResolver {
	constructor(private readonly ctx: ImportResolverContext) {}

	/**
	 * Resolve one import reference to its canonical target. Returns nulls for
	 * any miss — the import row is still persisted (issue #83 stance).
	 *
	 * @param callerFile   repo-relative path of the importing file
	 * @param specifier    raw module specifier as written (`'./user'`)
	 * @param importedName the name as written in the module, or null for
	 *                     side-effect imports
	 * @param importKind   the v27 import kind (`default` | `named` |
	 *                     `namespace` | `side-effect`) — namespace imports
	 *                     normalize to a file-only resolution
	 */
	resolve(
		callerFile: string,
		specifier: string,
		importedName: string | null,
		importKind: string | null
	): ImportResolution {
		const canonicalName = importKind === "namespace" ? null : importedName;
		return resolveImport(
			specifier,
			callerFile,
			this.ctx.indexedFiles,
			this.ctx.symbolsByFile,
			this.ctx.tsconfig,
			canonicalName
		);
	}
}

/** Build an {@link ImportResolverContext} from the repo index: indexed file paths + symbols grouped by file. */
export function buildImportResolverContext(
	symbols: CodebaseSymbol[],
	indexedFiles: ReadonlySet<string>,
	tsconfig: TsconfigPaths | null = null
): ImportResolverContext {
	const symbolsByFile = new Map<string, CodebaseSymbol[]>();
	for (const s of symbols) {
		const arr = symbolsByFile.get(s.file_path) ?? [];
		arr.push(s);
		symbolsByFile.set(s.file_path, arr);
	}
	return { indexedFiles, symbolsByFile, tsconfig };
}

/** Convenience: build a ready-to-use {@link ImportResolver}. */
export function buildImportResolver(
	symbols: CodebaseSymbol[],
	indexedFiles: ReadonlySet<string>,
	tsconfig: TsconfigPaths | null = null
): ImportResolver {
	return new ImportResolver(buildImportResolverContext(symbols, indexedFiles, tsconfig));
}
