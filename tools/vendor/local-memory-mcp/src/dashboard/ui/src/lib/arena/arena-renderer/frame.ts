/**
 * Arena render pass — the full per-frame draw pipeline.
 *
 * A pure function of the frame inputs + persistent `ArenaCaches` (owned by the
 * renderer, mutated in place so cached geometry/stats survive across frames).
 * Keeps ArenaRenderer as a slim orchestrator (loop, freeze control, public
 * API); this module owns the draw order: floor → rooms → workflow arrows →
 * zone aggregates → workstations → claim links/handoff beams → agents.
 */
import type { ArenaScene, VisualTask, ZoneRect, ArenaLayoutConfig } from "../arenaTypes";
import type { ArenaLayoutManager } from "../arena-layout/ArenaLayoutManager";
import type { SectionBounds, WorkflowEdge } from "../arena-layout/types";
import type { FilterState } from "../arenaEvents";
import { sectionsToZones } from "../arenaTransform-layout";
import { STATUS_TO_ZONE } from "../arenaTransform-utils";
import {
	LOD_FULL,
	LOD_NORMAL,
	LOD_SIMPLIFIED,
	LOD_AGGREGATE,
	type LODLevel,
	makeCtx,
	pointInRect,
	matchesAgentFilter,
	matchesTaskFilter,
	isFilterActive,
	getCanvasDpr,
	getCanvasCssSize
} from "./utils";
import { drawGlobalFloor, drawRoom } from "./scene";
import { drawCharacter, drawCharacterSimplified, drawCharacterAggregate } from "./agents";
import { drawClaimLinks, drawHandoffBeams, drawWorkflowArrows } from "./connections";
import type { ZoneStats } from "./zones";
import { drawHandoffTrail, drawHandoffGroup } from "./effects";
import { drawWorkstation, drawWorkstationSimplified, drawZoneAggregate } from "./workstations";

/** Persistent per-frame caches owned by the renderer (mutated in place). */
export interface ArenaCaches {
	/** Manager sections mapped to the legacy ZoneRect shape (full rects). */
	zones: ZoneRect[];
	/** Cached sections (identity-compared to detect manager cache invalidation). */
	cachedSections: SectionBounds[] | null;
	/** Section id → section color (for workstation monitor accents). */
	zoneColorById: Map<string, string>;
	/** Workflow pipeline edges (cached alongside zones — same invalidation). */
	workflowEdges: WorkflowEdge[];
	/** Cached per-section task/agent counts for the stats strip. */
	zoneStats: Map<string, ZoneStats>;
	/** Sections identity the cached task-count portion was computed from. */
	statsSections: SectionBounds[] | null;
	/** Scene reference the cached task-count portion was computed from. */
	statsScene: ArenaScene | null;
	currentLod: LODLevel;
}

export interface ArenaFrameArgs {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	scene: ArenaScene | null;
	layout: ArenaLayoutConfig;
	isDark: boolean;
	zoom: number;
	panX: number;
	panY: number;
	ts: number;
	hoveredId: string | null;
	reducedMotion: boolean;
	reducedTransparency: boolean;
	layoutManager: ArenaLayoutManager;
	activeFilter: FilterState;
	caches: ArenaCaches;
}

function getViewportCullBounds(zoom: number, panX: number, panY: number, canvas: HTMLCanvasElement) {
	const z = zoom || 1,
		m = z < 0.5 ? 100 : 50;
	const l = -panX / z,
		t = -panY / z;
	// CSS pixels, not the device-pixel backing store: pan/zoom are applied in
	// CSS space, so using canvas.width here would over-extend the cull box by
	// the DPR factor and defeat culling entirely on HiDPI displays.
	const { w, h } = getCanvasCssSize(canvas);
	return { left: l - m, top: t - m, right: l + w / z + m, bottom: t + h / z + m };
}

function isInViewport(x: number, y: number, b: { left: number; top: number; right: number; bottom: number }): boolean {
	return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
}

function computeLOD(zoom: number): LODLevel {
	return zoom >= 1 ? LOD_FULL : zoom >= 0.5 ? LOD_NORMAL : zoom >= 0.25 ? LOD_SIMPLIFIED : LOD_AGGREGATE;
}

/**
 * Refresh cached zones/colors when the manager's layout cache was
 * invalidated (dims/occupancy changed). The manager returns the same
 * sections array until its cache key changes — identity comparison makes
 * this a single O(1) check per frame, with no per-frame zone math.
 */
function syncSections(caches: ArenaCaches, layoutManager: ArenaLayoutManager): void {
	const sections = layoutManager.getSections();
	if (sections === caches.cachedSections) return;
	caches.cachedSections = sections;
	caches.zones = sectionsToZones(sections);
	caches.zoneColorById = new Map(sections.map((s) => [s.id, s.visual.color]));
	caches.workflowEdges = layoutManager.getWorkflow();
}

/**
 * Per-section task/agent counts for the header stats strip — geometric
 * membership mirrors the aggregate overlay (both use the shared pointInRect
 * helper). Task positions are baked at scene build, so the task-count
 * portion is cached: recomputed only when the sections array identity (layout
 * cache invalidation) or the scene reference (re-baked positions) changes.
 * Agent counts refresh on every call because agents move per frame. Callers
 * only invoke this when the strip will actually be drawn.
 */
function computeZoneStats(
	caches: ArenaCaches,
	scene: ArenaScene,
	layoutManager: ArenaLayoutManager
): Map<string, ZoneStats> {
	const sections = layoutManager.getSections();
	if (sections !== caches.statsSections || scene !== caches.statsScene) {
		caches.statsSections = sections;
		caches.statsScene = scene;
		caches.zoneStats.clear();
		for (const zr of caches.zones) {
			let tasks = 0;
			for (const t of scene.tasks.values()) {
				if (pointInRect(t.x, t.y, zr)) tasks++;
			}
			caches.zoneStats.set(zr.id, { tasks, agents: 0 });
		}
	}
	// Agents move every frame — refresh their counts whenever the strip draws.
	for (const zr of caches.zones) {
		let agents = 0;
		for (const a of scene.agents.values()) {
			if (pointInRect(a.targetX, a.targetY, zr)) agents++;
		}
		const prev = caches.zoneStats.get(zr.id) ?? { tasks: 0, agents: 0 };
		caches.zoneStats.set(zr.id, { tasks: prev.tasks, agents });
	}
	return caches.zoneStats;
}

/** Section accent color for a task's workstation (matches its room tint). */
function zoneColorForTask(t: VisualTask, caches: ArenaCaches): string {
	const zoneId = STATUS_TO_ZONE[t.status] ?? "";
	return caches.zoneColorById.get(zoneId) ?? caches.zones[0]?.color ?? "#64748b";
}

/**
 * Section accent color for a claim link's target task — the same manager
 * section tokens rooms use (status → zone → section color). Statuses with
 * no registered zone (completed / canceled render no room) get the neutral
 * fallback instead of borrowing another section's tint.
 */
function zoneColorForStatus(status: string, caches: ArenaCaches): string {
	const zoneId = STATUS_TO_ZONE[status] ?? "";
	return caches.zoneColorById.get(zoneId) ?? "#64748b";
}

/**
 * Renders one full arena frame (see module doc for the draw order).
 * try/finally guarantees the ctx.save() is always balanced by a restore —
 * even if a draw call throws, the transform stack stays clean and subsequent
 * frames render at the correct scale (no accumulation).
 */
export function renderArenaFrame(args: ArenaFrameArgs): void {
	const {
		canvas,
		ctx,
		scene,
		layout,
		isDark,
		zoom: z,
		panX: px,
		panY: py,
		ts,
		hoveredId,
		reducedMotion,
		reducedTransparency,
		layoutManager,
		activeFilter,
		caches
	} = args;
	if (!layout) return;
	syncSections(caches, layoutManager);
	const lod = (caches.currentLod = computeLOD(z));
	// The backing store is DPR-scaled; every coordinate below is in CSS pixels.
	// A single base transform maps one space onto the other, so no drawing
	// routine has to know the ratio exists.
	const dpr = getCanvasDpr(canvas);
	const css = getCanvasCssSize(canvas);
	const rc = makeCtx(ctx, css.w, css.h, isDark, ts, z, px, py, lod, hoveredId, reducedMotion, reducedTransparency);

	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = isDark ? "#0a0e1a" : "#dde3ed";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	// Bilinear filtering for any gradient/pattern resampling. Without this the
	// browser may pick nearest-neighbour, which reintroduces hard pixel edges —
	// the exact artefact the DPR fix is meant to remove.
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

	ctx.save();
	ctx.translate(px, py);
	ctx.scale(z, z);

	try {
		drawGlobalFloor(rc);
		const sections = caches.cachedSections ?? [];

		// Per-section task/agent counts for the header stats strip — computed
		// only when the strip will actually be drawn (FULL/NORMAL LOD; drawRoom
		// skips it at SIMPLIFIED/AGGREGATE). Task counts are cached inside
		// computeZoneStats (baked positions), so this is not a per-frame
		// recompute of layout or task geometry.
		const zoneStats = scene && lod < LOD_SIMPLIFIED ? computeZoneStats(caches, scene, layoutManager) : null;

		for (let i = 0; i < sections.length; i++) {
			drawRoom(rc, caches.zones[i], sections[i].visual, zoneStats?.get(caches.zones[i].id), layoutManager);
		}

		// Workflow arrows: infrastructure between rooms — drawn after rooms,
		// before workstations/agents so they read as the pipeline, not content.
		if (lod < LOD_AGGREGATE) drawWorkflowArrows(rc, caches.workflowEdges);

		if (!scene) return;

		if (lod === LOD_AGGREGATE) for (const zr of caches.zones) drawZoneAggregate(rc, zr, scene);

		const hasFilter = isFilterActive(activeFilter);
		const cull = lod < LOD_SIMPLIFIED ? getViewportCullBounds(z, px, py, canvas) : undefined;
		const sortedTasks = Array.from(scene.tasks.values())
			.filter(
				(t) =>
					(!hasFilter || matchesTaskFilter(t, activeFilter, scene.agents)) &&
					(lod >= LOD_SIMPLIFIED || isInViewport(t.x, t.y, cull!))
			)
			.sort((a, b) => a.y - b.y);

		if (lod === LOD_SIMPLIFIED) {
			for (const t of sortedTasks) drawWorkstationSimplified(rc, t);
		} else if (lod !== LOD_AGGREGATE) {
			for (const t of sortedTasks) {
				drawWorkstation(rc, t, reducedMotion, reducedTransparency, scene.agents, zoneColorForTask(t, caches));
			}
		}

		if (lod < LOD_SIMPLIFIED) {
			drawClaimLinks(
				rc,
				scene,
				(id) => matchesAgentFilter(scene.agents.get(id)!, activeFilter, scene.tasks),
				(id) => matchesTaskFilter(scene.tasks.get(id)!, activeFilter, scene.agents),
				() => isFilterActive(activeFilter),
				lod,
				(status) => zoneColorForStatus(status, caches)
			);
			drawHandoffBeams(
				rc,
				scene,
				(id) => matchesAgentFilter(scene.agents.get(id)!, activeFilter, scene.tasks),
				(id) => matchesTaskFilter(scene.tasks.get(id)!, activeFilter, scene.agents),
				() => isFilterActive(activeFilter),
				lod
			);
			for (const a of scene.agents.values()) {
				if (
					a.handoffAnim &&
					(!hasFilter || matchesAgentFilter(a, activeFilter, scene.tasks)) &&
					isInViewport(a.x, a.y, cull!)
				) {
					drawHandoffTrail(rc, a);
				}
			}
		}

		const sortedAgents = Array.from(scene.agents.values())
			.filter(
				(a) =>
					(!hasFilter || matchesAgentFilter(a, activeFilter, scene.tasks)) &&
					(lod >= LOD_SIMPLIFIED || isInViewport(a.x, a.y, cull!))
			)
			.sort((a, b) => a.y - b.y || (a.id === hoveredId ? 1 : -1));

		for (const a of sortedAgents) {
			if (a.handoffAnim) {
				drawHandoffGroup(rc, a);
				continue;
			}
			if (lod === LOD_AGGREGATE) drawCharacterAggregate(rc, a);
			else if (lod === LOD_SIMPLIFIED) drawCharacterSimplified(rc, a);
			else drawCharacter(rc, a);
		}
	} finally {
		ctx.restore();
	}
}
