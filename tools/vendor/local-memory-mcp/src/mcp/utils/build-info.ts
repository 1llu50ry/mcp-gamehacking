/**
 * Build identity of the running process (PERF-009).
 *
 * Answers the question a stale daemon makes unanswerable: "which build is this
 * process actually running?". The wedge that motivated this module was a
 * daemon launched from the npm-installed `0.48.0` package while the repo on
 * disk was newer — every fix on `main` was invisible in practice, and the only
 * symptom was an unexplained session error.
 *
 * Resolution order (first hit wins):
 *   1. `daemon-build.json` next to the built bundle, written by `gen-bins`
 *      during `npm run build` (authoritative — stamped by the build that
 *      produced the code now running).
 *   2. `package.json` version + `git rev-parse --short HEAD` at startup
 *      (dev / unbundled runs, or a build predating the stamp).
 *
 * Never throws: a missing file, a missing `git` binary, or a non-repo CWD
 * degrades to whatever partial identity is available.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Where the build identity came from. */
export type BuildInfoSource = "stamp" | "runtime";

/** Resolved build identity of the running process. */
export interface BuildInfo {
	/** Package version (semver), or `"unknown"` when nothing could be read. */
	version: string;
	/** Short git SHA of the build, or `null` when unavailable. */
	gitSha: string | null;
	/** ISO timestamp of the build (stamp only), or `null` for runtime reads. */
	builtAt: string | null;
	/** Which resolution path produced this identity. */
	source: BuildInfoSource;
}

/** Filename written into `dist/` by `gen-bins` (see `scripts/gen-bins.mjs`). */
const STAMP_FILENAME = "daemon-build.json";
/** How many parent directories to search for the stamp / `package.json`. */
const SEARCH_DEPTH = 5;

/** Directory of this module — the anchor for the upward search. */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Read a JSON object from `file`, or `null` when absent/unreadable/invalid. */
function readJsonObject(file: string): Record<string, unknown> | null {
	try {
		if (!fs.existsSync(file)) return null;
		const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/** Walk up from `startDir` looking for `filename`; returns its path or `null`. */
function findUpwards(startDir: string, filename: string): string | null {
	let dir = startDir;
	for (let i = 0; i < SEARCH_DEPTH; i++) {
		const candidate = path.join(dir, filename);
		if (fs.existsSync(candidate)) return candidate;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

/** Non-empty string guard (a stamp may carry a missing/null field). */
function asNonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Read the build stamp written by `gen-bins`, or `null` when absent/invalid. */
function readStamp(startDir: string): BuildInfo | null {
	const stampPath = findUpwards(startDir, STAMP_FILENAME);
	if (stampPath === null) return null;
	const stamp = readJsonObject(stampPath);
	if (stamp === null) return null;
	const version = asNonEmptyString(stamp.version);
	if (version === null) return null;
	return {
		version,
		gitSha: asNonEmptyString(stamp.gitSha),
		builtAt: asNonEmptyString(stamp.builtAt),
		source: "stamp"
	};
}

/** Read `package.json` version by walking up from `startDir`, or `null`. */
function readPackageVersion(startDir: string): string | null {
	const pkgPath = findUpwards(startDir, "package.json");
	if (pkgPath === null) return null;
	return asNonEmptyString(readJsonObject(pkgPath)?.version);
}

/**
 * `git rev-parse --short HEAD` in `cwd`, or `null` when git is unavailable.
 * A missing binary (`error`), non-zero exit, or timeout all degrade to `null`.
 */
function readGitSha(cwd: string): string | null {
	try {
		const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
			cwd,
			encoding: "utf8",
			timeout: 2000,
			stdio: ["ignore", "pipe", "ignore"]
		});
		if (result.status !== 0 || typeof result.stdout !== "string") return null;
		return asNonEmptyString(result.stdout);
	} catch {
		return null;
	}
}

/** Memoized identity — resolved once per process. */
let cached: BuildInfo | null = null;

/**
 * Resolve build identity from `startDir` (no caching). Prefers the build stamp;
 * falls back to `package.json` + git. The git probe runs at most once and never
 * throws.
 *
 * Exported so tests can drive resolution against a temp directory without
 * touching the process-wide cache.
 */
export function resolveBuildInfo(startDir: string, cwd: string = process.cwd()): BuildInfo {
	const stamped = readStamp(startDir);
	if (stamped !== null) return stamped;
	return {
		version: readPackageVersion(startDir) ?? "unknown",
		gitSha: readGitSha(cwd),
		builtAt: null,
		source: "runtime"
	};
}

/**
 * Resolve (and cache) the running process' build identity.
 *
 * Anchored at this module's directory, so it works for both the bundled
 * (`dist/`) and source (`src/`) layouts.
 */
export function getBuildInfo(): BuildInfo {
	if (cached !== null) return cached;
	cached = resolveBuildInfo(MODULE_DIR);
	return cached;
}

/** Reset the memoized identity. Test-only seam. */
export function resetBuildInfoCache(): void {
	cached = null;
}

/**
 * Compact one-line identity for logs and status surfaces, e.g.
 * `0.48.1+d8dd97a [stamp built 2026-09-21T10:12:00.000Z]`.
 */
export function formatBuildInfo(info: BuildInfo = getBuildInfo()): string {
	const sha = info.gitSha !== null ? `+${info.gitSha}` : "";
	const built = info.builtAt !== null ? ` built ${info.builtAt}` : "";
	return `${info.version}${sha} [${info.source}${built}]`;
}
