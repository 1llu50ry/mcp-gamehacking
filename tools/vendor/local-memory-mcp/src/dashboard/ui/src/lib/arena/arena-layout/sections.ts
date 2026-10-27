/**
 * arena-layout/sections.ts
 *
 * Section registry for the ArenaLayoutManager: the five current arena
 * sections plus per-decor visual defaults. Registering new sections at
 * runtime (ArenaLayoutManager.registerSection) extends this list without
 * touching the grid math — new sections auto-partition the 12 columns by
 * weight. Future bands (e.g. "aux") are a config addition, not a rewrite.
 */

import type { FloorStyle, SectionDefinition } from "./types";

/**
 * Default floor style per decor style; falls back to "concrete".
 *
 * These pair each decor with the floor primitive that best communicates the
 * section's status without reading labels (TASK-251 visual identity):
 *  - storage (backlog): archive vault → wood planks
 *  - waiting (pending): neutral lobby → plaza tiles
 *  - active (in_progress): clean operational floor → clean tile
 *  - warning (blocked): hazardous area → cracked tile
 *  - repair (recovery): medical wing → clean tile
 */
const FLOOR_BY_DECOR: Record<string, FloorStyle> = {
	storage: "wood",
	waiting: "plaza",
	active: "tile",
	warning: "cracked",
	repair: "tile"
};

export function defaultFloorStyle(decorStyle: string): FloorStyle {
	return FLOOR_BY_DECOR[decorStyle] ?? "concrete";
}

/** Derive an accent color: lighten the base hex color 35% toward white. */
export function defaultAccentColor(color: string): string {
	const m = /^#([0-9a-f]{6})$/i.exec(color);
	if (!m) return color;
	const mix = (i: number): string => {
		const v = parseInt(m[1].slice(i, i + 2), 16);
		return Math.round(v + (255 - v) * 0.35)
			.toString(16)
			.padStart(2, "0");
	};
	return `#${mix(0)}${mix(2)}${mix(4)}`;
}

/**
 * The five built-in arena sections. flowStage drives left-to-right ordering
 * within each band: backlog → pending → in_progress (main flow), with
 * blocked → recovery as the exception path.
 */
export const DEFAULT_SECTIONS: SectionDefinition[] = [
	{
		id: "backlog",
		label: "Backlog",
		band: "exception",
		weight: 3,
		minSpan: 2,
		maxSpan: 6,
		color: "#8b5cf6",
		decorStyle: "storage",
		flowStage: 1
	},
	{
		id: "pending",
		label: "Pending",
		band: "main",
		weight: 5,
		minSpan: 3,
		maxSpan: 6,
		color: "#f59e0b",
		decorStyle: "waiting",
		flowStage: 2
	},
	{
		id: "in_progress",
		label: "In Progress",
		band: "main",
		weight: 10,
		minSpan: 6,
		maxSpan: 9,
		color: "#3b82f6",
		decorStyle: "active",
		flowStage: 3
	},
	{
		id: "blocked",
		label: "Blocked",
		band: "exception",
		weight: 8,
		minSpan: 3,
		maxSpan: 6,
		color: "#ef4444",
		decorStyle: "warning",
		flowStage: 2
	},
	{
		id: "recovery",
		label: "Recovery Center",
		band: "exception",
		weight: 4,
		minSpan: 3,
		maxSpan: 6,
		color: "#14b8a6",
		decorStyle: "repair",
		flowStage: 3
	}
];
