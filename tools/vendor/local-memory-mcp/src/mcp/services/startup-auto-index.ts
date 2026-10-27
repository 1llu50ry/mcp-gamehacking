/**
 * Failure-isolated startup codebase auto-index kickoff (FEAT-DAEMON-002E).
 *
 * The startup auto-index is fire-and-forget: it must NEVER abort readiness, no
 * matter how it fails. Before this module the kickoff lived inline in
 * `server.ts` / `cli/combined-server.ts` and its synchronous prologue
 * (`evaluateAutoIndexTarget`, `registerRepo`) and the outer
 * `runtimeCapabilities.ensure("indexing")` promise had no outer catch — a throw
 * there could reject the awaited boot (after the listener had already bound)
 * and make `runDaemonWorker` exit(1) on an otherwise-healthy server.
 *
 * This module wraps the ENTIRE kickoff so:
 *   - a synchronous throw (project detection, watcher registration) is caught;
 *   - an `ensure("indexing")` rejection is caught;
 *   - an `autoIndexIfStale` rejection is caught;
 *   - the `indexing` capability is marked degraded on any of the above (so a
 *     broken auto-index is observable, not silent), and readiness is untouched.
 *
 * The underlying index RUN is already contained by `auto-index-guard.ts`
 * (`containIndexRepositoryFailure`, reused by `autoIndexIfStale`); this module
 * reuses `logAutoIndexFailure` from that guard for the outer failure so the
 * metric + per-repo WARN dedup are shared.
 */
import path from "node:path";
import type { SQLiteStore } from "../storage/sqlite";
import type { RuntimeCapabilityRegistry } from "../runtime-capabilities";
import { logger } from "../utils/logger";
import { autoIndexIfStale } from "../codebase-index/services/indexing-service";
import { evaluateAutoIndexTarget } from "../codebase-index/services/project-detection";
import { getCodebaseParserPool } from "../codebase-index/parser/singleton";
import { registerRepo } from "../codebase-index/services/file-watcher";
import { logAutoIndexFailure } from "../codebase-index/services/auto-index-guard";

/** Options for {@link kickOffStartupAutoIndex}. */
export interface KickOffStartupAutoIndexOptions {
	/** Log tag (e.g. `[Daemon]` / `[Server]`). */
	logTag: string;
	/** Directory to evaluate/index. Defaults to `process.cwd()`. */
	cwd?: string;
}

/**
 * Kick off the startup auto-index for `cwd` (default the process CWD) without
 * ever throwing or aborting readiness.
 *
 * Respects `CODEBASE_AUTO_INDEX=false` (no-op) and the project-detection guard
 * (a non-project CWD is skipped with an INFO log). On any failure the
 * `indexing` capability is marked degraded and the failure is logged once.
 */
export function kickOffStartupAutoIndex(
	db: SQLiteStore,
	runtimeCapabilities: RuntimeCapabilityRegistry,
	options: KickOffStartupAutoIndexOptions
): void {
	const tag = options.logTag;
	if (process.env.CODEBASE_AUTO_INDEX === "false") return;

	try {
		const repoPath = options.cwd ?? process.cwd();
		const eligibility = evaluateAutoIndexTarget(repoPath);
		if (!eligibility.eligible) {
			logger.info(`${tag} Auto-index skipped — working directory is not a project`, {
				cwd: repoPath,
				reason: eligibility.reason
			});
			return;
		}

		const repoName = path.basename(repoPath);
		registerRepo(repoName, repoPath);

		void runtimeCapabilities
			.ensure("indexing")
			.then((ready) => {
				if (!ready) return;
				return autoIndexIfStale(repoName, repoPath, db, getCodebaseParserPool()).then(
					(result) => {
						logger.info(`${tag} Auto-index check complete`, {
							repo: repoName,
							status: result.status,
							reason: result.reason
						});
						void runtimeCapabilities.ensure("watcher");
					},
					(error: unknown) => {
						// The index RUN is already contained by auto-index-guard
						// inside autoIndexIfStale; this catches a rejection from its
						// own prologue and marks the capability degraded.
						runtimeCapabilities.markDegraded("indexing", String(error));
						logAutoIndexFailure(repoName, error);
					}
				);
			})
			.catch((error: unknown) => {
				runtimeCapabilities.markDegraded("indexing", String(error));
				logAutoIndexFailure(repoName, error);
			});
	} catch (error) {
		// Synchronous prologue failure (project detection / watcher registration).
		runtimeCapabilities.markDegraded("indexing", String(error));
		logger.warn(`${tag} Auto-index kickoff threw — degraded, readiness unaffected`, { error: String(error) });
	}
}
