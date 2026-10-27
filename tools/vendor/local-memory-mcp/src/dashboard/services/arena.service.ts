import { db } from "../lib/context";
import { TASK_STATUS_IN_PROGRESS, TASK_STATUS_PENDING, TASK_STATUS_BLOCKED } from "../../mcp/types/task";
import type { Task } from "../../mcp/types/task";
import type { Claim, Handoff } from "../../mcp/types/handoff";

/**
 * Arena overview service (TASK-269 / audit F7).
 *
 * The Agent Arena previously fanned out to 5 per-repo endpoints
 * (tasks×3 statuses + claims + handoffs) for EVERY repo on first load —
 * ~300 parallel HTTP requests for a 64-repo install, saturating the server
 * (each request carries its own db.refresh/auth/serialization overhead).
 *
 * This service exposes the SAME data as ONE aggregate endpoint: for every
 * repo (the same list the client already knows via /api/repos) it gathers
 * the identical rows the per-repo endpoints returned — same entity methods,
 * same limits (in_progress:10, pending:8, blocked:4, claims:50 active,
 * handoffs:10 pending), same row shapes — so the client's merge/scene-build
 * logic is unchanged. The result is cached with a short TTL
 * (ARENA_OVERVIEW_TTL_MS, default 5 s — matching the client's global-stats
 * cache) because the arena polls every 2.5 s while visible.
 *
 * The "server-side join" here is deliberately in-process: one HTTP request
 * replaces the fan-out, and the per-repo queries are index-scoped
 * (owner/repo/status) instead of 300 serialized HTTP round-trips.
 */

export interface ArenaOverviewData {
	tasks: Task[];
	claims: Claim[];
	handoffs: Handoff[];
}

/** Mirrors the per-repo limits the arena client used (useAgentArena.ts). */
const TASK_LIMITS: Array<{ status: string; limit: number }> = [
	{ status: TASK_STATUS_IN_PROGRESS, limit: 10 },
	{ status: TASK_STATUS_PENDING, limit: 8 },
	{ status: TASK_STATUS_BLOCKED, limit: 4 }
];
const CLAIMS_LIMIT = 50;
const HANDOFFS_LIMIT = 10;

const DEFAULT_TTL_MS = 5_000;
const MAX_ENTRIES = 8;

interface CacheEntry {
	data: ArenaOverviewData;
	expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function ttlMs(): number {
	const raw = Number(process.env.ARENA_OVERVIEW_TTL_MS);
	return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_TTL_MS;
}

function evictIfNeeded(): void {
	if (cache.size < MAX_ENTRIES) return;
	const now = Date.now();
	for (const [key, entry] of cache) {
		if (now >= entry.expiresAt) cache.delete(key);
	}
	while (cache.size >= MAX_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		cache.delete(oldest);
	}
}

/** Test hook: drop cached overviews so the next read recomputes. */
export function clearArenaOverviewCache(): void {
	cache.clear();
}

export const ArenaService = {
	/**
	 * All active tasks + claims + handoffs across every repo, in the exact
	 * shapes the per-repo endpoints returned. Cached for ARENA_OVERVIEW_TTL_MS.
	 */
	getOverview(): ArenaOverviewData {
		const cached = cache.get("overview");
		if (cached && Date.now() < cached.expiresAt) return cached.data;

		const repos = db.system.listRepos("").sort();
		const tasks: Task[] = [];
		const claims: Claim[] = [];
		const handoffs: Handoff[] = [];

		for (const repo of repos) {
			for (const { status, limit } of TASK_LIMITS) {
				tasks.push(...db.tasks.getTasksByRepo("", repo, status, limit, 0));
			}
			claims.push(...db.handoffs.listClaims({ owner: "", repo, active_only: true, limit: CLAIMS_LIMIT, offset: 0 }));
			handoffs.push(
				...db.handoffs.listHandoffs({ owner: "", repo, status: "pending", limit: HANDOFFS_LIMIT, offset: 0 })
			);
		}

		const data: ArenaOverviewData = { tasks, claims, handoffs };
		evictIfNeeded();
		cache.set("overview", { data, expiresAt: Date.now() + ttlMs() });
		return data;
	}
};
