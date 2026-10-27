// @vitest-environment node
/**
 * arenaTransform-layout — façade unit tests (TASK-265, review F4 / MEM-1074).
 *
 * The transform-layout façade is a thin consumer of the shared
 * ArenaLayoutManager singleton: aggregateZoneCounts / sectionsToZones /
 * placeTasksInZones / therapySlotPosition wire scene data → manager →
 * baked positions. The manager itself is covered by ArenaLayoutManager.test.ts
 * (30 tests); this suite closes the gap on the façade functions, which had
 * ZERO coverage. Pure TypeScript — no DOM, node environment.
 *
 * Manager state isolation: getArenaLayoutManager() is a MODULE SINGLETON with
 * no dedicated reset API. Its only mutable inputs are canvas dimensions and
 * the occupancy snapshot, so beforeEach restores a known-good baseline via
 * setDimensions(fixed) + setOccupancy({}). Tests that need loaded geometry
 * mirror the production flow (buildArenaScene): set occupancy from
 * aggregateZoneCounts, then computeZones — the manager caches layout by
 * (dims + occupancy + registered ids), so zone rects and the workstation
 * positions derived from the same snapshot are always consistent.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
	aggregateZoneCounts,
	computeZones,
	placeTasksInZones,
	sectionsToZones,
	therapySlotPosition
} from "../arenaTransform-layout";
import { getArenaLayoutManager } from "../arena-layout/ArenaLayoutManager";
import { MAX_TASKS_PER_ZONE } from "../arena-layout/grid";
import { STATUS_TO_ZONE } from "../arenaTransform-utils";
import type { ZoneRect } from "../arenaTypes";

const CANVAS_W = 1280;
const CANVAS_H = 800;

/** Ids of the five registered sections (manager registry order). */
const REGISTERED_ZONE_IDS = ["backlog", "pending", "in_progress", "blocked", "recovery"];

/**
 * Mirror the production flow (arenaTransform.ts buildArenaScene): seed the
 * singleton's occupancy from aggregateZoneCounts, then compute zones from the
 * same manager so geometry is self-consistent.
 */
function buildZones(tasks: Array<{ status: string }>): ZoneRect[] {
	const manager = getArenaLayoutManager();
	manager.setOccupancy(
		aggregateZoneCounts(
			tasks,
			manager.getDefinitions().map((d) => d.id)
		)
	);
	return computeZones(CANVAS_W, CANVAS_H);
}

function zoneById(zones: ZoneRect[], id: string): ZoneRect {
	const zone = zones.find((z) => z.id === id);
	expect(zone).toBeDefined();
	return zone as ZoneRect;
}

beforeEach(() => {
	const manager = getArenaLayoutManager();
	manager.setDimensions(CANVAS_W, CANVAS_H);
	manager.setOccupancy({});
});

describe("arenaTransform-layout façade", () => {
	describe("1. aggregateZoneCounts", () => {
		it("counts mixed-status tasks per registered zone", () => {
			const tasks = [
				{ status: "backlog" },
				{ status: "backlog" },
				{ status: "backlog" },
				{ status: "pending" },
				{ status: "pending" },
				{ status: "in_progress" },
				{ status: "in_progress" },
				{ status: "in_progress" },
				{ status: "in_progress" },
				{ status: "blocked" }
			];
			const counts = aggregateZoneCounts(tasks, REGISTERED_ZONE_IDS);
			expect(counts).toEqual({ backlog: 3, pending: 2, in_progress: 4, blocked: 1 });
		});

		it("recovery has no task-status mapping and stays absent/zero", () => {
			// STATUS_TO_ZONE maps only backlog/pending/in_progress/blocked to
			// registered zones — no status maps to "recovery".
			expect(Object.values(STATUS_TO_ZONE)).not.toContain("recovery");
			const counts = aggregateZoneCounts([{ status: "pending" }], REGISTERED_ZONE_IDS);
			expect(counts["recovery"]).toBeUndefined();
		});

		it("completed/canceled map to non-registered zones and are excluded", () => {
			expect(STATUS_TO_ZONE["completed"]).toBe("completed");
			expect(STATUS_TO_ZONE["canceled"]).toBe("canceled");
			expect(REGISTERED_ZONE_IDS).not.toContain("completed");
			expect(REGISTERED_ZONE_IDS).not.toContain("canceled");

			const counts = aggregateZoneCounts(
				[{ status: "completed" }, { status: "canceled" }, { status: "pending" }],
				REGISTERED_ZONE_IDS
			);
			expect(counts).toEqual({ pending: 1 });
		});

		it("ignores unknown statuses (no STATUS_TO_ZONE entry)", () => {
			const counts = aggregateZoneCounts([{ status: "mystery" }, { status: "pending" }], REGISTERED_ZONE_IDS);
			expect(counts).toEqual({ pending: 1 });
		});

		it("empty input yields an empty object (every registered zone implicitly zero)", () => {
			const counts = aggregateZoneCounts([], REGISTERED_ZONE_IDS);
			expect(counts).toEqual({});
			// Contract note: no keys means callers must treat missing ids as 0.
			expect(counts["pending"]).toBeUndefined();
		});

		it("restricts counts to the provided zone ids (even for mapped statuses)", () => {
			const tasks = [{ status: "pending" }, { status: "backlog" }];
			const counts = aggregateZoneCounts(tasks, ["pending"]);
			expect(counts).toEqual({ pending: 1 });
		});
	});

	describe("2. sectionsToZones", () => {
		it("maps every manager section to the ZoneRect shape (id/label/x/y/w/h/color)", () => {
			const manager = getArenaLayoutManager();
			const sections = manager.getSections();
			const zones = sectionsToZones(sections);

			expect(zones).toHaveLength(sections.length);
			for (const zone of zones) {
				// Shape completeness: every ZoneRect field is present and finite.
				expect(Object.keys(zone).sort()).toEqual(["color", "h", "id", "label", "w", "x", "y"]);
				expect(Number.isFinite(zone.x)).toBe(true);
				expect(Number.isFinite(zone.y)).toBe(true);
				expect(Number.isFinite(zone.w)).toBe(true);
				expect(Number.isFinite(zone.h)).toBe(true);
			}

			// Values are copied 1:1 from the manager sections.
			for (let i = 0; i < sections.length; i++) {
				const s = sections[i];
				const z = zones[i];
				expect(z.id).toBe(s.id);
				expect(z.label).toBe(s.label);
				expect(z.x).toBe(s.rect.x);
				expect(z.y).toBe(s.rect.y);
				expect(z.w).toBe(s.rect.w);
				expect(z.h).toBe(s.rect.h);
			}
		});

		it("color comes from the manager's visual token (section.visual.color)", () => {
			const manager = getArenaLayoutManager();
			const zones = sectionsToZones(manager.getSections());
			for (const s of manager.getSections()) {
				const z = zoneById(zones, s.id);
				expect(z.color).toBe(s.visual.color);
			}
		});

		it("empty sections yield an empty zone list", () => {
			expect(sectionsToZones([])).toEqual([]);
		});
	});

	describe("3. placeTasksInZones", () => {
		it("buckets tasks into their status-mapped zone and returns manager positions", () => {
			const tasks = [
				{ id: "b1", status: "backlog" },
				{ id: "b2", status: "backlog" },
				{ id: "p1", status: "pending" },
				{ id: "p2", status: "pending" },
				{ id: "p3", status: "pending" },
				{ id: "i1", status: "in_progress" },
				{ id: "x1", status: "blocked" }
			];
			const zones = buildZones(tasks);
			const manager = getArenaLayoutManager();
			const positions = placeTasksInZones(tasks, zones);

			expect(positions.size).toBe(tasks.length);
			// Every task lands on the exact cell center the manager computes for
			// its zone, with the zone's bucketed count.
			expect(positions.get("b1")).toEqual(manager.getWorkstationPositions("backlog", 2)[0]);
			expect(positions.get("b2")).toEqual(manager.getWorkstationPositions("backlog", 2)[1]);
			expect(positions.get("p3")).toEqual(manager.getWorkstationPositions("pending", 3)[2]);
			expect(positions.get("i1")).toEqual(manager.getWorkstationPositions("in_progress", 1)[0]);
			expect(positions.get("x1")).toEqual(manager.getWorkstationPositions("blocked", 1)[0]);
		});

		it(`caps each zone at MAX_TASKS_PER_ZONE (${MAX_TASKS_PER_ZONE}): 20 pending → 16 positioned, first 16 win`, () => {
			const tasks = Array.from({ length: 20 }, (_, i) => ({ id: `pending-${i}`, status: "pending" }));
			const zones = buildZones(tasks);
			const positions = placeTasksInZones(tasks, zones);

			expect(positions.size).toBe(MAX_TASKS_PER_ZONE);
			const expected = getArenaLayoutManager().getWorkstationPositions("pending", MAX_TASKS_PER_ZONE);
			for (let i = 0; i < MAX_TASKS_PER_ZONE; i++) {
				expect(positions.get(`pending-${i}`)).toEqual(expected[i]);
			}
			// Tasks beyond the cap are dropped (not positioned).
			for (let i = MAX_TASKS_PER_ZONE; i < tasks.length; i++) {
				expect(positions.has(`pending-${i}`)).toBe(false);
			}
		});

		it("caps independently per zone (20 pending + 20 in_progress → 32 positions)", () => {
			const tasks = [
				...Array.from({ length: 20 }, (_, i) => ({ id: `pending-${i}`, status: "pending" })),
				...Array.from({ length: 20 }, (_, i) => ({ id: `inprog-${i}`, status: "in_progress" }))
			];
			const zones = buildZones(tasks);
			const positions = placeTasksInZones(tasks, zones);

			expect(positions.size).toBe(MAX_TASKS_PER_ZONE * 2);
			const mgr = getArenaLayoutManager();
			for (let i = 0; i < MAX_TASKS_PER_ZONE; i++) {
				expect(positions.get(`pending-${i}`)).toEqual(mgr.getWorkstationPositions("pending", MAX_TASKS_PER_ZONE)[i]);
				expect(positions.get(`inprog-${i}`)).toEqual(mgr.getWorkstationPositions("in_progress", MAX_TASKS_PER_ZONE)[i]);
			}
		});

		it("every returned position lies inside its zone's contentRect", () => {
			const tasks = [
				{ id: "p1", status: "pending" },
				{ id: "p2", status: "pending" },
				{ id: "i1", status: "in_progress" },
				{ id: "i2", status: "in_progress" },
				{ id: "b1", status: "blocked" },
				{ id: "bg1", status: "backlog" }
			];
			const zones = buildZones(tasks);
			const manager = getArenaLayoutManager();
			const positions = placeTasksInZones(tasks, zones);

			const zoneOf = (id: string) => {
				const task = tasks.find((t) => t.id === id) as { id: string; status: string };
				return STATUS_TO_ZONE[task.status] ?? "pending";
			};
			for (const [taskId, p] of positions) {
				const zid = zoneOf(taskId);
				const section = manager.getSection(zid);
				expect(section).toBeDefined();
				const { contentRect } = section as { contentRect: { x: number; y: number; w: number; h: number } };
				expect(p.x).toBeGreaterThanOrEqual(contentRect.x);
				expect(p.x).toBeLessThanOrEqual(contentRect.x + contentRect.w);
				expect(p.y).toBeGreaterThanOrEqual(contentRect.y);
				expect(p.y).toBeLessThanOrEqual(contentRect.y + contentRect.h);
			}
		});

		it("drops completed/canceled (no registered zone bucket) and unlisted zones", () => {
			const tasks = [
				{ id: "done", status: "completed" },
				{ id: "gone", status: "canceled" },
				{ id: "p1", status: "pending" }
			];
			const zones = buildZones(tasks);
			const positions = placeTasksInZones(tasks, zones);

			expect(positions.has("done")).toBe(false);
			expect(positions.has("gone")).toBe(false);
			expect(positions.has("p1")).toBe(true);

			// A zone omitted from `zones` has no bucket → its tasks are dropped
			// even though the status maps to a registered section.
			const noBlocked = zones.filter((z) => z.id !== "blocked");
			const positions2 = placeTasksInZones([{ id: "x1", status: "blocked" }], noBlocked);
			expect(positions2.size).toBe(0);
		});

		it('falls back unknown statuses to the pending bucket (`?? "pending"`)', () => {
			const tasks = [{ id: "mystery", status: "mystery" }];
			const zones = buildZones(tasks);
			const positions = placeTasksInZones(tasks, zones);

			// Unknown status is bucketed as pending.
			expect(positions.get("mystery")).toEqual(getArenaLayoutManager().getWorkstationPositions("pending", 1)[0]);

			// Without a pending zone in the list the fallback finds no bucket → dropped.
			const noPending = zones.filter((z) => z.id !== "pending");
			expect(placeTasksInZones([{ id: "mystery2", status: "mystery" }], noPending).size).toBe(0);
		});
	});

	describe("4. therapySlotPosition", () => {
		function recoveryZone(): ZoneRect {
			return zoneById(buildZones([]), "recovery");
		}

		it("matches manager recovery workstation positions for in-range indices (0..15)", () => {
			const manager = getArenaLayoutManager();
			const zone = recoveryZone();
			for (let idx = 0; idx < MAX_TASKS_PER_ZONE; idx++) {
				// count = idx + 1 → grid of idx+1 slots; index within range.
				expect(therapySlotPosition(zone, idx)).toEqual(manager.getWorkstationPositions("recovery", idx + 1)[idx]);
			}
		});

		it(`wraps modulo the ${MAX_TASKS_PER_ZONE}-slot capacity for out-of-range indices`, () => {
			const manager = getArenaLayoutManager();
			const zone = recoveryZone();
			// Capacity: the recovery grid never exceeds MAX_TASKS_PER_ZONE slots.
			expect(manager.getWorkstationPositions("recovery", 100)).toHaveLength(MAX_TASKS_PER_ZONE);

			for (let idx = MAX_TASKS_PER_ZONE; idx < MAX_TASKS_PER_ZONE * 2; idx++) {
				const expected = manager.getWorkstationPositions("recovery", MAX_TASKS_PER_ZONE)[idx % MAX_TASKS_PER_ZONE];
				expect(therapySlotPosition(zone, idx)).toEqual(expected);
			}
		});

		it("negative indices collapse to the single first slot (idx % 1 === 0)", () => {
			const zone = recoveryZone();
			const firstSlot = getArenaLayoutManager().getWorkstationPositions("recovery", 1)[0];
			// count = max(1, idx + 1) → a 1-slot grid; idx % 1 is -0 → positions[0].
			expect(therapySlotPosition(zone, -1)).toEqual(firstSlot);
			expect(therapySlotPosition(zone, -5)).toEqual(firstSlot);
		});

		it("ignores the zone argument — position derives from the manager's recovery grid", () => {
			const zones = buildZones([]);
			const recovery = zoneById(zones, "recovery");
			const pending = zoneById(zones, "pending");
			for (const idx of [0, 3, 16]) {
				// Legacy signature keeps the zone param but the manager's
				// "recovery" section is the single source of truth.
				expect(therapySlotPosition(pending, idx)).toEqual(therapySlotPosition(recovery, idx));
			}
		});

		it("remains deterministic and manager-consistent after an occupancy change", () => {
			// Changing occupancy resizes the recovery section — positions track
			// the new contentRect (no stale cache bleed-through).
			const manager = getArenaLayoutManager();
			const before = manager.getWorkstationPositions("recovery", 3);
			manager.setOccupancy({ blocked: 16, recovery: 2 });
			const after = manager.getWorkstationPositions("recovery", 3);
			expect(after).not.toEqual(before);

			const zone = zoneById(buildZones([]), "recovery");
			expect(therapySlotPosition(zone, 2)).toEqual(manager.getWorkstationPositions("recovery", 3)[2]);
		});
	});
});
