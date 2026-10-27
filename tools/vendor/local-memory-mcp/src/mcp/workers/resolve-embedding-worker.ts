/**
 * resolve-embedding-worker — locate the embedding worker entry for the current
 * runtime (FEAT-DAEMON-002D).
 *
 * The generic WorkerPool needs an absolute path/URL to the worker entry script.
 * There are two runtimes:
 *
 *   1. DEV / TEST — the source tree under `src/`. The worker entry is the
 *      tsx-bootstrap `.mjs` (`embedding.worker-bootstrap.mjs`) which registers
 *      the tsx loader hooks and imports `embedding.worker.ts`.
 *   2. PRODUCTION — the bundled `dist/mcp/workers/embedding.worker.js` emitted by
 *      tsup (plain ESM; the daemon runs `node dist/mcp/server.js` with no
 *      TypeScript loader available).
 *
 * Resolution anchors on the project root (a directory that contains either
 * `dist/grammars` — production — or `node_modules` — dev), mirroring
 * `resolve-parser-worker.ts` (FEAT-DAEMON-002C). The runtime is detected from
 * the executing module's own path (a `src/mcp/workers` segment ⇒ dev), so a
 * stale `dist/` build can never shadow the live source under vitest.
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
 * Absolute path/URL of the embedding worker entry for the current runtime.
 *
 * @throws when neither the dev bootstrap nor the bundled production worker can
 *         be found (a broken install/build). Callers catch this and fall back
 *         to in-process ONNX inference.
 */
export function resolveEmbeddingWorkerPath(): string | URL {
	const modulePath = fileURLToPath(import.meta.url);
	const inSource = modulePath.includes(`${path.sep}src${path.sep}mcp${path.sep}workers${path.sep}`);
	const root = findProjectRoot();

	if (inSource && root) {
		const bootstrap = path.join(root, "src", "mcp", "workers", "embedding.worker-bootstrap.mjs");
		if (fs.existsSync(bootstrap)) return pathToFileURL(bootstrap);
	}

	if (root) {
		const bundled = path.join(root, "dist", "mcp", "workers", "embedding.worker.js");
		if (fs.existsSync(bundled)) return pathToFileURL(bundled);
	}

	// Dev fallback: a bootstrap sibling to this module.
	const sibling = new URL("./embedding.worker-bootstrap.mjs", import.meta.url);
	if (fs.existsSync(fileURLToPath(sibling))) return sibling;

	throw new Error(
		"embedding worker entry not found (expected dist/mcp/workers/embedding.worker.js or src/mcp/workers/embedding.worker-bootstrap.mjs)"
	);
}

/**
 * Resolve the embedding worker pool size (default 1).
 *
 * The backfill issues ONE `embed()` batch at a time and awaits it before the
 * next, so a single worker is sufficient to move inference off the main thread;
 * a second worker would only add another resident ONNX session (~140-180 MB,
 * PERF-005) without any throughput gain. Operators can override via
 * `EMBEDDING_WORKER_POOL_SIZE`; the pool clamps the value to
 * `os.availableParallelism()`.
 */
export function resolveEmbeddingPoolSize(): number {
	const raw = process.env.EMBEDDING_WORKER_POOL_SIZE;
	const parsed = raw === undefined || raw === "" ? NaN : Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}
