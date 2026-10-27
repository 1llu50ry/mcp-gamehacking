import type { ParserPool } from "./language-visitor";
import { TreeSitterParserPool } from "./parser-pool";

let parserPool: ParserPool | null = null;

/** Process-wide parser pool shared by startup, watcher, tool, and dashboard calls. */
export function getCodebaseParserPool(): ParserPool {
	parserPool ??= new TreeSitterParserPool();
	return parserPool;
}

/**
 * Drop the process-wide parser pool reference. Since the pool owns worker
 * threads, this now CLOSES it first (H1/C1, FEAT-DAEMON-002 review): the
 * previous synchronous reset leaked the worker threads whenever it was called.
 * Async so the terminate() awaits; idempotent and safe when no pool exists.
 *
 * Production shutdown should prefer {@link closeCodebaseParserPool} (which
 * also nulls the singleton); this remains for tests that need to force a fresh
 * pool between cases.
 */
export async function resetCodebaseParserPool(): Promise<void> {
	await closeCodebaseParserPool();
}

/**
 * Stop the process-wide parser pool and release its worker threads
 * (FEAT-DAEMON-002C). Idempotent and safe when no pool was ever created. The
 * daemon calls this during graceful shutdown; tests use it to avoid leaking
 * worker threads across files.
 */
export async function closeCodebaseParserPool(): Promise<void> {
	const pool = parserPool as (TreeSitterParserPool & { close?: () => Promise<void> }) | null;
	parserPool = null;
	if (pool && typeof pool.close === "function") {
		await pool.close();
	}
}
