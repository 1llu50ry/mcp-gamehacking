/**
 * Manifest entry-point extraction (TASK-319 entry-point exclusion).
 *
 * Parses a repo's package.json `bin` / `main` / `exports` / `browser` fields
 * into normalized file paths used to tag dead-code candidates as entry
 * points. Extracted from dead-code.ts into its own module (TASK-366) so the
 * analysis module stays under the 500-line guideline; dead-code.ts re-exports
 * these symbols for import-surface compatibility (codebase.read.ts and
 * dead-code.test.ts import them from ./dead-code).
 */

import fs from "node:fs";
import path from "node:path";

export interface ManifestEntry {
	/** Normalized file path (leading "./" and "/" stripped). */
	path: string;
	/** "bin" when listed under package.json.bin (script), "manifest" for main/exports/browser. */
	kind: "bin" | "manifest";
}

/** Strip leading "./" and "/" so DB file_paths compare cleanly. */
export function normalizeManifestPath(p: string): string {
	return p.replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * Collect file-path entry points from a parsed package.json object.
 *
 * Handles the documented shapes: `bin` (string | Record<string,string>),
 * `main` (string), `browser` (string | Record<string,string|false> — false
 * remappings are dropped), `exports` (string | nested condition object, e.g.
 * `{ ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } }` and
 * subpath maps `{ "./features/*": "./src/features/*.js" }`).
 */
export function extractManifestEntries(pkg: unknown): ManifestEntry[] {
	if (!pkg || typeof pkg !== "object") return [];
	const p = pkg as Record<string, unknown>;
	const entries: ManifestEntry[] = [];
	const seen = new Set<string>();

	const push = (raw: unknown, kind: "bin" | "manifest"): void => {
		if (typeof raw !== "string" || raw.trim().length === 0) return;
		const normalized = normalizeManifestPath(raw.trim());
		if (!normalized || seen.has(normalized)) return;
		seen.add(normalized);
		entries.push({ path: normalized, kind });
	};

	/** Deep-collect string values (bins map, exports condition/subpath objects). */
	const pushObjectStringValues = (value: unknown, kind: "bin" | "manifest"): void => {
		if (!value || typeof value !== "object") return;
		for (const v of Object.values(value as Record<string, unknown>)) {
			if (typeof v === "string") push(v, kind);
			else if (v && typeof v === "object") pushObjectStringValues(v, kind);
		}
	};

	push(p.main, "manifest");
	// browser: string (entry) — object values are module remaps; strings are paths.
	if (typeof p.browser === "string") push(p.browser, "manifest");
	else if (p.browser && typeof p.browser === "object") pushObjectStringValues(p.browser, "manifest");
	// bin: string (single script) or { name → path }.
	if (typeof p.bin === "string") push(p.bin, "bin");
	else if (p.bin && typeof p.bin === "object") pushObjectStringValues(p.bin, "bin");

	if (typeof p.exports === "string") push(p.exports, "manifest");
	else if (p.exports && typeof p.exports === "object") pushObjectStringValues(p.exports, "manifest");

	return entries;
}

// Per-process manifest cache: keyed by repo root, invalidated by package.json
// mtime (spec: "parse once per request with mtime check"). Bounded — a fresh
// Mapping is far smaller than any repo file set.
const manifestCache = new Map<string, { mtimeMs: number; entryPaths: ManifestEntry[] }>();
const MANIFEST_CACHE_MAX = 128;

/**
 * Parse (or return cached) manifest entry points for a repo root.
 *
 * Missing/unreadable package.json → [] (never cached-failed-state beyond the
 * mtime key, so a package.json that appears later is picked up).
 */
export function getRepoManifestEntryPaths(repoRoot: string): ManifestEntry[] {
	const pkgPath = path.join(repoRoot, "package.json");
	let mtimeMs: number;
	try {
		mtimeMs = fs.statSync(pkgPath).mtimeMs;
	} catch {
		return [];
	}
	const cached = manifestCache.get(repoRoot);
	if (cached && cached.mtimeMs === mtimeMs) return cached.entryPaths;

	let entryPaths: ManifestEntry[];
	try {
		entryPaths = extractManifestEntries(JSON.parse(fs.readFileSync(pkgPath, "utf8")));
	} catch {
		entryPaths = [];
	}
	if (manifestCache.size >= MANIFEST_CACHE_MAX) manifestCache.clear();
	manifestCache.set(repoRoot, { mtimeMs, entryPaths });
	return entryPaths;
}
