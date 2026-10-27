/**
 * Unit tests for the dashboard stats TTL cache (OPT-PERF-06 / TASK-202) +
 * the KG graph payload cache (TASK-268 / audit F2).
 *
 * Pure module — no DB, no context. The cache map is module-level, so every
 * case starts from a cold cache (clearRepoStatsCache / clearKgGraphCache in
 * beforeEach). TTL is read lazily from the environment, so each case can
 * shrink it via vi.stubEnv.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getCachedRepoStats,
	setCachedRepoStats,
	clearRepoStatsCache,
	getKgGraphCache,
	setKgGraphCache,
	clearKgGraphCache
} from "../../services/statsCache";

beforeEach(() => {
	clearRepoStatsCache();
	clearKgGraphCache();
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("repo stats cache (getCachedRepoStats / setCachedRepoStats)", () => {
	it("returns undefined on a cold-cache miss", () => {
		expect(getCachedRepoStats("acme", "app")).toBeUndefined();
	});

	it("stores a payload, returns it, and serves the same payload on a warm hit", () => {
		const payload = { totalMemories: 42, totalRepos: 3 };
		const returned = setCachedRepoStats("acme", "app", payload);
		expect(returned).toBe(payload);
		expect(getCachedRepoStats("acme", "app")).toEqual(payload);
	});

	it("keys entries by owner/repo — entries with different owners or repos are independent", () => {
		const first = { id: 1 };
		const second = { id: 2 };
		setCachedRepoStats("acme", "app", first);
		setCachedRepoStats("acme", "other", second);
		setCachedRepoStats("other", "app", second);

		expect(getCachedRepoStats("acme", "app")).toEqual(first);
		expect(getCachedRepoStats("acme", "other")).toEqual(second);
		expect(getCachedRepoStats("other", "app")).toEqual(second);
		// Key collision guard: owner-less repo pair must not alias a real pair.
		expect(getCachedRepoStats("", "")).toBeUndefined();
	});

	it("serves a miss once the TTL has elapsed (DASHBOARD_STATS_TTL_MS=0 expires immediately)", () => {
		vi.stubEnv("DASHBOARD_STATS_TTL_MS", "0");
		setCachedRepoStats("acme", "app", { v: 1 });
		expect(getCachedRepoStats("acme", "app")).toBeUndefined();
	});

	it("removes the entry from the map when it is read after expiry", () => {
		vi.stubEnv("DASHBOARD_STATS_TTL_MS", "0");
		setCachedRepoStats("acme", "app", { v: 1 });
		expect(getCachedRepoStats("acme", "app")).toBeUndefined();
		// A second read must still miss (entry already evicted by the first read).
		expect(getCachedRepoStats("acme", "app")).toBeUndefined();
	});

	it("falls back to the 30s default when the env TTL is not a non-negative number", () => {
		vi.stubEnv("DASHBOARD_STATS_TTL_MS", "-5");
		setCachedRepoStats("acme", "app", { v: 1 });
		// With the default TTL the entry is still warm.
		expect(getCachedRepoStats("acme", "app")).toEqual({ v: 1 });

		vi.stubEnv("DASHBOARD_STATS_TTL_MS", "not-a-number");
		setCachedRepoStats("acme", "app2", { v: 2 });
		expect(getCachedRepoStats("acme", "app2")).toEqual({ v: 2 });
	});

	it("evicts the oldest entry once MAX_ENTRIES (200) is exceeded", () => {
		const firstKey = "owner-first/app";
		for (let i = 0; i < 201; i++) {
			setCachedRepoStats(`owner-${i}`, "app", { i });
		}
		expect(getCachedRepoStats(firstKey.split("/")[0], "app")).toBeUndefined();
		// The newest entry survives.
		expect(getCachedRepoStats("owner-200", "app")).toEqual({ i: 200 });
	});

	it("clearRepoStatsCache drops all entries so the next read recomputes", () => {
		setCachedRepoStats("acme", "app", { v: 1 });
		clearRepoStatsCache();
		expect(getCachedRepoStats("acme", "app")).toBeUndefined();
	});
});

describe("KG graph cache (getKgGraphCache / setKgGraphCache / clearKgGraphCache)", () => {
	it("returns undefined on a miss for the prefixed key", () => {
		expect(getKgGraphCache<unknown>("acme/app|page:0:20|edges:1")).toBeUndefined();
	});

	it("stores and serves a payload under the kg/graph/ prefix", () => {
		const payload = { data: { nodes: [], edges: [] }, totalItems: 0 };
		const returned = setKgGraphCache("acme/app|page:0:20|edges:1", payload);
		expect(returned).toBe(payload);
		expect(getKgGraphCache<typeof payload>("acme/app|page:0:20|edges:1")).toBe(payload);
	});

	it("does not collide with repo-stats keys sharing the same suffix", () => {
		// 'acme/app' as a repo-stats key must not satisfy a KG key of the same text.
		setCachedRepoStats("acme", "app", { stats: true });
		expect(getKgGraphCache<unknown>("acme/app")).toBeUndefined();
	});

	it("expires per DASHBOARD_KG_TTL_MS (0 expires immediately)", () => {
		vi.stubEnv("DASHBOARD_KG_TTL_MS", "0");
		setKgGraphCache("key", { v: 1 });
		expect(getKgGraphCache<{ v: number }>("key")).toBeUndefined();
	});

	it("clearKgGraphCache() drops every KG entry but leaves repo-stats entries intact", () => {
		setKgGraphCache("a|page:0:20|edges:1", { v: 1 });
		setKgGraphCache("b|limit:50|edges:0", { v: 2 });
		setCachedRepoStats("acme", "app", { stats: true });

		clearKgGraphCache();

		expect(getKgGraphCache<unknown>("a|page:0:20|edges:1")).toBeUndefined();
		expect(getKgGraphCache<unknown>("b|limit:50|edges:0")).toBeUndefined();
		expect(getCachedRepoStats("acme", "app")).toEqual({ stats: true });
	});

	it("clearKgGraphCache(repo) drops every windowed key for that repo (prefix filter)", () => {
		// Full stored keys are `kg/graph/<cacheKey>`; KgService.listGraph builds
		// cacheKey as `${repo}|${window}|edges:N`, so the repo is a `|`-terminated
		// prefix. The filter matches `kg/graph/${repo}|`, clearing every window of
		// that repo — unlike the old suffix filter, which could never match a
		// windowed key (TASK-379).
		setKgGraphCache("acme/app|page:0:20|edges:1", { v: 1 });
		setKgGraphCache("acme/app|limit:50|edges:0", { v: 2 });
		// Prefix boundary: a repo that merely starts with the same string must
		// survive — the `|` separator distinguishes `acme/app` from `acme/application`.
		setKgGraphCache("acme/application|page:0:20|edges:1", { v: 3 });
		// A different owner's repo must survive.
		setKgGraphCache("elsewhere/app|page:0:20|edges:1", { v: 4 });

		clearKgGraphCache("acme/app");

		expect(getKgGraphCache<unknown>("acme/app|page:0:20|edges:1")).toBeUndefined();
		expect(getKgGraphCache<unknown>("acme/app|limit:50|edges:0")).toBeUndefined();
		expect(getKgGraphCache<{ v: number }>("acme/application|page:0:20|edges:1")).toEqual({ v: 3 });
		expect(getKgGraphCache<{ v: number }>("elsewhere/app|page:0:20|edges:1")).toEqual({ v: 4 });
	});
});
