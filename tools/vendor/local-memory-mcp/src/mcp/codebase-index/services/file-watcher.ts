/**
 * Codebase file watcher — light polling sweep over autoIndexIfStale
 * (TASK-322 / fsd US-08, decision 2026-08-09).
 *
 * Deliberately NOT fs.watch/chokidar: zero fs.watch/chokidar usage exists in
 * src today, and polling avoids per-process watcher lifecycle, cross-platform
 * leaks, and double-index races (fsd.md §Point 7). The MCP server process is
 * the ONLY host of the loop (multi-agent safe — one process, one timer),
 * mirroring the existing worker start precedent (mcp/server.ts). The
 * dashboard does NOT host it: it runs its own index path in a separate
 * process, so hosting the loop there too would double-index.
 *
 * How it works:
 *   1. Repos are registered in a process-shared in-memory set by the startup
 *      auto-index (server.ts) and by successful tool index calls
 *      (tools/codebase-index.ts). Registering in a process that never starts
 *      the loop (e.g. the dashboard) is a harmless no-op.
 *   2. Every FILE_WATCH_INTERVAL_MS the sweep visits each registered repo and
 *      — cheapest check first — decides whether to trigger autoIndexIfStale:
 *        a. lastIndexedAt is null  → never indexed → SKIP (never index
 *           unrequested repos; the 24h startup/TTL auto-index or a tool call
 *           owns the first build).
 *        b. a trigger was dispatched within FILE_WATCH_TTL_MS → SKIP
 *           (per-repo re-entry cap / debounce — minimum period between
 *           trigger dispatches; detection latency ≤ TTL, tunable). Keyed on
 *           the IN-MEMORY lastTriggeredAt, NOT DB last_indexed_at: a
 *           zero-parse run — the steady state for an untouched repo (the
 *           planner marks every file "skip") — never advances last_indexed_at,
 *           so a DB-keyed cap would re-trigger a full discovery walk every
 *           tick forever (TASK-354).
 *        c. repoPath no longer resolves to a directory → SKIP (repo moved/
 *           deleted; stop retrying a dead path).
 *        d. otherwise fire autoIndexIfStale(repo, repoPath, …, { ttlMs }) —
 *           the same ttlMs is passed so autoIndexIfStale's internal freshness
 *           check agrees with the sweep's (deliberately short vs the 24h
 *           CODEBASE_AUTO_INDEX_TTL default). That internal DB check is the
 *           correctness backstop; the in-memory cap does the throttling.
 *   3. Change detection is NOT a pre-scan: it is delegated to
 *      performIndexRepository's incremental planner (mtime pre-filter +
 *      SHA-256 checksum confirmation), which re-parses ONLY files whose mtime
 *      moved past their last_indexed_at — an untouched repo re-runs with
 *      zero parses (negligible cost), exactly the semantics the decision
 *      documented.
 *   4. Concurrency: autoIndexIfStale's module-level indexingRepos set
 *      returns "already_indexing" when a tool call or the startup path is
 *      mid-index for the same repo — the sweep just skips (no double index,
 *      no hammering an active session).
 *
 * Gate: ENABLE_FILE_WATCHER env var — default ENABLED; set to "false" to
 * disable (mirrors the CODEBASE_AUTO_INDEX / ENABLE_AUTO_ARCHIVE convention).
 * Config via env only: FILE_WATCH_INTERVAL_MS (sweep cadence, floored at
 * FILE_WATCH_INTERVAL_MIN_MS), FILE_WATCH_TTL_MS (minimum period between
 * trigger dispatches per repo). No new table/column, no tool surface change.
 */

import fs from "node:fs";
import path from "node:path";
import type { SQLiteStore } from "../../storage/sqlite";
import type { ParserPool } from "../parser";
import { logger } from "../../utils/logger";
import { FILE_WATCH_INTERVAL_MS, FILE_WATCH_INTERVAL_MIN_MS, FILE_WATCH_TTL_MS } from "../../utils/constants";
import { getLastIndexedAt } from "./indexing-cache";
import { autoIndexIfStale } from "./indexing-service";

// ── Watched-repo registry (process-shared) ──────────────────────────────

export interface WatchedRepoEntry {
	/** Absolute, resolved path to the repo on disk. */
	repoPath: string;
	/**
	 * Scope owner captured at registration time (FIX-OWNER-CODEBASE) so
	 * watcher-triggered re-indexes forward it to the codebase→KG enqueue
	 * instead of writing owner-less rows. Empty when the registering caller
	 * could not resolve one.
	 */
	owner: string;
	/** Epoch ms when the repo was registered with the watcher. */
	registeredAt: number;
	/** Epoch ms of the last trigger dispatch — the in-memory re-entry cap. */
	lastTriggeredAt: number;
}

/**
 * In-process registry of repos the watcher may sweep. Process-shared (module
 * level) so every tool call / session in the MCP server process contributes;
 * intentionally NOT agent-scoped. Only repos registered here AND already
 * indexed at least once are ever swept — the watcher never indexes a repo
 * nobody asked for.
 */
const watchedRepos = new Map<string, WatchedRepoEntry>();

/**
 * Register a repo for polling. Idempotent — re-registration only refreshes
 * the path (and only when the path actually changed). Safe to call from any
 * process; processes that never start the loop just hold a harmless entry.
 */
export function registerRepo(repo: string, repoPath: string, owner = ""): void {
	const resolved = path.resolve(repoPath);
	const existing = watchedRepos.get(repo);
	if (existing && existing.repoPath === resolved && existing.owner === owner) {
		return;
	}
	// lastTriggeredAt starts at registration time so a freshly registered repo
	// is not immediately re-triggered by the next sweep (the tool call that
	// registered it just indexed it).
	const now = Date.now();
	watchedRepos.set(repo, { repoPath: resolved, owner, registeredAt: now, lastTriggeredAt: now });
}

/** Remove a repo from the watcher registry (e.g. repo deleted entirely). */
export function unregisterRepo(repo: string): void {
	watchedRepos.delete(repo);
}

/** Clear the registry — test teardown only. */
export function clearWatchedRepos(): void {
	watchedRepos.clear();
}

/** Read-only view of the registry (diagnostics / tests). */
export function listWatchedRepos(): ReadonlyMap<string, WatchedRepoEntry> {
	return watchedRepos;
}

// ── Sweep ───────────────────────────────────────────────────────────────

export interface SweepOptions {
	/** Freshness TTL for the per-repo re-entry cap (default FILE_WATCH_TTL_MS). */
	ttlMs?: number;
	/** Clock override for deterministic tests (default Date.now()). */
	now?: number;
}

export interface SweepOutcome {
	/** Repos autoIndexIfStale accepted (background index fired). */
	triggered: string[];
	/** Repos never indexed (lastIndexedAt null) — left alone. */
	skippedUnindexed: string[];
	/** Repos indexed within the TTL window — re-entry cap. */
	skippedFresh: string[];
	/** Repos whose registered path is no longer a directory. */
	skippedUnresolvable: string[];
	/** Repos already being indexed (module-level guard). */
	skippedInFlight: string[];
	/** Repos autoIndexIfStale skipped for another reason (env off / fresh race). */
	skippedAuto: string[];
}

function emptyOutcome(): SweepOutcome {
	return {
		triggered: [],
		skippedUnindexed: [],
		skippedFresh: [],
		skippedUnresolvable: [],
		skippedInFlight: [],
		skippedAuto: []
	};
}

/**
 * Decide whether a registered repoPath is still a resolvable directory on
 * disk. A repo whose path vanished is skipped — retrying it every tick would
 * burn a discovery walk on a dead path (constraint: bounded resources).
 */
function isRepoPathResolvable(repoPath: string): boolean {
	try {
		return fs.statSync(repoPath).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Run one sweep over the registered repos.
 *
 * Order is cheapest-first so an idle registry costs only one MAX query (the
 * never-indexed guard) + in-memory arithmetic per repo (no filesystem IO
 * unless the repo is due): unindexed → fresh (in-memory trigger cap) →
 * resolvable → trigger. Each trigger is a fire-and-forget index via
 * autoIndexIfStale; the module-level indexingRepos guard makes the sweep
 * overlap-safe with tool-triggered / startup indexing, and autoIndexIfStale's
 * own DB-freshness check (same ttlMs) remains the correctness backstop.
 */
export async function sweepWatchedRepos(
	db: SQLiteStore,
	parserPool: ParserPool,
	options: SweepOptions = {}
): Promise<SweepOutcome> {
	const ttlMs = options.ttlMs ?? FILE_WATCH_TTL_MS;
	const now = options.now ?? Date.now();
	const outcome = emptyOutcome();

	for (const [repo, entry] of watchedRepos) {
		// 1. Never index unrequested repos: only repos indexed at least once.
		if (getLastIndexedAt(db, repo) === null) {
			outcome.skippedUnindexed.push(repo);
			continue;
		}

		// 2. Per-repo re-entry cap — keyed on the IN-MEMORY lastTriggeredAt,
		//    NOT DB last_indexed_at (TASK-354). A zero-parse run — the steady
		//    state for an untouched repo (the incremental planner marks every
		//    file "skip") — never advances last_indexed_at, so a DB-keyed cap
		//    would re-trigger a full discovery walk + plan every tick forever.
		//    Keying on the last trigger dispatch throttles the dispatch itself:
		//    minimum period between triggers per repo = ttlMs.
		if (now - entry.lastTriggeredAt < ttlMs) {
			outcome.skippedFresh.push(repo);
			continue;
		}

		// 3. The repo must still be resolvable on disk.
		if (!isRepoPathResolvable(entry.repoPath)) {
			outcome.skippedUnresolvable.push(repo);
			continue;
		}

		// 4. Trigger the incremental re-index (fire-and-forget). Passing the
		//    same short TTL keeps autoIndexIfStale's internal freshness check
		//    consistent with the sweep's — otherwise its 24h default would
		//    silently skip every watcher-triggered run. Advancing
		//    lastTriggeredAt on dispatch means the cap throttles even when the
		//    run parses zero files (nothing advances last_indexed_at).
		const result = await autoIndexIfStale(repo, entry.repoPath, db, parserPool, { ttlMs, owner: entry.owner });
		if (result.status === "started") {
			entry.lastTriggeredAt = now;
			outcome.triggered.push(repo);
		} else if (result.status === "already_indexing") {
			outcome.skippedInFlight.push(repo);
		} else {
			outcome.skippedAuto.push(repo);
		}
	}

	return outcome;
}

// ── Watchdog loop ───────────────────────────────────────────────────────

/** Gate flag — ENABLE_FILE_WATCHER, default enabled; "false" disables. */
export function isFileWatcherEnabled(): boolean {
	return process.env.ENABLE_FILE_WATCHER !== "false";
}

export interface FileWatcherOptions {
	/** Sweep cadence (default FILE_WATCH_INTERVAL_MS, floored at FILE_WATCH_INTERVAL_MIN_MS). */
	intervalMs?: number;
	/** Per-repo re-entry cap passed to autoIndexIfStale (default FILE_WATCH_TTL_MS). */
	ttlMs?: number;
	/** Override the ENABLE_FILE_WATCHER gate (tests). */
	enabled?: boolean;
}

/**
 * The polling watchdog. Exactly ONE instance should be started, in the MCP
 * server process (mcp/server.ts), next to the embedding worker. Lifecycle:
 * start() → first sweep after intervalMs → self-scheduling setTimeout loop
 * (a slow sweep never overlaps the next tick) → stop() clears the timer.
 * The timer is unref'd so a process with no other handles can still exit
 * (mirrors EmbeddingWorker).
 */
export class FileWatcher {
	private readonly db: SQLiteStore;
	private readonly parserPool: ParserPool;
	private readonly intervalMs: number;
	private readonly ttlMs: number;
	private readonly enabled: boolean;
	private running = false;
	private timer: NodeJS.Timeout | null = null;

	constructor(db: SQLiteStore, parserPool: ParserPool, options: FileWatcherOptions = {}) {
		this.db = db;
		this.parserPool = parserPool;
		// Clamp the cadence to a sane floor: a zero/misconfigured interval
		// (env FILE_WATCH_INTERVAL_MS=0 or an option of 0) would create a
		// busy loop (review NIT, TASK-354).
		this.intervalMs = Math.max(options.intervalMs ?? FILE_WATCH_INTERVAL_MS, FILE_WATCH_INTERVAL_MIN_MS);
		this.ttlMs = options.ttlMs ?? FILE_WATCH_TTL_MS;
		this.enabled = options.enabled ?? isFileWatcherEnabled();
	}

	isRunning(): boolean {
		return this.running;
	}

	start(): void {
		if (!this.enabled) {
			logger.info("[FileWatcher] disabled via ENABLE_FILE_WATCHER — sweep not started");
			return;
		}
		if (this.running) return;
		this.running = true;
		// First tick after one full interval: the startup auto-index (and any
		// boot-time tool calls) get first shot before the watcher participates.
		this.scheduleNext(this.intervalMs);
		logger.info("[FileWatcher] started", {
			intervalMs: this.intervalMs,
			ttlMs: this.ttlMs,
			watchedRepos: watchedRepos.size
		});
	}

	stop(): void {
		this.running = false;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	/** Run one sweep immediately — public for tests and manual triggers. */
	async sweepNow(options: SweepOptions = {}): Promise<SweepOutcome> {
		return sweepWatchedRepos(this.db, this.parserPool, { ttlMs: this.ttlMs, ...options });
	}

	private scheduleNext(delayMs: number): void {
		if (!this.running) return;
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.tick();
		}, delayMs);
		this.timer.unref?.();
	}

	private async tick(): Promise<void> {
		if (!this.running) return;
		try {
			const outcome = await this.sweepNow();
			if (outcome.triggered.length > 0) {
				logger.info("[FileWatcher] sweep triggered re-index", { repos: outcome.triggered });
			} else {
				logger.debug("[FileWatcher] sweep idle", {
					fresh: outcome.skippedFresh.length,
					unindexed: outcome.skippedUnindexed.length,
					unresolvable: outcome.skippedUnresolvable.length,
					inFlight: outcome.skippedInFlight.length,
					autoSkipped: outcome.skippedAuto.length
				});
			}
		} catch (err) {
			// A sweep failure must never kill the loop — log and continue on
			// the next tick (mirrors server.ts crash containment).
			logger.error("[FileWatcher] sweep failed", { error: String(err) });
		} finally {
			this.scheduleNext(this.intervalMs);
		}
	}
}
