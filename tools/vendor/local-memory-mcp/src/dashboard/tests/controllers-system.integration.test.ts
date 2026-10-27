/**
 * System Controller integration tests (TASK-428 split from controllers.integration.test.ts).
 *
 * Covers SystemController endpoints: /api/health, /api/repos, /api/stats,
 * /api/capabilities, plus the /api/stats TTL cache (OPT-PERF-06 / TASK-202).
 *
 * Split from the original 2165-line file; the shared `vi.mock` + server
 * factory live in controllers.shared.ts so each per-controller suite mounts its
 * own in-memory store. Tests are relocated verbatim — no behavior change.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
// Resolves to the mocked context module (vi.mock lives in controllers.shared.ts,
// which must be imported before any route module). `db` is re-exported from the
// shared module so the test seeds the SAME in-memory store the route mounts.
import { db } from "./controllers.shared";
import { clearRepoStatsCache } from "../services/statsCache";
// TTL stats cache (OPT-PERF-06 / TASK-202) — cleared between /api/stats cache
// tests so each case starts from a cold cache regardless of run order.
import { startControllersServer, waitFor } from "./controllers.shared";

describe("Dashboard Controllers — System API", () => {
	let serverHandle: Awaited<ReturnType<typeof startControllersServer>>;
	let baseUrl: string;

	beforeAll(async () => {
		serverHandle = await startControllersServer();
		baseUrl = serverHandle.baseUrl;
	});

	afterAll(async () => {
		await serverHandle.close();
	});

	// ── System Controller ──────────────────────────────────────────────────

	describe("System API", () => {
		it("GET /api/health returns 200 with health data", async () => {
			const res = await fetch(`${baseUrl}/api/health`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data).toBeDefined();
			expect(body.data.type).toBe("health");
			expect(body.data.attributes.connected).toBe(false);
			expect(body.data.attributes.uptime).toBeGreaterThanOrEqual(0);
			expect(body.data.attributes.version).toBeDefined();
		});

		it("GET /api/repos returns 200 with array", async () => {
			const res = await fetch(`${baseUrl}/api/repos`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(Array.isArray(body.data)).toBe(true);
		});

		it("GET /api/stats returns 200 with global stats", async () => {
			const res = await fetch(`${baseUrl}/api/stats`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("system-stats");
			expect(body.data.attributes).toHaveProperty("total");
			expect(body.data.attributes).toHaveProperty("byType");
		});

		it("GET /api/capabilities returns 200 with tools/resources/prompts", async () => {
			const res = await fetch(`${baseUrl}/api/capabilities`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("capability");
			expect(body.data.attributes).toHaveProperty("tools");
			expect(body.data.attributes).toHaveProperty("resources");
			expect(body.data.attributes).toHaveProperty("prompts");
			expect(Array.isArray(body.data.attributes.tools)).toBe(true);
		});
	});

	// ── Stats caching (OPT-PERF-06 / TASK-202) ─────────────────────────────
	// Repo-scoped /api/stats runs 16+ aggregate queries per call; the TTL cache
	// (statsCache.ts, DASHBOARD_STATS_TTL_MS, default 30 s) serves repeated
	// selects within the window from memory. Contract: identical JSON:API shape
	// on hit and miss; stats may be up to TTL stale — acceptable for an overview.
	// The TTL is read lazily from the env, so each test sets its own window.

	describe("System API — /api/stats caching (OPT-PERF-06)", () => {
		afterEach(() => {
			delete process.env.DASHBOARD_STATS_TTL_MS;
			clearRepoStatsCache();
		});

		it("GET /api/stats?repo=... returns 200 with the repo-scoped shape", async () => {
			const repo = "stats-shape-repo";
			const res = await fetch(`${baseUrl}/api/stats?repo=${repo}`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("system-stats");
			const attrs = body.data.attributes as Record<string, any>;
			expect(attrs.scope).toBe("repo");
			expect(typeof attrs.total).toBe("number");
			expect(typeof attrs.avgImportance).toBe("string");
			expect(typeof attrs.totalHitCount).toBe("number");
			expect(typeof attrs.expiringSoon).toBe("number");
			expect(attrs.byType).toBeDefined();
			expect(attrs.taskStats).toHaveProperty("total");
			expect(Array.isArray(attrs.topMemories)).toBe(true);
		});

		it("GET /api/stats?repo=... serves repeated calls from cache (single compute within TTL)", async () => {
			const repo = "stats-cache-repo";
			// Long window: both calls are guaranteed to land inside the TTL.
			process.env.DASHBOARD_STATS_TTL_MS = "60000";
			clearRepoStatsCache();
			const spy = vi.spyOn(db.system, "getDashboardStats");

			const res1 = await fetch(`${baseUrl}/api/stats?repo=${repo}`);
			expect(res1.status).toBe(200);
			expect(spy).toHaveBeenCalledTimes(1);
			const body1 = await res1.json();

			const res2 = await fetch(`${baseUrl}/api/stats?repo=${repo}`);
			expect(res2.status).toBe(200);
			// Cache hit: the aggregates are NOT recomputed, payload is identical.
			expect(spy).toHaveBeenCalledTimes(1);
			expect(await res2.json()).toEqual(body1);

			spy.mockRestore();
		});

		it("GET /api/stats?repo=... recomputes after the TTL expires", async () => {
			const repo = "stats-expiry-repo";
			// FIX(TASK-392): the TTL was 100 ms — the gap between the warm
			// cache write and the within-TTL fetch below (a direct DB insert +
			// request round-trip) is unbounded under v8 coverage
			// instrumentation, so the entry could expire early and recompute
			// ("expected getDashboardStats called 1×, got 2×"). 2000 ms gives
			// that window a deterministic ~20× margin while keeping the
			// post-TTL wait fast. Assertions are unchanged (exact spy counts
			// and payload totals) — this only widens the timing window.
			process.env.DASHBOARD_STATS_TTL_MS = "2000";
			const ttlMs = Number(process.env.DASHBOARD_STATS_TTL_MS);
			clearRepoStatsCache();
			const spy = vi.spyOn(db.system, "getDashboardStats");

			// Warm the cache (cold compute #1).
			const warm = await fetch(`${baseUrl}/api/stats?repo=${repo}`);
			expect(warm.status).toBe(200);
			expect(spy).toHaveBeenCalledTimes(1);
			const warmBody = (await warm.json()) as Record<string, any>;
			const warmTotal = warmBody.data.attributes.total as number;
			// Upper bound of the cache-write instant: setCachedRepoStats runs
			// DURING the warm request, so this anchor is >= writeTime. Waiting
			// until Date.now() - warmReturnedAt >= ttlMs therefore guarantees
			// the entry has expired (Date.now() >= expiresAt).
			const warmReturnedAt = Date.now();

			// Mutate the data source directly (bypasses the cache entirely).
			db.memories.insert({
				id: randomUUID(),
				type: "code_fact",
				title: "ttl-expiry seed",
				content: "should surface once the stats cache expires",
				importance: 1,
				agent: "test",
				role: "backend",
				model: "test",
				scope: { owner: "", repo },
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				completed_at: null,
				hit_count: 0,
				recall_count: 0,
				last_used_at: null,
				expires_at: null,
				supersedes: null,
				status: "active",
				tags: [],
				metadata: {},
				is_global: false
			});

			// Within the TTL: cached payload served (no recompute, stale total).
			const within = await fetch(`${baseUrl}/api/stats?repo=${repo}`);
			expect(within.status).toBe(200);
			expect(spy).toHaveBeenCalledTimes(1);
			expect(((await within.json()) as Record<string, any>).data.attributes.total).toBe(warmTotal);

			// Past the TTL: poll the clock past the expiry window instead of a
			// fixed sleep (TASK-391 waitFor pattern — completion is detected,
			// not guessed), then the next call must recompute and see the row.
			await waitFor(() => Date.now() - warmReturnedAt >= ttlMs);
			const after = await fetch(`${baseUrl}/api/stats?repo=${repo}`);
			expect(after.status).toBe(200);
			expect(spy).toHaveBeenCalledTimes(2);
			expect(((await after.json()) as Record<string, any>).data.attributes.total).toBe(warmTotal + 1);

			spy.mockRestore();
		});
	});
});
