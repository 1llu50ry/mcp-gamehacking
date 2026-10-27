/**
 * arena-layout/types.ts
 *
 * Core types for the ArenaLayoutManager — a pure TypeScript spatial layout
 * engine for the Agent Arena. This module must stay free of any DOM / canvas
 * / Svelte imports so it can be unit-tested in isolation (vitest, node env)
 * and shared by the scene transform (TASK-250) and the minimap / arrow
 * renderer (TASK-251).
 */

/** Horizontal band within the arena canvas. Extendable (e.g. "aux") — the grid math is band-agnostic. */
export type BandId = "main" | "exception";

/** Existing floor styles used by the arena scene renderer. */
export type FloorStyle = "concrete" | "plaza" | "dirt" | "grass" | "wood" | "carpet" | "tile" | "cracked";

/** Decor style label per section — a renderer hook. Open string so new sections can introduce new decors. */
export type DecorStyle = string;

/**
 * Static description of a section. The registry owns one definition per
 * section id; the manager derives geometry (SectionBounds) from it.
 */
export interface SectionDefinition {
	/** Unique section id (also the task-status / zone id it maps to). */
	id: string;
	/** Human-readable label rendered above the section. */
	label: string;
	/** Which horizontal band the section lives in. */
	band: BandId;
	/** Importance 1-10 — drives occupancy-aware span allocation. */
	weight: number;
	/** Minimum number of columns this section may occupy (1-12). */
	minSpan: number;
	/** Maximum number of columns this section may occupy (1-12). */
	maxSpan: number;
	/** Primary hex color (section tint). */
	color: string;
	/** Decor style label consumed by the renderer. */
	decorStyle: DecorStyle;
	/** Accent hex color; defaults to a lightened variant of `color` when omitted. */
	accentColor?: string;
	/** Floor style; defaults per decorStyle when omitted. */
	floorStyle?: FloorStyle;
	/** Sort order within the band (left-to-right flow stage). */
	flowStage: number;
}

/** Axis-aligned rectangle (position + size). */
export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** 2D point. */
export interface Point {
	x: number;
	y: number;
}

/** Task counts per section id (occupancy snapshot). Unknown ids are ignored. */
export type Occupancy = Record<string, number>;

/** Grid spec for renderers / minimap. */
export interface GridSpec {
	/** Total column tracks (12). */
	columns: number;
	/** Width of a single column track. */
	colWidth: number;
	/** Gutter between adjacent column tracks (and between bands). */
	gutter: number;
	/** Outer margin between canvas edge and inner area. */
	margin: number;
	/** Vertical gap between the two horizontal bands. */
	rowGap: number;
	/** Inner area of the canvas (canvas inset by margin). */
	innerRect: Rect;
}

/** Computed geometry for one section. */
export interface SectionBounds {
	id: string;
	label: string;
	/** Outer section rect (includes label/stats/padding). */
	rect: Rect;
	/** Inner content rect where workstations live (inset + label/stats). */
	contentRect: Rect;
	/** Number of grid columns this section spans. */
	span: number;
	/** First grid column of this section (0-based). */
	startCol: number;
	/** Workstation grid columns inside contentRect. */
	columns: number;
	/** Workstation grid rows inside contentRect. */
	rows: number;
	/** Workstation cell width (contentW / columns). */
	cellWidth: number;
	/** Workstation cell height (clamped to [MIN_CELL_H, MAX_CELL_H], may shrink on tiny canvases). */
	cellHeight: number;
	/** Visual identity consumed by the renderer. */
	visual: {
		color: string;
		accentColor: string;
		decorStyle: DecorStyle;
		floorStyle: FloorStyle;
	};
}

/** Kind of workflow edge (rendering hints for arrows). */
export type WorkflowEdgeKind = "primary" | "exception" | "return";

/** Directed workflow edge between two sections (for future arrow rendering). */
export interface WorkflowEdge {
	/** Source section id. */
	from: string;
	/** Target section id. */
	to: string;
	kind: WorkflowEdgeKind;
	/** Anchor point on the source section edge. */
	fromAnchor: Point;
	/** Anchor point on the target section edge. */
	toAnchor: Point;
}
