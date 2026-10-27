/**
 * arenaTransform-layout.ts
 *
 * Thin layout façade over the shared ArenaLayoutManager (arena-layout/).
 *
 * The manager is the SINGLE SOURCE OF TRUTH for zone geometry, workstation
 * positions and visual tokens. These functions keep the historical exported
 * names (computeZones / placeTasksInZones / therapySlotPosition) so existing
 * importers keep working, but all math now lives in the manager — there are
 * no hardcoded coordinates or colors in this module anymore.
 */

import type { ZoneRect } from "./arenaTypes";
import { STATUS_TO_ZONE } from "./arenaTransform-utils";
import { getArenaLayoutManager } from "./arena-layout/ArenaLayoutManager";
import { MAX_TASKS_PER_ZONE } from "./arena-layout/grid";
import type { SectionBounds } from "./arena-layout/types";

/** Map manager sections to the legacy ZoneRect shape (full section rects). */
export function sectionsToZones(sections: SectionBounds[]): ZoneRect[] {
	return sections.map((s) => ({
		id: s.id,
		label: s.label,
		x: s.rect.x,
		y: s.rect.y,
		w: s.rect.w,
		h: s.rect.h,
		color: s.visual.color
	}));
}

/**
 * Aggregate per-zone task counts from a task list (zone = STATUS_TO_ZONE
 * mapping), restricted to the given zone ids (the registered sections).
 * Unknown ids (e.g. "completed"/"canceled") are ignored — they are not
 * rendered as sections.
 */
export function aggregateZoneCounts(
	tasks: Array<{ status: string }>,
	zoneIds: Iterable<string>
): Record<string, number> {
	const ids = new Set(zoneIds);
	const counts: Record<string, number> = {};
	for (const t of tasks) {
		const zid = STATUS_TO_ZONE[t.status];
		if (zid && ids.has(zid)) counts[zid] = (counts[zid] ?? 0) + 1;
	}
	return counts;
}

/**
 * Computes zone rectangles for the given canvas dimensions — a thin consumer
 * of the shared ArenaLayoutManager (module singleton). The optional `counts`
 * feed the manager's occupancy so zone sizes respond to the task load.
 * Zones: pending, in_progress, backlog, blocked, recovery.
 */
export function computeZones(cw: number, ch: number, counts?: Record<string, number>): ZoneRect[] {
	const manager = getArenaLayoutManager();
	manager.setDimensions(cw, ch);
	if (counts) manager.setOccupancy(counts);
	return sectionsToZones(manager.getSections());
}

/**
 * Spreads tasks as workstations within their zone. Positions come from the
 * manager's per-section workstation grid (row-major cell centers, capped at
 * MAX_TASKS_PER_ZONE) so they always match the rendered rooms.
 */
export function placeTasksInZones(
	tasks: Array<{ id: string; status: string }>,
	zones: ZoneRect[]
): Map<string, { x: number; y: number }> {
	const manager = getArenaLayoutManager();
	const byZone = new Map<string, Array<{ id: string; status: string }>>();
	for (const z of zones) byZone.set(z.id, []);

	for (const task of tasks) {
		const zid = STATUS_TO_ZONE[task.status] ?? "pending";
		const bucket = byZone.get(zid);
		if (!bucket || bucket.length >= MAX_TASKS_PER_ZONE) continue;
		bucket.push(task);
	}

	const positions = new Map<string, { x: number; y: number }>();
	for (const [zid, zoneTasks] of byZone) {
		if (zoneTasks.length === 0) continue;
		const pts = manager.getWorkstationPositions(zid, zoneTasks.length);
		zoneTasks.forEach((t, i) => {
			const p = pts[i];
			if (p) positions.set(t.id, p);
		});
	}
	return positions;
}

/**
 * Computes the position of a "therapy slot" (burnout recovery bed) for a
 * given index — delegated to the manager's recovery workstation grid so beds
 * align with rendered recovery workstations. The index wraps modulo capacity
 * (mirrors the legacy `idx % (cols * rows)` behavior).
 */
export function therapySlotPosition(_zone: ZoneRect, idx: number): { x: number; y: number } {
	const manager = getArenaLayoutManager();
	const positions = manager.getWorkstationPositions("recovery", Math.max(1, idx + 1));
	return positions[idx % positions.length];
}
