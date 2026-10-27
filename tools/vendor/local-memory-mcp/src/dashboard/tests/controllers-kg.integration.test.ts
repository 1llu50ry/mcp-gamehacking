/**
 * KG Controller integration tests (TASK-428 split from controllers.integration.test.ts).
 *
 * Covers KGController endpoints: entities, relations, graph — including
 * pagination + truncated (OPT-FEAT-02/03), the graphLimit top-N view (TASK-212),
 * and the graph TTL cache + invalidation (TASK-268).
 *
 * Split from the original 2165-line file; the shared `vi.mock` + server
 * factory live in controllers.shared.ts. Tests are relocated verbatim — no
 * behavior change.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Resolves to the mocked context module (vi.mock lives in controllers.shared.ts,
// which must be imported before any route module). `db` is re-exported from the
// shared module so the test seeds the SAME in-memory store the route mounts.
import { db } from "./controllers.shared";
// KG_MAX_GRAPH_EDGES is captured at constants.ts module load under the test
// override (controllers.shared.ts sets KG_MAX_GRAPH_EDGES=10 before constants
// loads) — used by the truncated graph assertion.
import { KG_MAX_GRAPH_EDGES } from "../../mcp/utils/constants";
import { startControllersServer } from "./controllers.shared";

describe("Dashboard Controllers — KG API", () => {
	let serverHandle: Awaited<ReturnType<typeof startControllersServer>>;
	let baseUrl: string;

	beforeAll(async () => {
		serverHandle = await startControllersServer();
		baseUrl = serverHandle.baseUrl;
	});

	afterAll(async () => {
		await serverHandle.close();
	});

	// ── KG Controller ─────────────────────────────────────────────────────

	describe("KG API", () => {
		it("GET /api/kg/entities returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/kg/entities`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/repo/i);
		});

		it("GET /api/kg/entities?repo=test-repo returns 200 with array", async () => {
			const res = await fetch(`${baseUrl}/api/kg/entities?repo=test-repo`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(Array.isArray(body.data)).toBe(true);
			// Pagination meta (OPT-FEAT-02): same {page, pageSize, totalItems,
			// totalPages} shape as listGraph — the data array shape is unchanged.
			expect(body.meta).toHaveProperty("page");
			expect(body.meta).toHaveProperty("pageSize");
			expect(body.meta).toHaveProperty("totalItems");
			expect(body.meta).toHaveProperty("totalPages");
		});

		it("GET /api/kg/entities/nonexist returns 404", async () => {
			const res = await fetch(`${baseUrl}/api/kg/entities/nonexist?repo=test-repo`);
			expect(res.status).toBe(404);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/not found/i);
		});

		it("GET /api/kg/relations returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/kg/relations`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/repo/i);
		});

		it("GET /api/kg/graph returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/kg/graph`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/repo/i);
		});

		it("GET /api/kg/graph?repo=test-repo returns 200 with nodes and edges", async () => {
			const res = await fetch(`${baseUrl}/api/kg/graph?repo=test-repo`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("graph");
			expect(body.data.attributes).toHaveProperty("nodes");
			expect(body.data.attributes).toHaveProperty("edges");
			expect(Array.isArray(body.data.attributes.nodes)).toBe(true);
			expect(Array.isArray(body.data.attributes.edges)).toBe(true);
		});

		it("GET /api/kg/graph?repo=test-repo&includeEdges=false returns 200 with empty edges", async () => {
			const res = await fetch(`${baseUrl}/api/kg/graph?repo=test-repo&includeEdges=false`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("graph");
			expect(Array.isArray(body.data.attributes.nodes)).toBe(true);
			expect(body.data.attributes.edges).toEqual([]);
			expect(body.data.attributes.truncated).toBe(false);
		});

		it("GET /api/kg/graph edges carry the relation confidence field (TASK-325)", async () => {
			const repo = "kg-conf-api";
			const now = new Date().toISOString();
			db.knowledgeGraph.upsertEntity({
				name: "Alpha",
				type: "concept",
				description: null,
				repo,
				owner: "test",
				created_at: now,
				updated_at: now
			});
			db.knowledgeGraph.upsertEntity({
				name: "Beta",
				type: "concept",
				description: null,
				repo,
				owner: "test",
				created_at: now,
				updated_at: now
			});
			db.knowledgeGraph.upsertRelation({
				from_entity: "Alpha",
				to_entity: "Beta",
				relation_type: "related_to",
				repo,
				owner: "test",
				created_at: now,
				confidence: 0.8
			});

			const res = await fetch(`${baseUrl}/api/kg/graph?repo=${repo}&includeEdges=true`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			const edges = body.data.attributes.edges as Array<Record<string, unknown>>;
			expect(edges).toHaveLength(1);
			expect(edges[0]).toEqual({ source: "Alpha", target: "Beta", relation_type: "related_to", confidence: 0.8 });
		});
	});

	// ── KG pagination + truncated (OPT-FEAT-02 / OPT-FEAT-03) ───────────────
	// List endpoints carry JSON:API pagination meta; the graph `truncated`
	// flag is driven by a LIMIT+1 probe so it is only true when the edge set
	// exceeds KG_MAX_GRAPH_EDGES (TASK-148 pattern).

	describe("KG API — pagination + truncated (OPT-FEAT-02/03)", () => {
		const now = new Date().toISOString();

		const seedEntities = (repo: string, count: number) => {
			for (let i = 0; i < count; i++) {
				db.knowledgeGraph.upsertEntity({
					name: `${repo}-entity-${i}`,
					type: "concept",
					description: null,
					repo,
					owner: "test",
					created_at: now,
					updated_at: now
				});
			}
		};

		const seedRelation = (repo: string, from: string, to: string, relationType: string) => {
			db.knowledgeGraph.upsertRelation({
				from_entity: from,
				to_entity: to,
				relation_type: relationType,
				repo,
				owner: "test",
				created_at: now
			});
		};

		it("GET /api/kg/entities paginates with meta (default pageSize 20)", async () => {
			const repo = "kg-pag-entities";
			seedEntities(repo, 25);

			const res = await fetch(`${baseUrl}/api/kg/entities?repo=${repo}`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data).toHaveLength(20);
			expect(body.meta).toEqual({ page: 1, pageSize: 20, totalItems: 25, totalPages: 2 });
		});

		it("GET /api/kg/entities honors page/pageSize, offsets correctly, clamps pageSize to 100", async () => {
			const repo = "kg-pag-entities-page";
			seedEntities(repo, 25);

			const page1Res = await fetch(`${baseUrl}/api/kg/entities?repo=${repo}&pageSize=10`);
			expect(page1Res.status).toBe(200);
			const page1 = (await page1Res.json()) as Record<string, any>;
			const page2Res = await fetch(`${baseUrl}/api/kg/entities?repo=${repo}&page=2&pageSize=10`);
			expect(page2Res.status).toBe(200);
			const page2 = (await page2Res.json()) as Record<string, any>;
			expect(page2.data).toHaveLength(10);
			expect(page2.meta).toEqual({ page: 2, pageSize: 10, totalItems: 25, totalPages: 3 });

			// Offset slicing: page 1 and page 2 are disjoint windows of the same set.
			const names = (arr: Array<Record<string, any>>) => arr.map((item) => item.attributes.name);
			const union = new Set([...names(page1.data), ...names(page2.data)]);
			expect(union.size).toBe(20);

			// Clamp: pageSize above 100 falls back to the 100 max (parsePageParams).
			const clampedRes = await fetch(`${baseUrl}/api/kg/entities?repo=${repo}&pageSize=500`);
			expect(clampedRes.status).toBe(200);
			const clamped = (await clampedRes.json()) as Record<string, any>;
			expect(clamped.meta.pageSize).toBe(100);
			expect(clamped.data).toHaveLength(25);
		});

		it("GET /api/kg/relations returns 200 with array + pagination meta", async () => {
			const repo = "kg-pag-relations";
			seedEntities(repo, 41);
			for (let i = 1; i <= 40; i++) {
				seedRelation(repo, `${repo}-entity-0`, `${repo}-entity-${i}`, `rel-${i}`);
			}

			const res = await fetch(`${baseUrl}/api/kg/relations?repo=${repo}&pageSize=10`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(Array.isArray(body.data)).toBe(true);
			expect(body.data).toHaveLength(10);
			expect(body.meta).toEqual({ page: 1, pageSize: 10, totalItems: 40, totalPages: 4 });
		});

		it("GET /api/kg/graph sets truncated=true when edges exceed the cap (LIMIT+1 probe)", async () => {
			const repo = "kg-truncated";
			// Hub-spoke: KG_MAX_GRAPH_EDGES (10 under the test override) + 1
			// relations → the probe returns 11 rows and the controller slices
			// to the cap with truncated=true (OPT-FEAT-03 / TASK-148 pattern).
			seedEntities(repo, 12);
			for (let i = 1; i <= 11; i++) {
				seedRelation(repo, `${repo}-entity-0`, `${repo}-entity-${i}`, "rel");
			}

			const res = await fetch(`${baseUrl}/api/kg/graph?repo=${repo}`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.attributes.truncated).toBe(true);
			expect(body.data.attributes.edges).toHaveLength(KG_MAX_GRAPH_EDGES);
			// Nodes are paginated independently of the edge cap (still meta'd).
			expect(body.meta).toHaveProperty("totalItems");
			expect(body.meta.totalItems).toBe(12);
		});
	});

	// ── KG graphLimit top-N view (TASK-212) ────────────────────────────────
	// `graphLimit` overrides page/pageSize for the top-N-by-degree graph view:
	// bypasses the pageSize clamp (max 100) so a renderer can fetch its full
	// top-N window (up to 1000, client-side MAX_GRAPH_LIMIT) in one request.
	// When absent, the legacy paginated behavior is unchanged (covered by the
	// tests above).

	describe("KG API — graphLimit top-N view (TASK-212)", () => {
		const now = new Date().toISOString();

		const seedEntities = (repo: string, count: number) => {
			for (let i = 0; i < count; i++) {
				db.knowledgeGraph.upsertEntity({
					name: `${repo}-entity-${i}`,
					type: "concept",
					description: null,
					repo,
					owner: "test",
					created_at: now,
					updated_at: now
				});
			}
		};

		it("GET /api/kg/graph?repo=X&graphLimit=250 returns top-250 nodes of 260 with graphLimit meta", async () => {
			const repo = "kg-graphlimit";
			seedEntities(repo, 260);

			const res = await fetch(`${baseUrl}/api/kg/graph?repo=${repo}&graphLimit=250`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("graph");
			// Top-N window: never more than graphLimit nodes, and for a fresh
			// repo with 260 seeded entities exactly 250 (degree ties broken by
			// name — the ordering is stable, only the count matters here).
			expect(Array.isArray(body.data.attributes.nodes)).toBe(true);
			expect(body.data.attributes.nodes.length).toBeLessThanOrEqual(250);
			expect(body.data.attributes.nodes.length).toBe(250);
			// includeEdges default (TASK-197): edges still fetched + probed.
			expect(body.data.attributes).toHaveProperty("edges");
			expect(body.data.attributes).toHaveProperty("truncated");
			// Meta drives the renderer's "Top N of M" readout.
			expect(body.meta.totalItems).toBe(260);
			expect(body.meta.totalPages).toBe(2); // ceil(260 / 250)
			expect(body.meta.graphLimit).toBe(250);
		});

		it("GET /api/kg/graph clamps graphLimit into [100, 1000]", async () => {
			const repo = "kg-graphlimit-clamp";
			seedEntities(repo, 1200);

			const clampedRes = await fetch(`${baseUrl}/api/kg/graph?repo=${repo}&graphLimit=5000`);
			expect(clampedRes.status).toBe(200);
			const clamped = (await clampedRes.json()) as Record<string, any>;
			expect(clamped.meta.graphLimit).toBe(1000);
			expect(clamped.data.attributes.nodes.length).toBeLessThanOrEqual(1000);

			const flooredRes = await fetch(`${baseUrl}/api/kg/graph?repo=${repo}&graphLimit=50`);
			expect(flooredRes.status).toBe(200);
			const floored = (await flooredRes.json()) as Record<string, any>;
			expect(floored.meta.graphLimit).toBe(100);
			expect(floored.data.attributes.nodes.length).toBeLessThanOrEqual(100);
		});

		it("GET /api/kg/graph rejects non-positive-integer graphLimit with 400", async () => {
			const repo = "kg-graphlimit-invalid";
			seedEntities(repo, 5);

			for (const bad of ["abc", "-1", "0", "1.5"]) {
				const res = await fetch(`${baseUrl}/api/kg/graph?repo=${repo}&graphLimit=${bad}`);
				expect(res.status).toBe(400);
				const body = (await res.json()) as Record<string, any>;
				expect(body.errors[0].detail).toMatch(/graphLimit/i);
			}
		});
	});

	// ── KG graph cache + invalidation (TASK-268 / audit F2) ─────────────────
	// The graph payload is assembled once per repo+window and served from the
	// KG graph TTL cache (statsCache) for the TTL; dashboard-initiated KG
	// mutations must invalidate the cache so edits are reflected immediately.

	describe("KG API — graph TTL cache + invalidation (TASK-268)", () => {
		const now = new Date().toISOString();

		const seedEntity = (repo: string, name: string) => {
			db.knowledgeGraph.upsertEntity({
				name,
				type: "concept",
				description: null,
				repo,
				owner: "test",
				created_at: now,
				updated_at: now
			});
		};

		it("reflects a relation created via the API immediately (cache invalidation)", async () => {
			const repo = "kg-cache-inval";
			// Keep descriptive names for this cache invalidation fixture.
			seedEntity(repo, `${repo}-hub`);
			seedEntity(repo, `${repo}-leaf-a`);
			seedEntity(repo, `${repo}-leaf-b`);
			db.knowledgeGraph.upsertRelation({
				from_entity: `${repo}-hub`,
				to_entity: `${repo}-leaf-a`,
				relation_type: "related_to",
				repo,
				owner: "test",
				created_at: now
			});

			// First fetch: assembles + caches the payload (window includes all 3 nodes).
			const firstRes = await fetch(`${baseUrl}/api/kg/graph?repo=${repo}`);
			expect(firstRes.status).toBe(200);
			const first = (await firstRes.json()) as Record<string, any>;
			expect(first.data.attributes.edges).toHaveLength(1);

			// Mutate through the API — must invalidate the cached graph payload.
			const createRes = await fetch(`${baseUrl}/api/kg/relations`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "relation",
						attributes: {
							from_entity: `${repo}-hub`,
							to_entity: `${repo}-leaf-b`,
							relation_type: "related",
							repo
						}
					}
				})
			});
			expect(createRes.status).toBe(200);

			// Second fetch: same window, but the new relation must be present.
			const secondRes = await fetch(`${baseUrl}/api/kg/graph?repo=${repo}`);
			expect(secondRes.status).toBe(200);
			const second = (await secondRes.json()) as Record<string, any>;
			const edges = second.data.attributes.edges as Array<{ source: string; target: string }>;
			expect(edges).toHaveLength(2);
			expect(edges.some((e) => e.source === `${repo}-hub` && e.target === `${repo}-leaf-b`)).toBe(true);
		});

		it("legacy pageSize window ships only subset-bounded edges (both endpoints in window)", async () => {
			const repo = "kg-subset-window";
			// 5 entities → legacy default pageSize 20 returns all of them.
			seedEntity(repo, `${repo}-hub`);
			seedEntity(repo, `${repo}-node-a`);
			seedEntity(repo, `${repo}-node-b`);
			seedEntity(repo, `${repo}-hub2`);
			seedEntity(repo, `${repo}-node-c`);
			for (const [from, to] of [
				[`${repo}-hub`, `${repo}-node-a`],
				[`${repo}-hub`, `${repo}-node-b`],
				[`${repo}-hub2`, `${repo}-node-c`]
			] as Array<[string, string]>) {
				db.knowledgeGraph.upsertRelation({
					from_entity: from,
					to_entity: to,
					relation_type: "related",
					repo,
					owner: "test",
					created_at: now
				});
			}

			const res = await fetch(`${baseUrl}/api/kg/graph?repo=${repo}&pageSize=10`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			const edges = body.data.attributes.edges as Array<{ source: string; target: string }>;
			// All edges connect pairs within the 5-node window.
			expect(edges).toHaveLength(3);
		});
	});
});
