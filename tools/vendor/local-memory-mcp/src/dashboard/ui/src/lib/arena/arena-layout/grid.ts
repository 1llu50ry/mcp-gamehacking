/**
 * arena-layout/grid.ts
 *
 * Pure grid allocation helpers for the ArenaLayoutManager. No class state,
 * no DOM — every function is deterministic and unit-testable in isolation.
 *
 * Grid model (CSS-grid-like, 12 columns):
 *   - OUTER_MARGIN separates the canvas edge from the inner area.
 *   - GUTTER separates adjacent column tracks (and the two horizontal bands).
 *   - A section spanning `s` columns is `s*colW + (s-1)*GUTTER` wide and
 *     starts at `innerX + startCol*(colW + GUTTER)` — every section edge
 *     therefore lands exactly on a shared grid boundary.
 */

import type { Point, Rect } from "./types";

// ── Single-source layout constants ─────────────────────────────────────────
export const GRID_COLUMNS = 12;
export const OUTER_MARGIN = 16;
export const GUTTER = 16;
export const SECTION_PAD = 18;
export const LABEL_HEIGHT = 28;
export const STATS_HEIGHT = 24;
/* Cells sized for legible type. The old 58x55 cell was built around 4.5-6px
   labels; at the 9-13px scale the arena now uses, a task code plus a title no
   longer fits inside it and neighbouring workstations collide. Widened to fit
   ~14 characters at 10px monospace plus padding. */
export const MIN_CELL_W = 96;
export const MIN_CELL_H = 84;
export const MAX_CELL_H = 112;
export const MAX_TASKS_PER_ZONE = 16;
/** Main band never drops below this fraction of the inner height. */
export const MAIN_BAND_MIN_RATIO = 0.48;
/** Main band never exceeds this fraction of the inner height. */
export const MAIN_BAND_MAX_RATIO = 0.6;

export function clamp(n: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, n));
}

/** Inner area of the canvas: the canvas inset by OUTER_MARGIN on every side. */
export function innerArea(cw: number, ch: number): Rect {
	return {
		x: OUTER_MARGIN,
		y: OUTER_MARGIN,
		w: Math.max(0, cw - OUTER_MARGIN * 2),
		h: Math.max(0, ch - OUTER_MARGIN * 2)
	};
}

/** Width of a single column track inside the inner area. */
export function columnWidth(innerW: number): number {
	return (innerW - (GRID_COLUMNS - 1) * GUTTER) / GRID_COLUMNS;
}

/** Width of a section spanning `span` columns (shared grid boundaries). */
export function sectionWidth(colW: number, span: number): number {
	return span * colW + (span - 1) * GUTTER;
}

/** X position of a section whose first column is `startCol`. */
export function sectionX(innerX: number, colW: number, startCol: number): number {
	return innerX + startCol * (colW + GUTTER);
}

/** Occupancy-aware demand for one section: `(count + 1) * weight`. The +1 keeps empty sections visible. */
export function demand(count: number, weight: number): number {
	return (count + 1) * weight;
}

/**
 * Allocate `total` columns across sections from their demands.
 *
 * 1. rawSpan = total * demand / bandDemand
 * 2. span = clamp(round(rawSpan), minSpan, maxSpan)
 * 3. Rebalance so Σspan === total: repeatedly nudge the section that
 *    deviates most from its raw share by 1, staying within clamp bounds.
 *
 * Throws when the min/max clamps make `total` unreachable (infeasible config).
 */
export function allocateSpans(
	demands: number[],
	minSpans: number[],
	maxSpans: number[],
	total = GRID_COLUMNS
): number[] {
	const n = demands.length;
	if (n === 0) return [];
	const sum = demands.reduce((a, b) => a + b, 0);
	const safeSum = sum > 0 ? sum : 1;
	const raw = demands.map((d) => (total * d) / safeSum);
	const spans = raw.map((r, i) => clamp(Math.round(r), minSpans[i], maxSpans[i]));
	let delta = total - spans.reduce((a, b) => a + b, 0);

	// Strict `>` keeps tie-breaking deterministic (first index wins).
	while (delta !== 0) {
		let best = -1;
		let bestScore = -Infinity;
		for (let i = 0; i < n; i++) {
			if (delta > 0) {
				if (spans[i] >= maxSpans[i]) continue;
				const score = raw[i] - spans[i];
				if (score > bestScore) {
					bestScore = score;
					best = i;
				}
			} else {
				if (spans[i] <= minSpans[i]) continue;
				const score = spans[i] - raw[i];
				if (score > bestScore) {
					bestScore = score;
					best = i;
				}
			}
		}
		if (best === -1) {
			throw new Error(
				`allocateSpans: cannot fit ${total} columns (min/max clamps produce an infeasible range for ${n} sections)`
			);
		}
		spans[best] += delta > 0 ? 1 : -1;
		delta += delta > 0 ? -1 : 1;
	}
	return spans;
}

/**
 * Split the inner height into main / exception band heights.
 *
 * mainRatio = clamp(mainDemand / total, MAIN_BAND_MIN_RATIO, MAIN_BAND_MAX_RATIO);
 * mainH = round(innerH * mainRatio); the exception band absorbs the
 * remainder minus one GUTTER row. Net effect: in_progress-heavy → main
 * grows; backlog/blocked-heavy → exception grows.
 */
export function allocateBandHeights(
	innerH: number,
	mainDemand: number,
	exceptionDemand: number
): { mainH: number; exceptionH: number } {
	const total = mainDemand + exceptionDemand;
	const ratio = total > 0 ? clamp(mainDemand / total, MAIN_BAND_MIN_RATIO, MAIN_BAND_MAX_RATIO) : MAIN_BAND_MIN_RATIO;
	const mainH = Math.round(innerH * ratio);
	const exceptionH = innerH - mainH - GUTTER;
	return { mainH, exceptionH };
}

/**
 * Inset a section rect into its content area: SECTION_PAD on every side,
 * plus LABEL_HEIGHT (top) and STATS_HEIGHT (below the label). Every section
 * shares this internal structure: label → stats → workstations.
 */
export function contentArea(rect: Rect): Rect {
	return {
		x: rect.x + SECTION_PAD,
		y: rect.y + SECTION_PAD + LABEL_HEIGHT + STATS_HEIGHT,
		w: rect.w - SECTION_PAD * 2,
		h: rect.h - SECTION_PAD * 2 - LABEL_HEIGHT - STATS_HEIGHT
	};
}

/** Workstation grid shape inside a content area. */
export interface WorkstationGrid {
	columns: number;
	rows: number;
	cellWidth: number;
	cellHeight: number;
}

/**
 * Compute the workstation grid for `count` tasks inside a content area.
 *
 * Base rule: columns = max(1, floor(contentW / MIN_CELL_W)),
 * rows = max(1, ceil(count / columns)), cellWidth = contentW / columns,
 * cellHeight = clamp(contentH / rows, MIN_CELL_H, MAX_CELL_H).
 *
 * Containment guarantee: when the min-height grid overflows the content
 * area vertically, columns grow to drop a row (legacy behavior). On
 * pathological tiny canvases cellHeight may fall below MIN_CELL_H so every
 * row center stays inside contentRect.
 */
export function computeWorkstationGrid(contentW: number, contentH: number, count: number): WorkstationGrid {
	const n = clamp(Math.floor(count), 0, MAX_TASKS_PER_ZONE);
	let columns = Math.max(1, Math.floor(contentW / MIN_CELL_W));
	let rows = Math.max(1, Math.ceil(n / columns));
	let cellHeight = clamp(contentH / rows, MIN_CELL_H, MAX_CELL_H);

	while (rows * cellHeight > contentH && columns < Math.max(n, 1)) {
		columns += 1;
		rows = Math.max(1, Math.ceil(n / columns));
		cellHeight = clamp(contentH / rows, MIN_CELL_H, MAX_CELL_H);
	}
	if (rows * cellHeight > contentH) {
		cellHeight = Math.max(1, contentH / rows);
	}

	const cellWidth = contentW / columns;
	return { columns, rows, cellWidth, cellHeight };
}

/**
 * Row-major workstation positions (cell centers), capped at
 * MAX_TASKS_PER_ZONE. Positions are ordered top-to-bottom, left-to-right.
 */
export function workstationPositions(content: Rect, grid: WorkstationGrid, count: number): Point[] {
	const n = clamp(Math.floor(count), 0, MAX_TASKS_PER_ZONE);
	const positions: Point[] = [];
	for (let i = 0; i < n; i++) {
		const col = i % grid.columns;
		const row = Math.floor(i / grid.columns);
		positions.push({
			x: content.x + col * grid.cellWidth + grid.cellWidth / 2,
			y: content.y + row * grid.cellHeight + grid.cellHeight / 2
		});
	}
	return positions;
}

/** True when two rects strictly overlap (edges that merely touch do NOT overlap). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
	return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
