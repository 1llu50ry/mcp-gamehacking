/**
 * arena-layout/ArenaLayoutManager.ts
 *
 * ArenaLayoutManager — cached, occupancy-aware spatial layout for the Agent
 * Arena. Pure TypeScript: no DOM / canvas / Svelte imports, so it is fully
 * unit-testable in vitest and shared by the scene transform (TASK-250) and
 * the minimap / arrow renderer (TASK-251).
 *
 * Design:
 *  - 12-column grid; every section edge lands on a shared grid boundary by
 *    construction (no hardcoded coordinates anywhere).
 *  - Two horizontal bands (main / exception) with occupancy-aware heights.
 *  - Column spans are allocated per band from occupancy demand, clamped to
 *    each section's [minSpan, maxSpan] and rebalanced so Σspan === 12.
 *  - Layout is computed lazily and cached; any change to dimensions,
 *    occupancy, or the registered section set invalidates the cache.
 */

import type {
	BandId,
	GridSpec,
	Occupancy,
	Point,
	Rect,
	SectionBounds,
	SectionDefinition,
	WorkflowEdge,
	WorkflowEdgeKind
} from "./types";
import {
	GRID_COLUMNS,
	GUTTER,
	OUTER_MARGIN,
	allocateBandHeights,
	allocateSpans,
	clamp,
	columnWidth,
	computeWorkstationGrid,
	contentArea,
	demand,
	innerArea,
	rectsOverlap,
	sectionWidth,
	sectionX,
	workstationPositions
} from "./grid";
import { DEFAULT_SECTIONS, defaultAccentColor, defaultFloorStyle } from "./sections";

const DEFAULT_CANVAS_WIDTH = 1280;
const DEFAULT_CANVAS_HEIGHT = 800;
/** Float tolerance for validate() comparisons. */
const EPS = 1e-6;

// ── Anchor helpers ──────────────────────────────────────────────────────────
function topCenter(r: Rect): Point {
	return { x: r.x + r.w / 2, y: r.y };
}
function bottomCenter(r: Rect): Point {
	return { x: r.x + r.w / 2, y: r.y + r.h };
}
function leftCenter(r: Rect): Point {
	return { x: r.x, y: r.y + r.h / 2 };
}
function rightCenter(r: Rect): Point {
	return { x: r.x + r.w, y: r.y + r.h / 2 };
}
function topRight(r: Rect): Point {
	return { x: r.x + r.w, y: r.y };
}
function bottomLeft(r: Rect): Point {
	return { x: r.x, y: r.y + r.h };
}

interface WorkflowDef {
	from: string;
	to: string;
	kind: WorkflowEdgeKind;
	fromAnchor: (r: Rect) => Point;
	toAnchor: (r: Rect) => Point;
}

/** The four workflow edges of the arena (anchors computed from live rects). */
const WORKFLOW_DEFS: WorkflowDef[] = [
	{ from: "backlog", to: "pending", kind: "primary", fromAnchor: topCenter, toAnchor: bottomCenter },
	{ from: "pending", to: "in_progress", kind: "primary", fromAnchor: rightCenter, toAnchor: leftCenter },
	{ from: "blocked", to: "recovery", kind: "exception", fromAnchor: rightCenter, toAnchor: leftCenter },
	{ from: "recovery", to: "pending", kind: "return", fromAnchor: topRight, toAnchor: bottomLeft }
];

export class ArenaLayoutManager {
	private canvasWidth: number;
	private canvasHeight: number;
	private occupancy: Occupancy;
	private registry: Map<string, SectionDefinition>;
	private cachedKey: string | null = null;
	private cachedSections: SectionBounds[] | null = null;

	constructor(canvasWidth: number = DEFAULT_CANVAS_WIDTH, canvasHeight: number = DEFAULT_CANVAS_HEIGHT) {
		this.canvasWidth = canvasWidth;
		this.canvasHeight = canvasHeight;
		this.occupancy = {};
		this.registry = new Map();
		for (const def of DEFAULT_SECTIONS) {
			this.registry.set(def.id, def);
		}
	}

	// ── Mutable inputs (each invalidates the cached layout) ──────────────────

	/** Set the canvas dimensions. */
	setDimensions(width: number, height: number): void {
		this.canvasWidth = width;
		this.canvasHeight = height;
	}

	/** Replace the occupancy snapshot (task count per section id). */
	setOccupancy(counts: Occupancy): void {
		this.occupancy = { ...counts };
	}

	/**
	 * Register a new section definition. The section auto-partitions the 12
	 * columns of its band by weight — no manual coordinates required.
	 * Throws on duplicate ids or configurations that cannot fit the grid.
	 */
	registerSection(def: SectionDefinition): void {
		this.assertValidDefinition(def);
		if (this.registry.has(def.id)) {
			throw new Error(`registerSection: section "${def.id}" is already registered`);
		}
		// Band feasibility: Σ minSpan ≤ 12 ≤ Σ maxSpan must hold after insertion.
		const bandDefs = [...this.registry.values()].filter((d) => d.band === def.band);
		const minSum = bandDefs.reduce((acc, d) => acc + d.minSpan, 0) + def.minSpan;
		const maxSum = bandDefs.reduce((acc, d) => acc + d.maxSpan, 0) + def.maxSpan;
		if (minSum > GRID_COLUMNS || maxSum < GRID_COLUMNS) {
			throw new Error(
				`registerSection: band "${def.band}" cannot fit 12 columns (Σmin=${minSum}, Σmax=${maxSum}) with section "${def.id}"`
			);
		}
		this.registry.set(def.id, def);
	}

	private assertValidDefinition(def: SectionDefinition): void {
		if (!def.id || typeof def.id !== "string") throw new Error("registerSection: id must be a non-empty string");
		if (def.band !== "main" && def.band !== "exception") {
			throw new Error(`registerSection: invalid band "${String(def.band)}"`);
		}
		if (!Number.isFinite(def.weight) || def.weight < 1 || def.weight > 10) {
			throw new Error(`registerSection: weight must be 1-10, got ${def.weight}`);
		}
		if (
			!Number.isInteger(def.minSpan) ||
			!Number.isInteger(def.maxSpan) ||
			def.minSpan < 1 ||
			def.maxSpan > GRID_COLUMNS ||
			def.minSpan > def.maxSpan
		) {
			throw new Error(
				`registerSection: invalid span clamps min=${def.minSpan} max=${def.maxSpan} (must be 1-${GRID_COLUMNS}, min ≤ max)`
			);
		}
	}

	// ── Read-only getters (cached, never mutate internal state) ──────────────

	/** All computed section bounds (cached; identity-stable for identical inputs). */
	getSections(): SectionBounds[] {
		this.ensureLayout();
		return this.cachedSections as SectionBounds[];
	}

	/** Computed bounds for one section id, or undefined. */
	getSection(id: string): SectionBounds | undefined {
		return this.getSections().find((s) => s.id === id);
	}

	/** Computed bounds for the sections in one band (flow order). */
	getBandSections(band: BandId): SectionBounds[] {
		const ids = new Set([...this.registry.values()].filter((d) => d.band === band).map((d) => d.id));
		return this.getSections().filter((s) => ids.has(s.id));
	}

	/** Registered section definitions (registry order). */
	getDefinitions(): SectionDefinition[] {
		return [...this.registry.values()];
	}

	/** Grid spec (columns, colWidth, gutters, margins) for renderers / minimap. */
	getGrid(): GridSpec {
		const inner = innerArea(this.canvasWidth, this.canvasHeight);
		return {
			columns: GRID_COLUMNS,
			colWidth: columnWidth(inner.w),
			gutter: GUTTER,
			margin: OUTER_MARGIN,
			rowGap: GUTTER,
			innerRect: inner
		};
	}

	/**
	 * Row-major workstation positions (cell centers) for a section, capped at
	 * MAX_TASKS_PER_ZONE. Computed from the section's contentRect, so it is
	 * always self-consistent with the passed `count` regardless of the cached
	 * occupancy snapshot.
	 */
	getWorkstationPositions(id: string, count: number): Point[] {
		const section = this.getSection(id);
		if (!section) throw new Error(`getWorkstationPositions: unknown section "${id}"`);
		const grid = computeWorkstationGrid(section.contentRect.w, section.contentRect.h, count);
		return workstationPositions(section.contentRect, grid, count);
	}

	/** The four workflow edges with live anchors on the correct section edges. */
	getWorkflow(): WorkflowEdge[] {
		const byId = new Map(this.getSections().map((s) => [s.id, s]));
		const edges: WorkflowEdge[] = [];
		for (const def of WORKFLOW_DEFS) {
			const from = byId.get(def.from);
			const to = byId.get(def.to);
			if (!from || !to) continue;
			edges.push({
				from: def.from,
				to: def.to,
				kind: def.kind,
				fromAnchor: def.fromAnchor(from.rect),
				toAnchor: def.toAnchor(to.rect)
			});
		}
		return edges;
	}

	/**
	 * Assert layout invariants; throws an Error on any violation:
	 * Σspan === 12 per band, rects within canvas, no overlaps, consistent
	 * gutters, and all edges on grid boundaries.
	 */
	validate(): void {
		const sections = this.getSections();
		const inner = innerArea(this.canvasWidth, this.canvasHeight);
		const colW = columnWidth(inner.w);

		for (const band of ["main", "exception"] as const) {
			const bandSections = this.getBandSections(band);
			const sum = bandSections.reduce((acc, s) => acc + s.span, 0);
			if (sum !== GRID_COLUMNS) {
				throw new Error(`validate: band "${band}" spans sum to ${sum}, expected ${GRID_COLUMNS}`);
			}
		}

		for (const s of sections) {
			const { x, y, w, h } = s.rect;
			if (x < -EPS || y < -EPS || x + w > this.canvasWidth + EPS || y + h > this.canvasHeight + EPS) {
				throw new Error(
					`validate: section "${s.id}" rect escapes canvas (${JSON.stringify(s.rect)} vs ${this.canvasWidth}x${this.canvasHeight})`
				);
			}
			const expectedX = sectionX(inner.x, colW, s.startCol);
			const expectedW = sectionWidth(colW, s.span);
			if (Math.abs(s.rect.x - expectedX) > EPS || Math.abs(s.rect.w - expectedW) > EPS) {
				throw new Error(`validate: section "${s.id}" is not aligned to grid boundaries`);
			}
			if (s.contentRect.x < s.rect.x - EPS || s.contentRect.y < s.rect.y - EPS) {
				throw new Error(`validate: section "${s.id}" contentRect escapes its rect`);
			}
		}

		for (let i = 0; i < sections.length; i++) {
			for (let j = i + 1; j < sections.length; j++) {
				if (rectsOverlap(sections[i].rect, sections[j].rect)) {
					throw new Error(`validate: sections "${sections[i].id}" and "${sections[j].id}" overlap`);
				}
			}
		}

		for (const band of ["main", "exception"] as const) {
			const bandSections = [...this.getBandSections(band)].sort((a, b) => a.startCol - b.startCol);
			for (let i = 1; i < bandSections.length; i++) {
				const prev = bandSections[i - 1];
				const cur = bandSections[i];
				if (Math.abs(cur.rect.x - (prev.rect.x + prev.rect.w + GUTTER)) > EPS) {
					throw new Error(`validate: gutter between "${prev.id}" and "${cur.id}" in band "${band}" is inconsistent`);
				}
			}
		}

		const main = this.getBandSections("main");
		const exception = this.getBandSections("exception");
		if (main.length > 0 && exception.length > 0) {
			const mainBottom = Math.max(...main.map((s) => s.rect.y + s.rect.h));
			const exceptionTop = Math.min(...exception.map((s) => s.rect.y));
			if (Math.abs(exceptionTop - (mainBottom + GUTTER)) > EPS) {
				throw new Error("validate: vertical gap between main and exception bands is inconsistent");
			}
		}
	}

	// ── Caching ───────────────────────────────────────────────────────────────

	private ensureLayout(): void {
		const key = this.computeCacheKey();
		if (this.cachedKey === key && this.cachedSections) return;
		this.cachedSections = this.computeLayout();
		this.cachedKey = key;
	}

	/** Cache key = dimensions + occupancy counts + registered ids. */
	private computeCacheKey(): string {
		const entries = [...this.registry.values()]
			.map((d) => d.id)
			.sort()
			.map((id) => `${id}:${this.occupancy[id] ?? 0}`)
			.join("|");
		return `${this.canvasWidth}x${this.canvasHeight}|${entries}`;
	}

	private computeLayout(): SectionBounds[] {
		const inner = innerArea(this.canvasWidth, this.canvasHeight);
		const colW = columnWidth(inner.w);
		const mainDefs = this.defsForBand("main");
		const exceptionDefs = this.defsForBand("exception");
		const mainDemand = this.bandDemand(mainDefs);
		const exceptionDemand = this.bandDemand(exceptionDefs);
		const { mainH, exceptionH } = allocateBandHeights(inner.h, mainDemand, exceptionDemand);

		const sections: SectionBounds[] = [];
		this.appendBand(sections, mainDefs, inner, colW, OUTER_MARGIN, mainH);
		this.appendBand(sections, exceptionDefs, inner, colW, OUTER_MARGIN + mainH + GUTTER, exceptionH);
		return sections;
	}

	private defsForBand(band: BandId): SectionDefinition[] {
		return [...this.registry.values()].filter((d) => d.band === band).sort((a, b) => a.flowStage - b.flowStage);
	}

	private bandDemand(defs: SectionDefinition[]): number {
		return defs.reduce((acc, d) => acc + demand(this.occupancy[d.id] ?? 0, d.weight), 0);
	}

	private appendBand(
		out: SectionBounds[],
		defs: SectionDefinition[],
		inner: Rect,
		colW: number,
		y: number,
		h: number
	): void {
		if (defs.length === 0) return;
		const demands = defs.map((d) => demand(this.occupancy[d.id] ?? 0, d.weight));
		const spans = allocateSpans(
			demands,
			defs.map((d) => d.minSpan),
			defs.map((d) => d.maxSpan)
		);
		let startCol = 0;
		for (let i = 0; i < defs.length; i++) {
			const def = defs[i];
			const span = spans[i];
			const rect: Rect = { x: sectionX(inner.x, colW, startCol), y, w: sectionWidth(colW, span), h };
			const content = contentArea(rect);
			const count = clamp(this.occupancy[def.id] ?? 0, 0, Number.MAX_SAFE_INTEGER);
			const grid = computeWorkstationGrid(content.w, content.h, count);
			out.push({
				id: def.id,
				label: def.label,
				rect,
				contentRect: content,
				span,
				startCol,
				columns: grid.columns,
				rows: grid.rows,
				cellWidth: grid.cellWidth,
				cellHeight: grid.cellHeight,
				visual: {
					color: def.color,
					accentColor: def.accentColor ?? defaultAccentColor(def.color),
					decorStyle: def.decorStyle,
					floorStyle: def.floorStyle ?? defaultFloorStyle(def.decorStyle)
				}
			});
			startCol += span;
		}
	}
}

// ── Module-level singleton ──────────────────────────────────────────────────
let singletonInstance: ArenaLayoutManager | null = null;

/**
 * Shared ArenaLayoutManager instance (created with default canvas dims —
 * call setDimensions() at boot). Used by both the scene transform (TASK-250)
 * and the minimap / arrow renderer (TASK-251) so layout stays consistent.
 */
export function getArenaLayoutManager(): ArenaLayoutManager {
	singletonInstance ??= new ArenaLayoutManager();
	return singletonInstance;
}
