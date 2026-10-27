/**
 * dead-code — ARCHITECTURE-mode dead-code candidates + hotspots (TASK-319).
 *
 * Extends the `codebase-read` ARCHITECTURE block with a `deadCode` payload:
 * `unreferenced[]` (dead-code candidates, per-kind reference breakdown) and
 * `hotspots[]` (top in-degree symbols), plus a language-honesty coverage
 * report. This is a QUERY + COMPUTE layer only — the DB stays flat (no
 * migration, no denormalized counter column).
 *
 * ## Definition of "used" (locked decision, TASK-319)
 * ANY reference kind counts (call / instantiation / import / extends /
 * implements / type — 'type' added by TASK-008 / issue #82 so a symbol used
 * ONLY as a type annotation is NOT dead) → a symbol with ZERO reference rows
 * of all kinds is a dead-code candidate. Aggregation is name-based (ADR-002),
 * so same-name symbols share their reference rows — the established
 * traceSymbol model.
 *
 * ## Candidate universe (bounded, documented)
 * Only TOP-LEVEL symbols (parent_symbol_id IS NULL — exported OR internal)
 * are scanned, capped at DEAD_CODE_SCAN_LIMIT. Members are excluded by
 * design: same-name methods/fields across containers make name-based rows
 * unreliable for members (they aggregate cross-container), and top-level
 * names are the trustworthy, small subset — the spec's "top-level exported
 * UNION low-level unreferenced" framing.
 *
 * ## Entry-point exclusion (layered, spec C5)
 *   1. package.json `bin`/`main`/`exports`/`browser` parsed from the repo
 *      root (mtime-keyed per-process cache) — file paths become entry points.
 *   2. Shebang scan (`#!...`) on candidate files at query time — only
 *      candidates that survive steps 1/3, so reads stay O(candidates), never
 *      a full-scan.
 *   3. Top-level exported=1 symbols = public-API anchor (the same convention
 *      as ARCHITECTURE_TOP_LEVEL_EXPORTS_LIMIT top-level filtering).
 * Each candidate is tagged `bin | manifest | shebang | public-api` (internal
 * = untagged = truly dead). Truly-dead candidates are ordered FIRST in the
 * capped output so the actionable list never gets drowned by anchors.
 *
 * ## Language honesty
 * Only languages with (a) a ref-emitting visitor in the parser registry AND
 * (b) OBSERVED reference rows in this repo's index produce candidates —
 * "observed rows" proves the emitter ran in the current index (an index that
 * predates reference emission would fake zero refs). Everything else is
 * listed as unreliable with an explanatory `coverageNote`.
 *
 * ## Module layout (TASK-366)
 * This file stays under the 500-line guideline by delegating two sub-domains
 * to sibling modules (both re-exported here for import-surface compatibility
 * with callers/tests that import from ./dead-code):
 *   - manifest-entries.ts — package.json bin/main/exports/browser parsing +
 *     the mtime-keyed cache (ManifestEntry, extractManifestEntries,
 *     getRepoManifestEntryPaths, normalizeManifestPath).
 *   - dead-code-text.ts — renderDeadCodeText (token-efficient text output).
 */

import fs from "node:fs";
import path from "node:path";
import type { SQLiteStore } from "../../storage/sqlite";
import type { CodebaseFile } from "../../types/codebase-file";
import type { CodebaseSymbol } from "../../types/codebase-symbol";
import { createRegistry } from "../parser/language-routing";
import { DEAD_CODE_HOTSPOTS_MAX, DEAD_CODE_SCAN_LIMIT, DEAD_CODE_UNREFERENCED_MAX } from "../../utils/constants";
import { getRepoManifestEntryPaths, normalizeManifestPath, type ManifestEntry } from "./manifest-entries";

// ── Re-exports (TASK-366) — manifest parsing + text rendering live in sibling
//    modules; re-export here so existing importers (codebase.read.ts,
//    dead-code.test.ts) keep working untouched.
export { extractManifestEntries, getRepoManifestEntryPaths, normalizeManifestPath } from "./manifest-entries";
export type { ManifestEntry } from "./manifest-entries";
export { renderDeadCodeText } from "./dead-code-text";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type EntryPointType = "bin" | "manifest" | "shebang" | "public-api" | "internal";

/** Classification of a dead-code candidate that is NOT truly dead. */
export interface EntryPointTag {
	type: Exclude<EntryPointType, "internal">;
	/** Human-readable why (e.g. "listed in package.json (bin)"). */
	reason: string;
}

/** A zero-reference symbol in the unreferenced report. */
export interface UnreferencedSymbol {
	name: string;
	kind: string;
	file_path: string;
	/** Declaration start line (symbol.start_line), when known. */
	line: number | null;
	/** Per-kind reference breakdown. Absent/zero for every kind = dead candidate. */
	kinds: Record<string, number>;
	/** Present ONLY when the candidate was excluded as an entry point. Absent = truly dead. */
	entryPoint?: EntryPointTag;
}

/** A top in-degree symbol in the hotspots report. */
export interface HotspotSymbol {
	name: string;
	kind: string;
	file_path: string;
	refCount: number;
	/** Per-kind reference breakdown (call/instantiation/import/extends/implements/type). */
	topKinds: Record<string, number>;
}

export interface LanguageCoverage {
	/** Languages with reference emission OBSERVED in this repo's index. */
	reliable: string[];
	/** Repo languages without observed emission (declaration-only / pre-ref index). */
	unreliable: string[];
}

/**
 * Totals for the text summary — computed over the FULL analysis so a capped
 * `unreferenced` list never misleads about scale.
 */
export interface DeadCodeTotals {
	/** Top-level candidates evaluated (reliable languages, zero refs). */
	scanned: number;
	/** Truly-dead candidates (no entry point). */
	dead: number;
	/** Dead candidates excluded as entry points (public-api/bin/manifest/shebang). */
	entryExcluded: number;
	/** True when scan or output caps truncated the result. */
	truncated: boolean;
}

/** The `deadCode` block appended to an ARCHITECTURE result. */
export interface DeadCodeBlock {
	unreferenced: UnreferencedSymbol[];
	hotspots: HotspotSymbol[];
	languageCoverage: LanguageCoverage;
	totals: DeadCodeTotals;
	/** Honesty note: which languages are trustworthy and why, plus any skipped exclusions. */
	coverageNote: string;
}

export interface DeadCodeAnalysisOptions {
	/** Absolute repo root for manifest/shebang entry-point exclusion (optional). */
	repoRoot?: string | null;
	/** Output cap for `unreferenced` (default DEAD_CODE_UNREFERENCED_MAX). */
	unreferencedMax?: number;
	/** Output cap for `hotspots` (default DEAD_CODE_HOTSPOTS_MAX). */
	hotspotsMax?: number;
	/** Candidate-universe cap (default DEAD_CODE_SCAN_LIMIT). */
	scanLimit?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// LANGUAGE EMISSION ORACLE — derived from the parser registry, not hardcoded
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Discovery-vocabulary → registry-languageId alias table (TASK-319).
 *
 * codebase_files.language comes from file-discovery's EXTENSION_LANGUAGE_MAP
 * (e.g. ".tsx" → "typescriptreact"), while the parser registry names its
 * configs languageId ("tsx"). Files routed to a ref-emitting visitor under a
 * DIFFERENT discovery name (TS/TSX configs accept .js/.mjs/.svelte/.astro/
 * .jsx/…) must resolve to the same emission key or their languages would be
 * (wrongly) reported as declaration-only.
 */
const EMISSION_LANG_ALIASES: Record<string, string> = {
	typescript: "typescript",
	tsx: "tsx",
	// Discovery vocab → TS config (its extensions include .js/.mjs/.cjs/.svelte/.astro)
	javascript: "typescript",
	svelte: "typescript",
	astro: "typescript",
	// Discovery vocab → TSX config (its extensions include .jsx)
	typescriptreact: "tsx",
	javascriptreact: "tsx"
};

/**
 * Registry languageIds whose visitor implements `extractReferences`.
 *
 * Derived once at module load from `createRegistry()` (the single source of
 * truth for supported languages) — when a Wave-1 language gains emission the
 * dead-code filter grows AUTOMATICALLY, no constant to bump. Visitors are
 * instantiated per config to probe for `extractReferences` (cheap, no WASM);
 * markdown + generic catch-all have none and fall out naturally.
 */
const REF_EMITTING_LANGUAGE_IDS: ReadonlySet<string> = (() => {
	const emitting = new Set<string>();
	for (const config of createRegistry()) {
		if (!config) continue;
		try {
			if (typeof config.createVisitor().extractReferences === "function") {
				emitting.add(config.languageId);
			}
		} catch {
			// Visitor constructor threw — treat as non-emitting (defensive).
		}
	}
	return emitting;
})();

/**
 * Normalize a codebase_files.language to a ref-emitting registry key, or
 * null when the language has no reference emission at all.
 */
export function normalizeLangForEmission(language: string | null): string | null {
	if (!language) return null;
	const canonical = EMISSION_LANG_ALIASES[language] ?? language;
	return REF_EMITTING_LANGUAGE_IDS.has(canonical) ? canonical : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// SHEBANG SCAN (query-time, candidate-scoped)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Read the first line of a file (first 512 bytes — never the whole file).
 * Returns null when the file is unreadable/missing (candidate treated as
 * non-shebang rather than failing the analysis).
 */
export function readFileFirstLine(filePath: string): string | null {
	let fd: number | null = null;
	try {
		fd = fs.openSync(filePath, "r");
		const buf = Buffer.alloc(512);
		const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
		const head = buf.subarray(0, bytesRead).toString("utf8");
		const newline = head.indexOf("\n");
		return (newline >= 0 ? head.slice(0, newline) : head).trim();
	} catch {
		return null;
	} finally {
		if (fd !== null) {
			try {
				fs.closeSync(fd);
			} catch {
				/* noop */
			}
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTRY-POINT CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/** Heuristic file match: exact normalized path, else basename equality for bin scripts only. */
function fileMatchesEntry(filePath: string, entry: ManifestEntry): boolean {
	if (normalizeManifestPath(filePath) === entry.path) return true;
	// bin scripts are commonly referenced by bare script name ("cli", "bin.js");
	// basename equality for main/exports/browser would over-match (dist/main.js
	// ↔ src/main.js), so it applies to bin entries only.
	if (entry.kind === "bin" && path.basename(filePath) === path.basename(entry.path)) return true;
	return false;
}

/**
 * Classify an unreferenced candidate's entry-point status.
 *
 * Order matters (documented, deterministic): public-API anchor (no disk I/O)
 * → manifest match (cached package.json) → shebang (candidate-scoped file
 * read). Returns null for internal candidates = TRULY DEAD.
 */
export function classifyEntryPoint(
	sym: CodebaseSymbol,
	manifestEntries: ManifestEntry[],
	repoRoot: string | null
): EntryPointTag | null {
	if (sym.exported && sym.parent_symbol_id === null) {
		return {
			type: "public-api",
			reason: "top-level exported symbol — public API anchor (exported=1, no parent)"
		};
	}

	for (const entry of manifestEntries) {
		if (fileMatchesEntry(sym.file_path, entry)) {
			return {
				type: entry.kind,
				reason: `file listed in package.json (${entry.kind}: ${entry.path})`
			};
		}
	}

	if (repoRoot) {
		const firstLine = readFileFirstLine(path.join(repoRoot, sym.file_path));
		if (firstLine && firstLine.startsWith("#!")) {
			const interp = firstLine.length > 40 ? `${firstLine.slice(0, 37)}...` : firstLine;
			return { type: "shebang", reason: `executable shebang: ${interp}` };
		}
	}

	return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

/** The spec's per-kind breakdown for an unreferenced symbol — all zeros, explicit. */
function zeroKinds(): Record<string, number> {
	return { call: 0, instantiation: 0, import: 0, extends: 0, implements: 0, type: 0 };
}

/**
 * Compute the `deadCode` block for an ARCHITECTURE read.
 *
 * @param db        - store (reference + symbol entities).
 * @param repo      - concrete repo scope.
 * @param repoRoot  - optional absolute repo root for manifest/shebang exclusion
 *                    (caller validates it's a directory; null = skipped, noted).
 * @param files     - ALL indexed files for the repo (already hydrated by the
 *                    architecture handler — reused for language resolution).
 */
export function analyzeDeadCode(
	db: SQLiteStore,
	repo: string,
	repoRoot: string | null,
	files: CodebaseFile[],
	options: DeadCodeAnalysisOptions = {}
): DeadCodeBlock {
	const unreferencedMax = options.unreferencedMax ?? DEAD_CODE_UNREFERENCED_MAX;
	const hotspotsMax = options.hotspotsMax ?? DEAD_CODE_HOTSPOTS_MAX;
	const scanLimit = options.scanLimit ?? DEAD_CODE_SCAN_LIMIT;

	// ── Language honesty ────────────────────────────────────────────────
	// reliable = repo languages that BOTH can emit (registry) AND produced
	// reference rows in this index (observed — proof the emitter ran here).
	const langByFile = new Map<string, string | null>();
	const repoLanguages = new Set<string>();
	for (const f of files) {
		langByFile.set(f.file_path, f.language ?? null);
		if (f.language) repoLanguages.add(f.language);
	}
	const observedRefLangs = new Set(db.codebaseReferences.getReferenceLanguagesByRepo(repo));
	const reliable = [...repoLanguages]
		.filter((lang) => normalizeLangForEmission(lang) !== null && observedRefLangs.has(lang))
		.sort();
	const reliableSet = new Set(reliable);
	const unreliable = [...repoLanguages].filter((lang) => !reliableSet.has(lang)).sort();
	const refRowCount = db.codebaseReferences.countReferencesByRepo(repo);

	// ── Hotspots ────────────────────────────────────────────────────────
	const topRefRows = db.codebaseReferences.getTopReferencedSymbols(repo, hotspotsMax);
	const hotspots: HotspotSymbol[] = [];
	for (const row of topRefRows) {
		// Anchor the name to a current index symbol (skip stale ref targets).
		const matches = db.codebaseSymbols.getSymbolByName(repo, row.symbol_name);
		if (matches.length === 0) continue;
		const anchor = matches[0];
		hotspots.push({
			name: row.symbol_name,
			kind: anchor.kind,
			file_path: anchor.file_path,
			refCount: row.total,
			topKinds: row.countsByKind
		});
	}

	// ── Dead-code candidates ────────────────────────────────────────────
	const totals: DeadCodeTotals = { scanned: 0, dead: 0, entryExcluded: 0, truncated: false };
	const dead: UnreferencedSymbol[] = [];
	const entryExcluded: UnreferencedSymbol[] = [];

	// No observed reference rows anywhere in this index → a zero-ref claim has
	// no evidence; suppress candidates entirely (honest empty result).
	if (refRowCount > 0 && reliable.length > 0) {
		const manifestEntries = repoRoot ? getRepoManifestEntryPaths(repoRoot) : [];
		const candidates = db.codebaseSymbols.getTopLevelSymbolsByRepo(repo, scanLimit);
		const refCounts = db.codebaseReferences.countReferencesBySymbol(
			repo,
			candidates.map((c) => c.name)
		);

		for (const sym of candidates) {
			const lang = langByFile.get(sym.file_path);
			if (!lang || !reliableSet.has(lang)) continue; // declaration-only language
			const counts = refCounts.get(sym.name);
			if ((counts?.total ?? 0) > 0) continue; // referenced → used

			totals.scanned++;
			const item: UnreferencedSymbol = {
				name: sym.name,
				kind: sym.kind,
				file_path: sym.file_path,
				line: sym.start_line,
				kinds: { ...zeroKinds() }
			};
			const tag = classifyEntryPoint(sym, manifestEntries, repoRoot);
			if (tag) {
				item.entryPoint = tag;
				entryExcluded.push(item);
				totals.entryExcluded++;
			} else {
				dead.push(item);
				totals.dead++;
			}
		}
		// totals stay FULL (scan is bounded by scanLimit); only the OUTPUT
		// arrays are capped. Dead-first ordering survives the cap because
		// dead and entryExcluded are concatenated dead-first below.
		// `candidates.length >= scanLimit` is the SQL-LIMIT truncation signal
		// (TASK-367): getTopLevelSymbolsByRepo applies the LIMIT BEFORE the
		// reliable-language filter, so in a mixed-language repo whose first
		// scanLimit top-level rows by file_path are declaration-only (e.g.
		// docs/*.md sorting before src/*.ts), `scanned` alone stays below the
		// cap while the real candidates were never evaluated — that pre-filter
		// cut must STILL set truncated so an empty report reads "not
		// evaluated", never "no dead code".
		totals.truncated =
			candidates.length >= scanLimit ||
			totals.scanned >= scanLimit ||
			dead.length + entryExcluded.length > unreferencedMax;
	}

	const unreferenced = [...dead, ...entryExcluded].slice(0, unreferencedMax);

	// ── Coverage note (honest, token-efficient) ─────────────────────────
	const noteParts: string[] = [];
	noteParts.push(`reliable reference emission: [${reliable.length > 0 ? reliable.join(", ") : "none"}]`);
	if (unreliable.length > 0) {
		noteParts.push(`declaration-only / unobserved: [${unreliable.join(", ")}]`);
	}
	if (refRowCount === 0) {
		noteParts.push(
			"index has zero reference rows — dead-code candidates suppressed (run index_repository to rebuild reference edges)"
		);
	}
	if (!repoRoot) {
		noteParts.push(
			"repoPath not provided — package.json (bin/main/exports) + shebang entry-point exclusion skipped; exported top-level symbols still treated as public API"
		);
	}
	if (totals.truncated) {
		noteParts.push("candidate/output caps reached — lists truncated (keep growing real dead code under the cap)");
	}

	const block: DeadCodeBlock = {
		unreferenced,
		hotspots,
		languageCoverage: { reliable, unreliable },
		totals,
		coverageNote: noteParts.join("; ")
	};
	return block;
}
