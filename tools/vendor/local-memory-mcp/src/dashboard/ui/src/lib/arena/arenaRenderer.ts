import type { ArenaScene, ArenaLayoutConfig, ZoneRect } from "./arenaTypes";
import { sectionsToZones } from "./arenaTransform-layout";
import { getArenaLayoutManager } from "./arena-layout/ArenaLayoutManager";
import type { ArenaLayoutManager } from "./arena-layout/ArenaLayoutManager";
import type { FilterState } from "./arenaEvents";

// ─── Re-export LOD constants & type ──────────────────────────────────────
export { LOD_FULL, LOD_NORMAL, LOD_SIMPLIFIED, LOD_AGGREGATE } from "./arena-renderer/utils";
export type { LODLevel } from "./arena-renderer/utils";
import {
	LOD_NORMAL,
	ZOOM_MAX,
	ZOOM_MIN,
	filterEquals,
	sceneSignature,
	getCanvasCssSize,
	type WanderState
} from "./arena-renderer/utils";

import { renderArenaFrame, type ArenaCaches } from "./arena-renderer/frame";
import { updateAgents, updateHandoffAnim } from "./arena-renderer/physics";

// ═══════════════════════════════════════════════════════════════════════════
// ArenaRenderer — slim orchestrator (< 500 lines)
// ═══════════════════════════════════════════════════════════════════════════

export class ArenaRenderer {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private scene: ArenaScene | null = null;
	private layout: ArenaLayoutConfig | null = null;
	/** Shared layout manager — single source of truth for zone geometry. */
	private layoutManager: ArenaLayoutManager = getArenaLayoutManager();
	/**
	 * Per-frame render caches (zones/colors/workflow/stats/LOD) — owned here,
	 * mutated in place by the render pass (arena-renderer/frame.ts) so cached
	 * geometry and stats survive across frames without per-frame recompute.
	 */
	private frameCaches: ArenaCaches = {
		zones: [],
		cachedSections: null,
		zoneColorById: new Map(),
		workflowEdges: [],
		zoneStats: new Map(),
		statsSections: null,
		statsScene: null,
		currentLod: LOD_NORMAL
	};
	private isDark = false;
	private hoveredId: string | null = null;
	private selectedId: string | null = null;
	private selectedType: "agent" | "task" | "repository" | null = null;
	private rafId = 0;
	private ts = 0;
	private prevTs = 0;
	/** Dedup key for frame errors — an error message is logged once per distinct occurrence. */
	private lastFrameError: string | null = null;
	private wander = new Map<string, WanderState>();
	private activeFilter: FilterState = { repository: null, roles: [], priorities: [], statuses: [], search: "" };
	private reducedMotion = false;
	private reducedTransparency = false;
	private viewportZoom = 1.0;
	private viewportPanX = 0;
	private viewportPanY = 0;

	// ── Settle / Freeze Control (TASK-402 — mirrors the KG neural renderer's
	// TASK-277 pattern: settle-detect → freeze → O(1) wake check) ────────────
	// Root cause of the idle burn (audit: ~25-26fps continuous while at rest):
	// the loop rendered the full scene + wander sim every frame forever. Fix:
	// after SETTLE_FREEZE_FRAMES consecutive "quiet" frames (or SETTLE_FREEZE_MS
	// of quiet time) the arena enters frozen mode — the rAF slot keeps firing
	// but each frozen frame only performs the cheap O(1) wake check below: NO
	// sim, NO render, NO draw. Any external activity signal (viewport / hover /
	// selection / filter / reduced-motion / scene|layout|isDark mutation)
	// unfreezes the loop on the next tick. The ambient wander sim is NOT an
	// activity signal — it runs while unfrozen and freezes with the frame, so a
	// static arena costs ~0 main-thread work until the user interacts or a poll
	// delivers new data. The freeze-gap clock re-anchor prevents agents from
	// teleporting across a frozen stretch when the loop resumes.
	private static readonly SETTLE_FREEZE_FRAMES = 20;
	private static readonly SETTLE_FREEZE_MS = 600;
	private quietFrames = 0;
	private frozen = false;
	private lastActivityTimestamp = 0;
	private freezeGapPending = false;
	/**
	 * Content signature of the last scene handed to update() (see
	 * sceneSignature in arena-renderer/utils.ts). The polling layer rebuilds
	 * the scene with NEW object references every poll (buildArenaScene
	 * allocates fresh Maps), so a reference comparison would treat an
	 * identical poll as activity and re-render. Comparing content lets an
	 * unchanged poll keep the arena frozen (TASK-407 follow-up).
	 */
	private lastIncomingSignature: string | null = null;
	/** Set by update() when the incoming scene CONTENT differs from the last. */
	private sceneDirty = false;
	/** Snapshot of the state the last rendered frame was produced from. */
	private lastRenderedLayout: ArenaLayoutConfig | null = null;
	private lastRenderedIsDark = false;
	private lastRenderedHoveredId: string | null = null;
	private lastRenderedSelectedId: string | null = null;
	private lastRenderedSelectedType: "agent" | "task" | "repository" | null = null;
	private lastRenderedViewport = { zoom: 1.0, panX: 0, panY: 0 };
	/**
	 * Deep-ish snapshot of the filter the last rendered frame was produced
	 * from (arrays cloned — setFilter Object.assign-mutates the SAME
	 * activeFilter object in place, arenaStateManager.ts:270, so a shared
	 * array ref would never see in-place pushes/splices). null = never
	 * rendered → always wake.
	 */
	private lastRenderedFilter: FilterState | null = null;
	private lastRenderedReducedMotion = false;
	private lastRenderedReducedTransparency = false;

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
		this.ctx = canvas.getContext("2d")!;
	}

	// ── Public API ───────────────────────────────────────────────────────
	update(scene: ArenaScene, layout: ArenaLayoutConfig, isDark: boolean) {
		// Content-aware change detection: buildArenaScene allocates fresh Maps
		// on every poll even when backend data is unchanged — comparing object
		// refs would wake the renderer on every poll. A content signature lets
		// an identical poll keep the arena frozen (TASK-407).
		const sig = sceneSignature(scene);
		this.sceneDirty = sig !== this.lastIncomingSignature;
		this.lastIncomingSignature = sig;
		this.scene = scene;
		this.layout = layout;
		this.layoutManager = layout.layoutManager ?? getArenaLayoutManager();
		this.isDark = isDark;
	}
	setHovered(id: string | null) {
		this.hoveredId = id;
	}
	setFilter(filter: FilterState): void {
		this.activeFilter = filter;
	}
	setReducedMotion(enabled: boolean): void {
		this.reducedMotion = enabled;
	}
	setReducedTransparency(enabled: boolean): void {
		this.reducedTransparency = enabled;
	}
	setSelected(id: string | null, type: "agent" | "task" | "repository" | null) {
		this.selectedId = id;
		this.selectedType = type;
	}
	getSelected() {
		return { id: this.selectedId, type: this.selectedType };
	}
	start() {
		// Reset settle state so a restart always renders (and a stale "frozen"
		// flag from a previous session can never leave a dead canvas).
		this.quietFrames = 0;
		this.frozen = false;
		this.freezeGapPending = false;
		this.lastActivityTimestamp = performance.now();
		this.lastIncomingSignature = null;
		this.sceneDirty = true;
		this.lastRenderedLayout = null;
		this.lastRenderedViewport = { zoom: 1.0, panX: 0, panY: 0 };
		this.lastRenderedFilter = null;
		this.lastRenderedReducedMotion = false;
		this.lastRenderedReducedTransparency = false;
		this.rafId = requestAnimationFrame(this.loop);
	}
	stop() {
		cancelAnimationFrame(this.rafId);
	}

	setViewport(zoom: number, panX: number, panY: number): void {
		this.viewportZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
		this.viewportPanX = panX;
		this.viewportPanY = panY;
	}

	getViewportWorldBounds(): { x: number; y: number; w: number; h: number } {
		// CSS pixels: pan/zoom and every world coordinate live in CSS space,
		// while canvas.width is the DPR-scaled backing store.
		const { w: cw, h: ch } = getCanvasCssSize(this.canvas);
		const z = this.viewportZoom || 1;
		return { x: -this.viewportPanX / z, y: -this.viewportPanY / z, w: cw / z, h: ch / z };
	}

	getZones(): ZoneRect[] {
		if (!this.layout) return [];
		return sectionsToZones(this.layoutManager.getSections());
	}

	getViewportInfo() {
		const { w, h } = getCanvasCssSize(this.canvas);
		return {
			zoom: this.viewportZoom,
			panX: this.viewportPanX,
			panY: this.viewportPanY,
			canvasW: w,
			canvasH: h
		};
	}

	hitTestAgent(mx: number, my: number): string | null {
		if (!this.scene) return null;
		const world = this.screenToWorld(mx, my);
		for (const a of this.scene.agents.values()) {
			if (Math.hypot(world.x - a.x, world.y - a.y) <= 14) return a.id;
		}
		return null;
	}

	hitTestAgentWithPos(mx: number, my: number): { id: string; wx: number; wy: number } | null {
		if (!this.scene) return null;
		const world = this.screenToWorld(mx, my);
		for (const a of this.scene.agents.values()) {
			if (Math.hypot(world.x - a.x, world.y - a.y) <= 14) return { id: a.id, wx: a.x, wy: a.y };
		}
		for (const t of this.scene.tasks.values()) {
			if (Math.hypot(world.x - t.x, world.y - t.y) <= 20) return { id: t.id, wx: t.x, wy: t.y };
		}
		return null;
	}

	hitTestTask(mx: number, my: number): string | null {
		if (!this.scene) return null;
		const world = this.screenToWorld(mx, my);
		for (const t of this.scene.tasks.values()) {
			if (Math.hypot(world.x - t.x, world.y - t.y) <= 20) return t.id;
		}
		return null;
	}

	hitTest(mx: number, my: number): { type: "agent" | "task"; id: string } | null {
		const ah = this.hitTestAgent(mx, my);
		if (ah) return { type: "agent", id: ah };
		const th = this.hitTestTask(mx, my);
		if (th) return { type: "task", id: th };
		return null;
	}

	focusEntity(id: string, type: "agent" | "task"): void {
		if (!this.scene || !this.layout) return;
		const e = type === "agent" ? this.scene.agents.get(id) : this.scene.tasks.get(id);
		if (!e) return;
		const { w, h } = getCanvasCssSize(this.canvas);
		this.setViewport(2.0, w / 2 - e.x * 2, h / 2 - e.y * 2);
	}

	// ── Private helpers ─────────────────────────────────────────────────
	private screenToWorld(sx: number, sy: number) {
		const z = this.viewportZoom || 1;
		return { x: (sx - this.viewportPanX) / z, y: (sy - this.viewportPanY) / z };
	}

	/**
	 * True when anything invalidates the last rendered frame: a viewport
	 * change (drag / zoom / focusEntity), a hover/selection change, a FILTER
	 * change, a reduced-motion/transparency toggle, or a scene/layout/isDark
	 * mutation from the polling layer. This is the frozen-frame wake check —
	 * O(1), zero allocation, no DOM reads (mirrors the KG renderer's
	 * renderStateChanged). Filter/reduced-motion fields are compared per-field
	 * because setFilter mutates the shared object in place (TASK-409).
	 */
	private hasRenderWork(): boolean {
		return (
			this.sceneDirty ||
			this.layout !== this.lastRenderedLayout ||
			this.isDark !== this.lastRenderedIsDark ||
			this.hoveredId !== this.lastRenderedHoveredId ||
			this.selectedId !== this.lastRenderedSelectedId ||
			this.selectedType !== this.lastRenderedSelectedType ||
			this.viewportZoom !== this.lastRenderedViewport.zoom ||
			this.viewportPanX !== this.lastRenderedViewport.panX ||
			this.viewportPanY !== this.lastRenderedViewport.panY ||
			this.reducedMotion !== this.lastRenderedReducedMotion ||
			this.reducedTransparency !== this.lastRenderedReducedTransparency ||
			!this.lastRenderedFilter ||
			!filterEquals(this.activeFilter, this.lastRenderedFilter)
		);
	}

	/** Remember the state the just-rendered frame was produced from. */
	private snapshotRenderedState(): void {
		this.sceneDirty = false;
		this.lastRenderedLayout = this.layout;
		this.lastRenderedIsDark = this.isDark;
		this.lastRenderedHoveredId = this.hoveredId;
		this.lastRenderedSelectedId = this.selectedId;
		this.lastRenderedSelectedType = this.selectedType;
		this.lastRenderedViewport.zoom = this.viewportZoom;
		this.lastRenderedViewport.panX = this.viewportPanX;
		this.lastRenderedViewport.panY = this.viewportPanY;
		this.lastRenderedReducedMotion = this.reducedMotion;
		this.lastRenderedReducedTransparency = this.reducedTransparency;
		// Clone arrays: the shared activeFilter object is mutated in place by
		// the arena state manager, so a snapshot sharing refs would mask
		// in-place array edits (TASK-409).
		this.lastRenderedFilter = {
			repository: this.activeFilter.repository,
			roles: [...this.activeFilter.roles],
			priorities: [...this.activeFilter.priorities],
			statuses: [...this.activeFilter.statuses],
			search: this.activeFilter.search
		};
	}

	/**
	 * Frame scheduling is exception-safe: the next rAF is always re-requested
	 * in a finally, so a single render() throw (e.g. a transient degenerate
	 * geometry or a context state hiccup) can never permanently freeze the
	 * canvas. Errors are logged once per distinct message to avoid console
	 * spam while the loop keeps animating. On a successful frame the dedup
	 * key resets so an intermittent error is reported again when it recurs.
	 *
	 * Settle/freeze (TASK-402): frozen frames perform NO sim and NO render —
	 * only the O(1) wake check — which turns "idle" into ~0 main-thread work.
	 */
	private loop = (ts: number) => {
		this.ts = ts;

		// ── Settle detection + freeze ──
		if (this.frozen) {
			if (!this.hasRenderWork()) {
				// At rest — retain the last frame; just re-schedule the cheap
				// wake check. No sim, no render.
				this.rafId = requestAnimationFrame(this.loop);
				return;
			}
			this.frozen = false;
			this.quietFrames = 0;
			this.lastActivityTimestamp = ts;
		} else {
			if (this.hasRenderWork()) {
				this.quietFrames = 0;
				this.lastActivityTimestamp = ts;
			} else {
				this.quietFrames++;
				// Freeze after N quiet frames OR ~SETTLE_FREEZE_MS of quiet
				// time — whichever comes first (expensive first frames after an
				// interaction would otherwise stretch the frame-count delay).
				if (
					this.quietFrames >= ArenaRenderer.SETTLE_FREEZE_FRAMES ||
					ts - this.lastActivityTimestamp >= ArenaRenderer.SETTLE_FREEZE_MS
				) {
					this.frozen = true;
					this.freezeGapPending = true;
				}
			}
		}

		if (this.freezeGapPending) {
			// First frame after a freeze gap: re-anchor the frame clock so the
			// gap doesn't produce a huge dt that teleports the wander sim.
			this.freezeGapPending = false;
			this.prevTs = ts;
		}

		const dt = Math.min((ts - this.prevTs) / 1000, 0.05);
		this.prevTs = ts;
		try {
			if (this.scene && this.layout) {
				// Wander bounds = the in_progress content area (where the desks
				// are), straight from the shared manager; falls back to the first
				// registered section when "in_progress" is missing.
				const sections = this.layoutManager.getSections();
				const inProgress = sections.find((s) => s.id === "in_progress") ?? sections[0];
				if (inProgress) {
					const c = inProgress.contentRect;
					const idleZone: ZoneRect = {
						id: inProgress.id,
						label: inProgress.label,
						x: c.x,
						y: c.y,
						w: c.w,
						h: c.h,
						color: inProgress.visual.color
					};
					updateAgents(this.scene.agents, this.wander, idleZone, dt, ts, this.reducedMotion, updateHandoffAnim);
				}
			}
			this.render();
			this.lastFrameError = null;
			this.snapshotRenderedState();
		} catch (err) {
			this.logFrameError(err);
		} finally {
			this.rafId = requestAnimationFrame(this.loop);
		}
	};

	/** Log a frame error once per distinct message; the loop continues regardless. */
	private logFrameError(err: unknown): void {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg && msg === this.lastFrameError) return;
		this.lastFrameError = msg || null;
		console.error("[ArenaRenderer] frame error (render loop continues):", err);
	}

	// ── Main render ──────────────────────────────────────────────────────
	private render() {
		if (!this.layout) return;
		renderArenaFrame({
			canvas: this.canvas,
			ctx: this.ctx,
			scene: this.scene,
			layout: this.layout,
			isDark: this.isDark,
			zoom: this.viewportZoom,
			panX: this.viewportPanX,
			panY: this.viewportPanY,
			ts: this.ts,
			hoveredId: this.hoveredId,
			reducedMotion: this.reducedMotion,
			reducedTransparency: this.reducedTransparency,
			layoutManager: this.layoutManager,
			activeFilter: this.activeFilter,
			caches: this.frameCaches
		});
	}
}
