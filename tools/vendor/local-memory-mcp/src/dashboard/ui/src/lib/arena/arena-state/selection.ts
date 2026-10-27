import type { FilterState } from "../arenaEvents";

// ── Zoom constraints ──────────────────────────────────────────────────────
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 3.0;

/**
 * Pure helpers for UI/selection state updates.
 * These are meant to be used by ArenaStateManager or directly in components.
 */

export interface SelectionState {
	selectedEntityId: string | null;
	selectedEntityType: "agent" | "task" | "repository" | null;
	zoom: number;
	panX: number;
	panY: number;
	hoveredEntityId: string | null;
	activeFilter: FilterState;
	timelineVisible: boolean;
	sidePanelVisible: boolean;
	sidePanelView: string;
	paused: boolean;
}

export function clampZoom(zoom: number): number {
	return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
}

export function createDefaultFilter(): FilterState {
	return {
		repository: null,
		roles: [],
		priorities: [],
		statuses: [],
		search: ""
	};
}

export function createDefaultSelectionState(): SelectionState {
	return {
		selectedEntityId: null,
		selectedEntityType: null,
		zoom: 1.0,
		panX: 0,
		panY: 0,
		hoveredEntityId: null,
		activeFilter: createDefaultFilter(),
		timelineVisible: false,
		sidePanelVisible: false,
		sidePanelView: "agent",
		paused: false
	};
}
