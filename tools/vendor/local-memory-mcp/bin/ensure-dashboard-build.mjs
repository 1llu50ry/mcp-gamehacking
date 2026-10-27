#!/usr/bin/env node
/**
 * Ensure the dashboard's static UI bundle (dist/dashboard/public) is built
 * from the current source before the dashboard server is started.
 *
 * Problem: dist/ is git-ignored. In a source checkout, editing
 * src/dashboard/ui sources does NOT refresh the served bundle unless
 * `npm run dashboard:build` runs first. The result is a stale UI that is
 * easily misread as a regression.
 *
 * Strategy:
 *  - If the UI source directory does not exist (installed npm package — the
 *    published artifact ships only dist + bin, so src/ is absent), there is
 *    nothing to compare or build: serve the shipped bundle as-is.
 *  - Otherwise, compare the mtime of the newest bundled asset against the
 *    newest source file under src/dashboard/ui. If any bundle is missing or
 *    any source is newer than every asset, run `npm run dashboard:build`.
 *
 * This performs only a cheap staleness check and, in the common served-cache
 * "no-op optimum", does nothing. It does not restructure the build pipeline.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UI_SOURCE_DIR = join(REPO_ROOT, "src", "dashboard", "ui");
const DIST_ASSETS_DIR = join(REPO_ROOT, "dist", "dashboard", "public", "assets");

const IGNORED_DIRS = new Set(["node_modules", ".git", ".cache"]);

/**
 * Return the newest file mtimeMs under `dir` (recursively), or 0 if the
 * directory does not exist or is empty.
 */
function newestMtime(dir) {
	let newest = 0;
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return 0; // missing dir or permission error -> treat as "no artifacts"
	}
	for (const entry of entries) {
		const full = join(dir, entry);
		let stat;
		try {
			stat = statSync(full);
		} catch {
			continue; // race / broken symlink — ignore
		}
		if (stat.isDirectory()) {
			if (!IGNORED_DIRS.has(entry)) {
				newest = Math.max(newest, newestMtime(full));
			}
		} else {
			newest = Math.max(newest, stat.mtimeMs);
		}
	}
	return newest;
}

function isStale() {
	const newestAsset = newestMtime(DIST_ASSETS_DIR);
	if (newestAsset === 0) {
		return true; // no bundle at all -> definitely stale
	}
	return newestMtime(UI_SOURCE_DIR) > newestAsset;
}

/**
 * Rebuild the dashboard bundle if it is stale. Returns `true` when the bundle
 * is guaranteed fresh afterwards, `false` when there is nothing to build
 * (installed package without source) or the build could not be verified.
 *
 * Safe to call any number of times before serving: it is a no-op while the
 * bundle is newer than all sources.
 */
export function ensureDashboardBuild() {
	if (!existsSync(UI_SOURCE_DIR)) {
		// Installed npm package: src/ is not shipped, dist is the published
		// bundle. Nothing to (re)build here.
		return false;
	}

	if (!isStale()) {
		return true;
	}

	console.error("[dashboard] dist bundle is stale; running `npm run dashboard:build`...");
	const result = spawnSync("npm", ["run", "dashboard:build"], {
		cwd: REPO_ROOT,
		stdio: "inherit"
	});

	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(`dashboard:build failed with exit code ${result.status}`);
	}
	return true;
}

// Allow `node bin/ensure-dashboard-build.mjs` direct invocation for manual use.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	ensureDashboardBuild();
}
