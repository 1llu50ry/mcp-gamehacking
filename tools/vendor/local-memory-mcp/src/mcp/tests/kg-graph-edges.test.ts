import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestStore, SQLiteStore } from "../storage/sqlite";

// ---------------------------------------------------------------------------
// Server-side graph edge cap (TASK-070)
// ---------------------------------------------------------------------------

describe("KnowledgeGraphEntity — server-side graph edge cap (TASK-070)", () => {
	let db: SQLiteStore;

	const REPO = "kg-graph-cap-test";

	/** Insert the node subset + edges and return the expected degree ranks. */
	function seedGraph(): void {
		const now = new Date().toISOString();
		for (const name of ["A", "B", "C", "D"]) {
			db.db
				.prepare(
					"INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
				)
				.run(name, "concept", null, REPO, "test", now, now);
		}
		// Edges: A→B, A→C, B→C, D→A, B→D
		const edges: Array<[string, string]> = [
			["A", "B"],
			["A", "C"],
			["B", "C"],
			["D", "A"],
			["B", "D"]
		];
		for (const [from, to] of edges) {
			db.knowledgeGraph.upsertRelation({
				from_entity: from,
				to_entity: to,
				relation_type: "related_to",
				repo: REPO,
				owner: "test",
				created_at: now
			});
		}
	}

	beforeEach(async () => {
		db = await createTestStore();
		seedGraph();
	});

	afterEach(() => {
		db.close();
	});

	it("listGraphEdges caps to top-N by endpoint degree, not a random slice", () => {
		// Degrees: A=3 (AB,AC,DA), B=3 (AB,BC,BD), C=2 (AC,BC), D=2 (DA,BD).
		// A→B has the highest combined degree (3+3=6); the rest tie at 5 and
		// fall back to (from_entity, to_entity) ordering.
		const edges = db.knowledgeGraph.listGraphEdges(REPO, 2);
		expect(edges).toHaveLength(2);
		expect(edges[0]).toEqual({ source: "A", target: "B", relation_type: "related_to", confidence: 1 });
		expect(edges[1]).toEqual({ source: "A", target: "C", relation_type: "related_to", confidence: 1 });
	});

	it("listGraphEdges returns everything below the cap", () => {
		const edges = db.knowledgeGraph.listGraphEdges(REPO);
		expect(edges.length).toBe(5); // 5 edges < default KG_MAX_GRAPH_EDGES
	});

	it("listRelationsForGraph filters edges to the node subset (both endpoints in set)", () => {
		const rels = db.knowledgeGraph.listRelationsForGraph(REPO, ["A", "B"]);
		expect(rels).toHaveLength(1); // only A→B has both endpoints in {A, B}
		expect(rels[0].from_entity).toBe("A");
		expect(rels[0].to_entity).toBe("B");
	});

	it("listRelationsForGraph with an empty node subset ships no edges", () => {
		expect(db.knowledgeGraph.listRelationsForGraph(REPO, [])).toHaveLength(0);
	});

	it("listRelationsForGraph keeps legacy behavior when no subset is given", () => {
		const rels = db.knowledgeGraph.listRelationsForGraph(REPO);
		expect(rels.length).toBe(5);
	});
});

// ---------------------------------------------------------------------------
// Probe/truncated flag (TASK-148)
//
// listGraphEdges with probe=true requests limit+1 rows so callers can detect
// truncation without a separate COUNT query. The extra probe row is never
// returned to the client — the caller slices to limit before shipping.
// ---------------------------------------------------------------------------

describe("KnowledgeGraphEntity — probe/truncated detection (TASK-148)", () => {
	let db: SQLiteStore;

	const REPO = "kg-probe-test";
	const CAP = 4; // small cap for testing

	beforeEach(async () => {
		db = await createTestStore();
		const now = new Date().toISOString();
		// Seed 6 entities (A–F) and 6 edges so we exceed CAP.
		for (const name of ["A", "B", "C", "D", "E", "F"]) {
			db.db
				.prepare(
					"INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
				)
				.run(name, "concept", null, REPO, "test", now, now);
		}
		const edges: Array<[string, string]> = [
			["A", "B"],
			["A", "C"],
			["B", "C"],
			["D", "E"],
			["E", "F"],
			["F", "A"]
		];
		for (const [from, to] of edges) {
			db.knowledgeGraph.upsertRelation({
				from_entity: from,
				to_entity: to,
				relation_type: "related_to",
				repo: REPO,
				owner: "test",
				created_at: now
			});
		}
	});

	afterEach(() => {
		db.close();
	});

	it("probe=true returns cap+1 rows when graph exceeds cap", () => {
		const edges = db.knowledgeGraph.listGraphEdges(REPO, CAP, true);
		// 6 edges > CAP (4), so probe returns CAP+1 = 5 rows
		expect(edges).toHaveLength(CAP + 1);
	});

	it("probe=false (default) returns exactly cap rows when graph exceeds cap", () => {
		const edges = db.knowledgeGraph.listGraphEdges(REPO, CAP, false);
		expect(edges).toHaveLength(CAP);
	});

	it("probe=true returns all rows when graph is at or below cap", () => {
		// Use a high cap so all 6 edges fit
		const edges = db.knowledgeGraph.listGraphEdges(REPO, 10, true);
		expect(edges).toHaveLength(6);
	});

	it("probe detection: truncated = rawEdges.length > cap", () => {
		const rawEdges = db.knowledgeGraph.listGraphEdges(REPO, CAP, true);
		const truncated = rawEdges.length > CAP;
		expect(truncated).toBe(true);

		// Caller slices to cap
		const edges = truncated ? rawEdges.slice(0, CAP) : rawEdges;
		expect(edges).toHaveLength(CAP);
	});

	it("no-truncation detection: truncated = false when at cap", () => {
		// Use CAP equal to total edges
		const rawEdges = db.knowledgeGraph.listGraphEdges(REPO, 6, true);
		const truncated = rawEdges.length > 6;
		expect(truncated).toBe(false);
		expect(rawEdges).toHaveLength(6);
	});
});

// ---------------------------------------------------------------------------
// Subset-bounded graph edges (TASK-268 / audit F2)
//
// The dashboard graph payload is assembled from the fetched top-N node
// window: listGraphEdgesForSubset returns ONLY edges whose BOTH endpoints
// are in that window (every shipped edge is drawable) and ranks them by
// endpoint degree via the materialized kg_degrees cache (migration v22).
// This bounds the edge query to the window instead of sorting ALL of the
// repo's relations per request (the former ~23s warm / ~190s cold path).
// ---------------------------------------------------------------------------

describe("KnowledgeGraphEntity — subset-bounded graph edges (TASK-268)", () => {
	let db: SQLiteStore;

	const REPO = "kg-subset-test";

	function seedGraph() {
		const now = new Date().toISOString();
		// Entities A–D; edges: AB, AC, BC, DA, BD.
		// Degrees: A=3 (AB,AC,DA), B=3 (AB,BC,BD), C=2 (AC,BC), D=2 (DA,BD).
		for (const name of ["A", "B", "C", "D"]) {
			db.knowledgeGraph.upsertEntity({
				name,
				type: "concept",
				description: null,
				repo: REPO,
				owner: "test",
				created_at: now,
				updated_at: now
			});
		}
		const edges: Array<[string, string]> = [
			["A", "B"],
			["A", "C"],
			["B", "C"],
			["D", "A"],
			["B", "D"]
		];
		for (const [from, to] of edges) {
			db.knowledgeGraph.upsertRelation({
				from_entity: from,
				to_entity: to,
				relation_type: "related_to",
				repo: REPO,
				owner: "test",
				created_at: now
			});
		}
	}

	beforeEach(async () => {
		db = await createTestStore();
		seedGraph();
	});

	afterEach(() => {
		db.close();
	});

	it("returns only edges with BOTH endpoints in the subset", () => {
		const edges = db.knowledgeGraph.listGraphEdgesForSubset(REPO, ["A", "B"]);
		expect(edges).toHaveLength(1); // only A→B is fully inside {A, B}
		expect(edges[0]).toEqual({ source: "A", target: "B", relation_type: "related_to", confidence: 1 });
	});

	it("ranks subset edges by endpoint degree like the full graph", () => {
		// Combined degrees: AB=6, AC=5, BC=5, BD=5, DA=5 (ties by from,to).
		const edges = db.knowledgeGraph.listGraphEdgesForSubset(REPO, ["A", "B", "C", "D"], 2);
		expect(edges).toHaveLength(2);
		expect(edges[0]).toEqual({ source: "A", target: "B", relation_type: "related_to", confidence: 1 });
		expect(edges[1]).toEqual({ source: "A", target: "C", relation_type: "related_to", confidence: 1 });
	});

	it("probe=true returns cap+1 rows so callers detect truncation", () => {
		// 5 subset edges > cap 4 → probe returns 5 rows; caller slices to 4.
		const raw = db.knowledgeGraph.listGraphEdgesForSubset(REPO, ["A", "B", "C", "D"], 4, true);
		expect(raw).toHaveLength(5);
		const truncated = raw.length > 4;
		expect(truncated).toBe(true);
		expect(truncated ? raw.slice(0, 4) : raw).toHaveLength(4);
	});

	it("returns everything below the cap and empty for an empty subset", () => {
		expect(db.knowledgeGraph.listGraphEdgesForSubset(REPO, ["A", "B", "C", "D"])).toHaveLength(5);
		expect(db.knowledgeGraph.listGraphEdgesForSubset(REPO, [])).toHaveLength(0);
	});

	it("degree cache stays consistent across writes and deletes", () => {
		// Insert a new relation B→A (self-loop-free, both endpoints existing):
		// degree of A and B should bump to 4.
		const now = new Date().toISOString();
		db.knowledgeGraph.upsertRelation({
			from_entity: "B",
			to_entity: "A",
			relation_type: "backlink",
			repo: REPO,
			owner: "test",
			created_at: now
		});
		const degreeRow = db.db.prepare("SELECT degree FROM kg_degrees WHERE repo = ? AND node = ?").get(REPO, "A") as {
			degree: number;
		};
		expect(degreeRow.degree).toBe(4);

		// Deleting the relation decrements back to 3.
		db.knowledgeGraph.deleteRelation("B", "A", "backlink", REPO);
		const after = db.db.prepare("SELECT degree FROM kg_degrees WHERE repo = ? AND node = ?").get(REPO, "A") as {
			degree: number;
		};
		expect(after.degree).toBe(3);

		// Edge set reflects the mutation (backlink now absent).
		const edges = db.knowledgeGraph.listGraphEdgesForSubset(REPO, ["A", "B", "C", "D"]);
		expect(edges).toHaveLength(5);
		expect(edges.some((e) => e.relation_type === "backlink")).toBe(false);
	});

	it("listGraphNodes is degree-ordered via the kg_degrees cache", () => {
		const nodes = db.knowledgeGraph.listGraphNodes(REPO, { limit: 10 });
		// A and B tie at degree 3; name ordering breaks the tie.
		expect(nodes[0].name).toBe("A");
		expect(nodes[1].name).toBe("B");
		expect(
			nodes
				.map((n) => n.name)
				.slice(0, 4)
				.sort()
		).toEqual(["A", "B", "C", "D"]);
	});
});
