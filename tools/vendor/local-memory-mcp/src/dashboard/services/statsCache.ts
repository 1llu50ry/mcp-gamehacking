/**
 * OPT-PERF-06 (TASK-202): TTL cache for repo-scoped dashboard stats.
 *
 * GET /api/stats?repo=… recomputes `SystemEntity.getDashboardStats` on every
 * repo select/refresh — 16+ aggregate queries per call, even though those
 * aggregates are invariant between mutations. This module adds a short
 * server-side TTL (default 30 s, configurable via `DASHBOARD_STATS_TTL_MS`) so
 * repeated selects within the window are served from memory instead of
 * re-aggregating.
 *
 * STALENESS: stats may be up to `ttlMs` stale after a mutation — accepted
 * trade-off for a dashboard overview. Write mutations span many MCP tools, so
 * TTL expiry (not per-mutation invalidation) is the safe low-risk strategy.
 *
 * The TTL is read lazily from the environment so tests can shrink it per case;
 * production sets `DASHBOARD_STATS_TTL_MS` once at process start.
 */

interface CacheEntry {
	data: unknown;
	expiresAt: number;
}

/** Keyed by `${owner}/${repo}` — one entry per repo the dashboard has selected. */
const cache = new Map<string, CacheEntry>();

const DEFAULT_TTL_MS = 30_000;

/** Upper bound on cached repos — a dashboard holds a handful; this only guards
 * against unbounded growth from arbitrary `repo` query params. */
const MAX_ENTRIES = 200;

function ttlMs(): number {
	const raw = Number(process.env.DASHBOARD_STATS_TTL_MS);
	return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_TTL_MS;
}

function keyFor(owner: string, repo: string): string {
	return `${owner}/${repo}`;
}

/** Returns the cached payload for `owner/repo`, or `undefined` on miss/expiry. */
export function getCachedRepoStats<T>(owner: string, repo: string): T | undefined {
	const entry = cache.get(keyFor(owner, repo));
	if (!entry) return undefined;
	if (Date.now() >= entry.expiresAt) {
		cache.delete(keyFor(owner, repo));
		return undefined;
	}
	return entry.data as T;
}

/** Stores `data` under `owner/repo` with a fresh TTL and returns it. */
export function setCachedRepoStats<T>(owner: string, repo: string, data: T): T {
	// Guard against unbounded growth: drop expired entries first, then the
	// oldest entries (Map preserves insertion order) if still over the cap.
	if (cache.size >= MAX_ENTRIES) {
		for (const [key, entry] of cache) {
			if (Date.now() >= entry.expiresAt) cache.delete(key);
		}
		while (cache.size >= MAX_ENTRIES) {
			const oldest = cache.keys().next().value;
			if (oldest === undefined) break;
			cache.delete(oldest);
		}
	}
	cache.set(keyFor(owner, repo), { data, expiresAt: Date.now() + ttlMs() });
	return data;
}

/** Test hook: drop all cached entries so the next read recomputes. */
export function clearRepoStatsCache(): void {
	cache.clear();
}

// ---------------------------------------------------------------------------
// KG graph payload cache (TASK-268 / audit F2)
// ---------------------------------------------------------------------------

/**
 * Server-side cache for assembled KG graph payloads, reusing the same TTL
 * map as repo stats. The graph assembly (degree-ranked node window + edges)
 * is the dashboard's most expensive read path when computed from scratch —
 * for edge-heavy repos it previously re-aggregated EVERY relation of the
 * repo per request. Caching the assembled payload (keyed on repo + the
 * requested window) makes repeated/tab-switch loads ~0ms and bounds the
 * compute cost to one pass per window per TTL.
 *
 * TTL is read from `DASHBOARD_KG_TTL_MS` (default 30 s, same value as the
 * stats TTL) so tests can shrink it per case.
 *
 * STALENESS: same trade-off as repo stats — KG mutations performed through
 * the dashboard clear the cache immediately (`clearKgGraphCache`), while
 * MCP-side writes may be up to `ttlMs` stale. Accepted for a dashboard view.
 *
 * Keys use the `kg/graph/` prefix so they never collide with `owner/repo`
 * stats keys, and share the MAX_ENTRIES eviction guard.
 */
const KG_CACHE_PREFIX = "kg/graph/";

function kgTtlMs(): number {
	const raw = Number(process.env.DASHBOARD_KG_TTL_MS);
	return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_TTL_MS;
}

/** Returns the cached KG payload for `key`, or `undefined` on miss/expiry. */
export function getKgGraphCache<T>(key: string): T | undefined {
	const entry = cache.get(KG_CACHE_PREFIX + key);
	if (!entry) return undefined;
	if (Date.now() >= entry.expiresAt) {
		cache.delete(KG_CACHE_PREFIX + key);
		return undefined;
	}
	return entry.data as T;
}

/** Stores `data` under the KG cache `key` with a fresh TTL and returns it. */
export function setKgGraphCache<T>(key: string, data: T): T {
	cache.set(KG_CACHE_PREFIX + key, { data, expiresAt: Date.now() + kgTtlMs() });
	return data;
}

/**
 * Drop cached KG payloads for `repo`; absent clears the whole KG cache.
 *
 * KgService.listGraph stores payloads under `kg/graph/${repo}|${window}|edges:N`,
 * so a repo-scoped clear matches the repo prefix + `|` — every window of that
 * repo. The `|` separator keeps e.g. `acme/app` from clearing
 * `acme/application` entries (TASK-379: the previous filter used
 * `endsWith(repo)`, which can never match a windowed key, making the `repo`
 * param dead).
 */
export function clearKgGraphCache(repo?: string): void {
	for (const key of cache.keys()) {
		if (!key.startsWith(KG_CACHE_PREFIX)) continue;
		if (repo !== undefined && !key.startsWith(KG_CACHE_PREFIX + repo + "|")) continue;
		cache.delete(key);
	}
}
