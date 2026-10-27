/**
 * resolve-parser-worker — locate the parser worker entry for the current
 * runtime (FEAT-DAEMON-002C).
 *
 * The generic WorkerPool needs an absolute path/URL to the worker entry script.
 * There are two runtimes:
 *
 *   1. DEV / TEST — the source tree under `src/`. The worker entry is the
 *      tsx-bootstrap `.mjs` (`parser.worker-bootstrap.mjs`) which registers the
 *      tsx loader hooks and imports `parser.worker.ts`.
 *   2. PRODUCTION — the bundled `dist/mcp/workers/parser.worker.js` emitted by
 *      tsup (plain ESM; the daemon runs `node dist/mcp/server.js` with no
 *      TypeScript loader available).
 *
 * Resolution anchors on the project root (a directory that contains either
 * `dist/grammars` — production — or `node_modules` — dev), mirroring
 * `language-routing.resolveProjectRoot()`. The runtime is detected from the
 * executing module's own path (a `src/mcp/workers` segment ⇒ dev), so a stale
 * `dist/` build can never shadow the live source under vitest.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Walk up from this module looking for the project root, or `null`. */
function findProjectRoot(): string | null {
	let dir = path.dirname(fileURLToPath(import.meta.url));
	while (dir !== path.parse(dir).root) {
		if (fs.existsSync(path.join(dir, "dist", "grammars")) || fs.existsSync(path.join(dir, "node_modules"))) {
			return dir;
		}
		dir = path.dirname(dir);
	}
	return null;
}

/**
 * Absolute path/URL of the parser worker entry for the current runtime.
 *
 * @throws when neither the dev bootstrap nor the bundled production worker can
 *         be found (a broken install/build).
 */
export function resolveParserWorkerPath(): string | URL {
	const modulePath = fileURLToPath(import.meta.url);
	const inSource = modulePath.includes(`${path.sep}src${path.sep}mcp${path.sep}workers${path.sep}`);
	const root = findProjectRoot();

	if (inSource && root) {
		const bootstrap = path.join(root, "src", "mcp", "workers", "parser.worker-bootstrap.mjs");
		if (fs.existsSync(bootstrap)) return pathToFileURL(bootstrap);
	}

	if (root) {
		const bundled = path.join(root, "dist", "mcp", "workers", "parser.worker.js");
		if (fs.existsSync(bundled)) return pathToFileURL(bundled);
	}

	// Dev fallback: a bootstrap sibling to this module.
	const sibling = new URL("./parser.worker-bootstrap.mjs", import.meta.url);
	if (fs.existsSync(fileURLToPath(sibling))) return sibling;

	throw new Error(
		"parser worker entry not found (expected dist/mcp/workers/parser.worker.js or src/mcp/workers/parser.worker-bootstrap.mjs)"
	);
}
