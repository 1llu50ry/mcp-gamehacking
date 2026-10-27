// @vitest-environment node
/**
 * ArenaLayoutManager — core layout engine tests (TASK-249).
 *
 * Pure TypeScript spatial layout: no DOM / canvas / Svelte involved, so the
 * suite runs in the default node environment. Covers the eight mandatory
 * contracts from the task spec: grid alignment, non-overlap, responsive
 * sizing, per-band span sums, workstation placement, caching, section
 * registration, and workflow edges.
 */

import { describe, it, expect } from "vitest";
import { ArenaLayoutManager, getArenaLayoutManager } from "../arena-layout/ArenaLayoutManager";
import { GRID_COLUMNS, MAX_TASKS_PER_ZONE, allocateSpans } from "../arena-layout/grid";
import type { SectionBounds, SectionDefinition } from "../arena-layout/types";

function reviewDefinition(): SectionDefinition {
	return {
		id: "review",
		label: "Review",
		band: "main",
		weight: 6,
		minSpan: 2,
		maxSpan: 6,
		color: "#10b981",
		decorStyle: "quality",
		flowStage: 4
	};
}

function sectionById(sections: SectionBounds[], id: string): SectionBounds {
	const found = sections.find((s) => s.id === id);
	expect(found).toBeDefined();
	return found as SectionBounds;
}

/** True when a point lies on one of the four edges of a rect (within epsilon). */
function onRectEdge(rect: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }): boolean {
	const EPS = 1e-6;
	const onTop = Math.abs(p.y - rect.y) <= EPS && p.x >= rect.x - EPS && p.x <= rect.x + rect.w + EPS;
	const onBottom = Math.abs(p.y - (rect.y + rect.h)) <= EPS && p.x >= rect.x - EPS && p.x <= rect.x + rect.w + EPS;
	const onLeft = Math.abs(p.x - rect.x) <= EPS && p.y >= rect.y - EPS && p.y <= rect.y + rect.h + EPS;
	const onRight = Math.abs(p.x - (rect.x + rect.w)) <= EPS && p.y >= rect.y - EPS && p.y <= rect.y + rect.h + EPS;
	return onTop || onBottom || onLeft || onRight;
}

describe("ArenaLayoutManager", () => {
	describe("1. grid alignment", () => {
		it("pending (main) and backlog (exception) share identical x/w when same span", () => {
			// Occupancy that forces both to their max span of 6.
			const mgr = new ArenaLayoutManager(960, 640);
			mgr.setOccupancy({ pending: 12, backlog: 12 });
			const sections = mgr.getSections();
			const pending = sectionById(sections, "pending");
			const backlog = sectionById(sections, "backlog");

			expect(pending.span).toBe(6);
			expect(backlog.span).toBe(6);
			expect(pending.startCol).toBe(0);
			expect(backlog.startCol).toBe(0);
			expect(pending.rect.x).toBeCloseTo(backlog.rect.x, 6);
			expect(pending.rect.w).toBeCloseTo(backlog.rect.w, 6);
		});

		it("all section edges land exactly on grid boundaries", () => {
			const mgr = new ArenaLayoutManager(1280, 800);
			const grid = mgr.getGrid();
			for (const s of mgr.getSections()) {
				const expectedX = grid.margin + s.startCol * (grid.colWidth + grid.gutter);
				const expectedW = s.span * grid.colWidth + (s.span - 1) * grid.gutter;
				expect(s.rect.x).toBeCloseTo(expectedX, 6);
				expect(s.rect.w).toBeCloseTo(expectedW, 6);
				// Right edge also on a boundary: (startCol + span) shares the formula.
				const rightEdge = grid.margin + (s.startCol + s.span) * (grid.colWidth + grid.gutter) - grid.gutter;
				expect(s.rect.x + s.rect.w).toBeCloseTo(rightEdge, 6);
			}
		});
	});

	describe("2. non-overlap + within canvas", () => {
		it.each([
			[960, 640],
			[1280, 800],
			[800, 600]
		])("validate() passes at %ix%i with varied occupancy", (w, h) => {
			const mgr = new ArenaLayoutManager(w, h);
			mgr.setOccupancy({ pending: 7, in_progress: 9, backlog: 5, blocked: 3, recovery: 2 });
			expect(() => mgr.validate()).not.toThrow();

			for (const s of mgr.getSections()) {
				expect(s.rect.x).toBeGreaterThanOrEqual(0);
				expect(s.rect.y).toBeGreaterThanOrEqual(0);
				expect(s.rect.x + s.rect.w).toBeLessThanOrEqual(w);
				expect(s.rect.y + s.rect.h).toBeLessThanOrEqual(h);
			}
		});
	});

	describe("3. responsive sizing (occupancy-aware)", () => {
		it("default empty layout keeps progress dominant over pending", () => {
			const mgr = new ArenaLayoutManager(1280, 800);
			const sections = mgr.getSections();
			const pending = sectionById(sections, "pending");
			const inProgress = sectionById(sections, "in_progress");
			expect(inProgress.span).toBeGreaterThan(pending.span);
		});

		it("12 pending vs 0 in_progress: pending grows, in_progress shrinks (within clamps)", () => {
			const mgr = new ArenaLayoutManager(1280, 800);
			mgr.setOccupancy({ pending: 12 });
			const sections = mgr.getSections();
			const pending = sectionById(sections, "pending");
			const inProgress = sectionById(sections, "in_progress");

			expect(pending.span).toBeGreaterThan(4); // grew from default 4
			expect(inProgress.span).toBeLessThan(8); // shrank from default 8
			expect(pending.span).toBeGreaterThanOrEqual(3);
			expect(pending.span).toBeLessThanOrEqual(6);
			expect(inProgress.span).toBeGreaterThanOrEqual(6);
			expect(inProgress.span).toBeLessThanOrEqual(9);
		});

		it("0 pending vs 12 in_progress: inverse — in_progress grows, pending shrinks", () => {
			const mgr = new ArenaLayoutManager(1280, 800);
			mgr.setOccupancy({ in_progress: 12 });
			const sections = mgr.getSections();
			const pending = sectionById(sections, "pending");
			const inProgress = sectionById(sections, "in_progress");

			expect(pending.span).toBeLessThan(4); // shrank from default 4
			expect(inProgress.span).toBeGreaterThan(8); // grew from default 8
			expect(pending.span).toBeGreaterThanOrEqual(3);
			expect(pending.span).toBeLessThanOrEqual(6);
			expect(inProgress.span).toBeGreaterThanOrEqual(6);
			expect(inProgress.span).toBeLessThanOrEqual(9);
		});
	});

	describe("4. per-band span sums", () => {
		it.each([
			[{}],
			[{ pending: 12 }],
			[{ in_progress: 12 }],
			[{ backlog: 20, blocked: 20 }],
			[{ pending: 20, in_progress: 0 }],
			[{ pending: 3, in_progress: 1, backlog: 0, blocked: 0, recovery: 0 }],
			[{ pending: 1, in_progress: 2, backlog: 3, blocked: 4, recovery: 5 }]
		])("spans sum to 12 per band for occupancy %o", (occupancy) => {
			const mgr = new ArenaLayoutManager(960, 640);
			mgr.setOccupancy(occupancy as Record<string, number>);
			for (const band of ["main", "exception"] as const) {
				const bandSections = mgr.getBandSections(band);
				const sum = bandSections.reduce((acc, s) => acc + s.span, 0);
				expect(sum).toBe(GRID_COLUMNS);
				expect(bandSections.length).toBeGreaterThan(0);
			}
			expect(() => mgr.validate()).not.toThrow();
		});
	});

	describe("5. workstation positions", () => {
		it("positions are inside contentRect, row-major, and capped at MAX_TASKS_PER_ZONE", () => {
			const mgr = new ArenaLayoutManager(960, 640);
			mgr.setOccupancy({ in_progress: 16 });
			const inProgress = sectionById(mgr.getSections(), "in_progress");
			const positions = mgr.getWorkstationPositions("in_progress", 16);

			expect(positions).toHaveLength(16);
			expect(positions.length).toBeLessThanOrEqual(MAX_TASKS_PER_ZONE);

			for (const p of positions) {
				expect(p.x).toBeGreaterThanOrEqual(inProgress.contentRect.x);
				expect(p.x).toBeLessThanOrEqual(inProgress.contentRect.x + inProgress.contentRect.w);
				expect(p.y).toBeGreaterThanOrEqual(inProgress.contentRect.y);
				expect(p.y).toBeLessThanOrEqual(inProgress.contentRect.y + inProgress.contentRect.h);
			}

			// Row-major: within a row x increases and y stays; between rows y increases.
			for (let i = 0; i < positions.length - 1; i++) {
				const a = positions[i];
				const b = positions[i + 1];
				const aRow = Math.floor(i / inProgress.columns);
				const bRow = Math.floor((i + 1) / inProgress.columns);
				if (aRow === bRow) {
					expect(b.x).toBeGreaterThan(a.x);
					expect(b.y).toBeCloseTo(a.y, 6);
				} else {
					expect(b.y).toBeGreaterThan(a.y);
				}
			}
		});

		it("capping: requesting more than MAX_TASKS_PER_ZONE returns exactly MAX_TASKS_PER_ZONE", () => {
			const mgr = new ArenaLayoutManager(960, 640);
			expect(mgr.getWorkstationPositions("pending", 30)).toHaveLength(MAX_TASKS_PER_ZONE);
		});

		it("containment holds even in a tight exception band (800x600, 16 blocked)", () => {
			const mgr = new ArenaLayoutManager(800, 600);
			mgr.setOccupancy({ blocked: 16 });
			const blocked = sectionById(mgr.getSections(), "blocked");
			const positions = mgr.getWorkstationPositions("blocked", 16);
			expect(positions).toHaveLength(16);
			for (const p of positions) {
				expect(p.x).toBeGreaterThanOrEqual(blocked.contentRect.x);
				expect(p.x).toBeLessThanOrEqual(blocked.contentRect.x + blocked.contentRect.w);
				expect(p.y).toBeGreaterThanOrEqual(blocked.contentRect.y);
				expect(p.y).toBeLessThanOrEqual(blocked.contentRect.y + blocked.contentRect.h);
			}
		});

		it("throws for an unknown section id", () => {
			const mgr = new ArenaLayoutManager(960, 640);
			expect(() => mgr.getWorkstationPositions("does_not_exist", 3)).toThrow();
		});
	});

	describe("6. caching", () => {
		it("same inputs return the same object identity", () => {
			const mgr = new ArenaLayoutManager(960, 640);
			expect(mgr.getSections()).toBe(mgr.getSections());
			expect(mgr.getSection("pending")).toBe(mgr.getSection("pending"));
		});

		it("setting identical occupancy does not invalidate", () => {
			const mgr = new ArenaLayoutManager(960, 640);
			const before = mgr.getSections();
			mgr.setOccupancy({ pending: 1 });
			const afterFirst = mgr.getSections();
			expect(afterFirst).not.toBe(before);
			// Same value again → key unchanged → cached layout preserved.
			mgr.setOccupancy({ pending: 1 });
			expect(mgr.getSections()).toBe(afterFirst);
		});

		it("setOccupancy invalidates", () => {
			const mgr = new ArenaLayoutManager(960, 640);
			const before = mgr.getSections();
			mgr.setOccupancy({ pending: 5 });
			expect(mgr.getSections()).not.toBe(before);
		});

		it("setDimensions invalidates", () => {
			const mgr = new ArenaLayoutManager(960, 640);
			const before = mgr.getSections();
			mgr.setDimensions(1280, 800);
			expect(mgr.getSections()).not.toBe(before);
		});

		it("registerSection invalidates", () => {
			const mgr = new ArenaLayoutManager(960, 640);
			const before = mgr.getSections();
			mgr.registerSection(reviewDefinition());
			expect(mgr.getSections()).not.toBe(before);
		});
	});

	describe("7. section registration (extensibility)", () => {
		it("registerSection adds a main-band section; spans still sum to 12 with no overlap", () => {
			const mgr = new ArenaLayoutManager(1280, 800);
			mgr.registerSection(reviewDefinition());

			const mainBand = mgr.getBandSections("main");
			expect(mainBand).toHaveLength(3);
			expect(mainBand.reduce((acc, s) => acc + s.span, 0)).toBe(GRID_COLUMNS);

			const review = sectionById(mgr.getSections(), "review");
			expect(review.span).toBeGreaterThanOrEqual(2);
			expect(review.span).toBeLessThanOrEqual(6);

			expect(() => mgr.validate()).not.toThrow();
		});

		it("rejects duplicate ids and infeasible band configurations", () => {
			const mgr = new ArenaLayoutManager(1280, 800);
			expect(() => mgr.registerSection(reviewDefinition())).not.toThrow();
			expect(() => mgr.registerSection(reviewDefinition())).toThrow(/already registered/);

			// minSpans sum to 13 > 12 in the main band → infeasible.
			expect(() =>
				mgr.registerSection({
					...reviewDefinition(),
					id: "approval",
					label: "Approval",
					weight: 1,
					minSpan: 5,
					maxSpan: 12
				})
			).toThrow(/cannot fit/);
		});
	});

	describe("8. workflow edges", () => {
		it("exposes the four edges with anchors on the correct section edges", () => {
			const mgr = new ArenaLayoutManager(1280, 800);
			const edges = mgr.getWorkflow();
			const byPair = new Map(edges.map((e) => [`${e.from}->${e.to}`, e]));

			expect(edges).toHaveLength(4);
			expect(byPair.has("backlog->pending")).toBe(true);
			expect(byPair.has("pending->in_progress")).toBe(true);
			expect(byPair.has("blocked->recovery")).toBe(true);
			expect(byPair.has("recovery->pending")).toBe(true);

			const sections = new Map(mgr.getSections().map((s) => [s.id, s]));
			for (const e of edges) {
				const from = sections.get(e.from);
				const to = sections.get(e.to);
				expect(from).toBeDefined();
				expect(to).toBeDefined();
				expect(onRectEdge(from!.rect, e.fromAnchor)).toBe(true);
				expect(onRectEdge(to!.rect, e.toAnchor)).toBe(true);
			}

			// backlog.topCenter → pending.bottomCenter (vertical primary).
			const bp = byPair.get("backlog->pending")!;
			const backlog = sections.get("backlog")!;
			const pending = sections.get("pending")!;
			expect(bp.kind).toBe("primary");
			expect(bp.fromAnchor.x).toBeCloseTo(backlog.rect.x + backlog.rect.w / 2, 6);
			expect(bp.fromAnchor.y).toBeCloseTo(backlog.rect.y, 6);
			expect(bp.toAnchor.x).toBeCloseTo(pending.rect.x + pending.rect.w / 2, 6);
			expect(bp.toAnchor.y).toBeCloseTo(pending.rect.y + pending.rect.h, 6);

			// pending.rightCenter → in_progress.leftCenter (horizontal primary).
			const pi = byPair.get("pending->in_progress")!;
			const inProgress = sections.get("in_progress")!;
			expect(pi.kind).toBe("primary");
			expect(pi.fromAnchor.x).toBeCloseTo(pending.rect.x + pending.rect.w, 6);
			expect(pi.fromAnchor.y).toBeCloseTo(pending.rect.y + pending.rect.h / 2, 6);
			expect(pi.toAnchor.x).toBeCloseTo(inProgress.rect.x, 6);
			expect(pi.toAnchor.y).toBeCloseTo(inProgress.rect.y + inProgress.rect.h / 2, 6);

			// blocked.rightCenter → recovery.leftCenter (exception).
			const br = byPair.get("blocked->recovery")!;
			const blocked = sections.get("blocked")!;
			const recovery = sections.get("recovery")!;
			expect(br.kind).toBe("exception");
			expect(br.fromAnchor.x).toBeCloseTo(blocked.rect.x + blocked.rect.w, 6);
			expect(br.toAnchor.x).toBeCloseTo(recovery.rect.x, 6);

			// recovery.topRight → pending.bottomLeft (return curve).
			const rp = byPair.get("recovery->pending")!;
			expect(rp.kind).toBe("return");
			expect(rp.fromAnchor.x).toBeCloseTo(recovery.rect.x + recovery.rect.w, 6);
			expect(rp.fromAnchor.y).toBeCloseTo(recovery.rect.y, 6);
			expect(rp.toAnchor.x).toBeCloseTo(pending.rect.x, 6);
			expect(rp.toAnchor.y).toBeCloseTo(pending.rect.y + pending.rect.h, 6);
		});
	});

	describe("engine robustness", () => {
		it("allocateSpans is deterministic and rebalances to exactly 12", () => {
			const a = allocateSpans([3, 8, 4], [2, 3, 3], [6, 6, 6]);
			const b = allocateSpans([3, 8, 4], [2, 3, 3], [6, 6, 6]);
			expect(a).toEqual(b);
			expect(a.reduce((x, y) => x + y, 0)).toBe(12);
			expect(a).toEqual([3, 6, 3]);
		});

		it("allocateSpans throws when clamps make the total unreachable", () => {
			// min sum 13 > 12 → cannot fit.
			expect(() => allocateSpans([1, 1], [6, 7], [12, 12])).toThrow();
		});

		it("getArenaLayoutManager returns a stable singleton", () => {
			expect(getArenaLayoutManager()).toBe(getArenaLayoutManager());
		});
	});
});
