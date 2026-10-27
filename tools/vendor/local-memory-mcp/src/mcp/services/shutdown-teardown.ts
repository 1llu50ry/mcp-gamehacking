/**
 * Process-owned worker-pool teardown (C1, FEAT-DAEMON-002 review).
 *
 * Both production shutdown paths — the stdio/HTTP `server.ts` `shutdown()` and
 * the daemon `cli/combined-server.ts` `close()` — must release the two
 * process-owned worker pools or their threads keep the event loop alive after a
 * graceful stop:
 *
 *   1. the process-wide tree-sitter parser pool
 *      (`codebase-index/parser/singleton.ts`), and
 *   2. the embedding worker pool owned by the vector store
 *      (`storage/vectors.ts` `RealVectorStore.close()`).
 *
 * This helper centralizes that teardown so it is written once and unit-testable
 * in isolation. Every step is idempotent, safe when a pool was never created,
 * and failure-contained: a close error is logged and swallowed so shutdown
 * ALWAYS reaches `db.close()` / `process.exit(0)`.
 */

import { closeCodebaseParserPool } from "../codebase-index/parser/singleton";
import { logger } from "../utils/logger";

/** Minimal closable surface (satisfied by `RealVectorStore` / `CapabilityAwareVectorStore`). */
export interface ClosableVectorStore {
	close?(): Promise<void>;
}

export interface CloseProcessPoolsOptions {
	/** Vector store whose embedding worker pool must be released. */
	vectors?: ClosableVectorStore;
	/** Log tag prefix (e.g. `[Server]` / `[Daemon]`). */
	logTag: string;
}

/**
 * Close the parser pool and the vector store's embedding pool, containing any
 * failure. Resolves once both teardowns have been attempted.
 */
export async function closeProcessPools(options: CloseProcessPoolsOptions): Promise<void> {
	const { vectors, logTag } = options;

	try {
		await closeCodebaseParserPool();
	} catch (err) {
		logger.warn(`${logTag} parser pool close failed`, { error: String(err) });
	}

	if (vectors && typeof vectors.close === "function") {
		try {
			await vectors.close();
		} catch (err) {
			logger.warn(`${logTag} vector store close failed`, { error: String(err) });
		}
	}
}
