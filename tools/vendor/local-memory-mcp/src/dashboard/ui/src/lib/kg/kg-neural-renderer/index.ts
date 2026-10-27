/**
 * Main animation orchestrator for the Knowledge Graph Neural Renderer.
 *
 * Module-level state, camera controls, and the animation loop. Cohesive
 * sub-systems live in sibling modules: hitGrid (hit-testing), derived
 * (data-derived structures), projection (3D→2D), edgeDraw / nodeDraw /
 * signals (draw passes), freeze (settle detection), layout / camera / edges /
 * nodes (primitives).
 */

import type { LayoutNode, LayoutEdge } from "../KGForceLayout";
import {
	resizeNeuralCanvas,
	isDarkMode,
	computeRotationTrig,
	drawBackgroundCached,
	BREATHE_SPEED,
	BREATHE_AMOUNT
} from "./layout";
import { drawTooltip, drawOverflowNotice, type NeuralRenderState } from "./nodes";
import { getEdgeConfAlpha, getEdgeConfBucket, getEdgeConfLabels } from "./edges";
import {
	updateCamera,
	zoomCamera,
	startDragCamera,
	dragCamera,
	endDragCamera,
	resetCamera,
	getZoomPercent,
	isCameraDragging,
	isZoomAnimating,
	resetAutoRotationClock
} from "./camera";
import { spawnSignals, updateSignals, clearSignals, drawSignalLayer } from "./signals";
import { rebuildSpatialGrid } from "./hitGrid";
import { buildDerivedData } from "./derived";
import { projectAllNodes, sortProjected, rebuildProjIndex, getProjByIndex } from "./projection";
import { collectAndSortEdges, drawCollectedEdges } from "./edgeDraw";
import { drawNodeLayer } from "./nodeDraw";
import {
	resetSettleState,
	isFrozen,
	noteActivity,
	onQuietFrame,
	unfreeze,
	consumeFreezeGap,
	markFreezeGap,
	snapshotRenderState,
	hasRenderWork
} from "./freeze";

// Re-export public API for consumers
export type { NeuralRenderState };
export { zoomCamera, startDragCamera, dragCamera, endDragCamera, resetCamera, getZoomPercent, isCameraDragging };
export { queryNodeCandidates, isSpatialGridReady } from "./hitGrid";

// ─── Module-Level Animation State ────────────────────────────────────────────

let animationId: number | null = null;
let currentCleanup: (() => void) | null = null;

// Pause/resume control (TASK-189). `running` is the manual control used by
// consumers (e.g. KGGraph stops the loop when the KG tab unmounts);
// `isTabHidden` snapshots document.visibilitychange so the RAF loop also
// pauses when the browser tab is hidden. Both must be true for the loop to
// schedule frames — no rendering work happens while either is false.
let running = false;
let isTabHidden = false;

// Hook into the active animation instance so the module-level resume()
// control can re-anchor the frame clock (avoids a large dt jump after a
// pause/hidden period) and restart scheduling. Only the single active
// animation sets this; cleared on cleanup.
let currentResumeHook: (() => void) | null = null;

let animNodes: LayoutNode[] = [];
let animEdges: LayoutEdge[] = [];
let animDataDirty = false;

let width = 0;
let height = 0;
let cx = 0;
let cy = 0;
// Effective backing-store DPR for the active canvas (set on start/resize).
// Used to restore the backing resolution after a drag (see render()).
let backingDpr = 1;

// ─── Performance Optimization State ─────────────────────────────────────────
const MAX_RENDERED_EDGES = 2000;
// TASK-277: while dragging, cap the rendered edge budget lower than the
// full-cap so the interaction stays responsive (the audit thresholds are
// <30ms per task / ≥20fps drag). The graph shows the full edge set the
// moment the drag ends (the frame renders with MAX_RENDERED_EDGES again).
const DRAG_MAX_RENDERED_EDGES = 1200;

// ─── Main Animation Entry Point ──────────────────────────────────────────────

export function startNeuralAnimation(
	canvas: HTMLCanvasElement,
	initialWidth: number,
	initialHeight: number,
	nodes: LayoutNode[],
	edges: LayoutEdge[],
	state: NeuralRenderState
): () => void {
	stopNeuralAnimation();

	width = initialWidth;
	height = initialHeight;
	cx = width / 2;
	cy = height / 2;
	backingDpr = initialWidth > 0 ? canvas.width / initialWidth : 1;

	animNodes = nodes;
	animEdges = edges;
	animDataDirty = false;

	const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
	if (!ctx) return () => {};

	// Resume loop control state for this animation instance
	running = true;
	isTabHidden = typeof document !== "undefined" && document.hidden;

	// Reset settle/freeze state (TASK-277) so a fresh animation starts with an
	// intro burst and freezes only after the first quiet period.
	resetSettleState();

	// Device detection for frame skipping
	const isLowEnd = navigator.hardwareConcurrency !== undefined && navigator.hardwareConcurrency < 4;
	let frameCount = 0;

	// Animation time tracking
	let startTime = performance.now();
	let lastTimestamp = startTime;
	let totalElapsed = 0;

	// Derived 3D data — rebuilt when animNodes/animEdges change (./derived).
	let derived = buildDerivedData(nodes, edges);

	// ── Main render frame ──
	function render(now: number) {
		// Rebuild derived data if nodes/edges were updated externally
		if (animDataDirty) {
			animDataDirty = false;
			clearSignals();
			derived = buildDerivedData(animNodes, animEdges);
		}

		// Confidence bucket state lives in ./edges; snapshot the arrays once
		// per frame (rebuilt above if the data mutated) so the per-edge reads
		// stay direct array accesses — zero allocation in the hot loop.
		const edgeConfBucket = getEdgeConfBucket();
		const edgeConfAlpha = getEdgeConfAlpha();
		const edgeLabels = getEdgeConfLabels();

		const dark = isDarkMode();
		const dt = now - lastTimestamp;
		lastTimestamp = now;
		totalElapsed += dt;

		// Camera update (zoom lerp + auto-rotation)
		const isZeroEdge = animEdges.length === 0;
		const cam = updateCamera(now, isZeroEdge, totalElapsed);

		// rotY/rotX are frame constants — compute the 4 trig values ONCE per
		// frame and share them with every node/signal projection (~1200
		// trig calls/frame → 4).
		const frameTrig = computeRotationTrig(cam.rotY, cam.rotX);

		// Breathing
		const breathe = isZeroEdge ? 1 : 1 + Math.sin(totalElapsed * BREATHE_SPEED) * BREATHE_AMOUNT;

		// Clear and draw background (cached gradient)
		ctx.clearRect(0, 0, width, height);
		drawBackgroundCached(ctx, width, height, dark);

		const dragging = isCameraDragging();
		const doSignals = !dragging;

		// TASK-277: while dragging, draw into a 1x backing store and restore
		// the effective DPR when the drag ends. Raster work scales with the
		// backing pixel count, so dropping 1.5x → 1x cuts the fill cost
		// ~2.25x during the most expensive interaction (target: <30ms tasks
		// while dragging). Resizing the backing store resets the context
		// transform, so re-apply the scale explicitly. CSS size is untouched
		// — no layout shift, and the full-resolution frame returns the moment
		// the drag ends (or on the next resize).
		if (dragging) {
			if (canvas.width !== width) {
				canvas.width = width;
				canvas.height = height;
				ctx.setTransform(1, 0, 0, 1, 0, 0);
			}
		} else {
			const fullW = Math.round(width * backingDpr);
			if (canvas.width !== fullW) {
				canvas.width = fullW;
				canvas.height = Math.round(height * backingDpr);
				ctx.setTransform(backingDpr, 0, 0, backingDpr, 0, 0);
			}
		}

		// Update signals (skipped while dragging — decorative only, keeps the
		// pointer hot path lean; ~30 gradient draws/frame saved during pan).
		if (doSignals) {
			spawnSignals(now, derived.nodes3d, animEdges, derived.nodeIndexById);
			updateSignals();
		}

		// Project all nodes (3D → 2D) with sphere breathing. Records are
		// reused from the pooled view — zero allocations per frame (TASK-271).
		const projected = projectAllNodes(derived.nodes3d, cx, cy, width, height, breathe, cam, frameTrig);

		// Rebuild spatial grid for hit-testing (positions/camera changed this frame)
		rebuildSpatialGrid(animNodes);

		// Depth sort (far to near) — in place over the pooled view.
		sortProjected(projected);

		// Build projected lookup by original index — Map is REUSED across
		// frames (clear+set) instead of allocating a new Map every frame
		// (TASK-271).
		rebuildProjIndex(projected, derived.nodeIndexById);

		const hasFocus = !!(state.hoveredNode || state.selectedNode);

		// ── Draw edges (far to near) ──
		// Viewport frustum with margin for edges just outside
		const viewMargin = 100;
		const viewport = { left: -viewMargin, right: width + viewMargin, top: -viewMargin, bottom: height + viewMargin };

		collectAndSortEdges({
			edges: animEdges,
			edgeSrcIdx: derived.edgeSrcIdx,
			edgeTgtIdx: derived.edgeTgtIdx,
			projByIndex: getProjByIndex(),
			edgeConfBucket,
			edgeConfAlpha,
			edgeLabels,
			state,
			hasFocus,
			dragging,
			viewport,
			maxEdges: dragging ? DRAG_MAX_RENDERED_EDGES : MAX_RENDERED_EDGES
		});

		// Inactive edges batched per-confidence-bucket path, active edges
		// individually (see drawEdgeBatches for the cross-bucket z-order note).
		const edgeColor = dark ? "0,212,255" : "55,48,163";
		drawCollectedEdges(ctx, edgeColor, dark, totalElapsed);

		// ── Draw signals (skipped while dragging — decorative, TASK-271) ──
		if (doSignals) {
			drawSignalLayer(ctx, {
				animNodes,
				nodes3d: derived.nodes3d,
				cx,
				cy,
				width,
				height,
				breathe,
				cam,
				frameTrig,
				dark
			});
		}

		// ── Draw nodes (far to near — already sorted) ──
		drawNodeLayer(ctx, { projected, state, cam, dark, now, dragging, viewport });

		// ── Tooltip ──
		if (state.showTooltip && state.selectedNode) {
			drawTooltip(ctx, state.selectedNode, state.tooltipPos, width, height);
		}

		// ── Overflow notice ──
		if (state.hiddenNodeCount && state.hiddenNodeCount > 0) {
			drawOverflowNotice(ctx, width, state.hiddenNodeCount);
		}

		// ── Sync rendered-state snapshot (TASK-277) ──
		// Frozen frames reference-compare against these to detect host-driven
		// state changes (hover/selection/tooltip) without any DOM work.
		snapshotRenderState(state);
	}

	// ── Animation loop ──
	// Frames are only scheduled while `running && !isTabHidden`. When paused
	// (hidden tab or manual pause), no further frame is scheduled, so the loop
	// performs zero work until resumed.
	function animate(timestamp: number) {
		animationId = null;
		if (!running || isTabHidden) return; // paused — do not reschedule

		// TASK-271 / audit F3: while dragging (or on low-end devices) render
		// every OTHER frame. Pointer updates only need ~30 fps visually; this
		// halves the per-frame raster/sim cost during the most expensive
		// interaction (the audit measured 12.5 fps during drag).
		const dragging = isCameraDragging();
		if ((isLowEnd || dragging) && frameCount++ % 2 !== 0) {
			animationId = requestAnimationFrame(animate);
			return;
		}

		// ── Settle detection + freeze (TASK-277) ──
		// Frozen frames perform NO rendering — just the O(1) wake check above.
		// This is what turns "idle" into ~0 main-thread work: the expensive
		// render (signals, projection, grid rebuild, edge/node raster) simply
		// stops running once the graph is at rest.
		if (isFrozen()) {
			if (!hasRenderWork(state, dragging, isZoomAnimating(), animDataDirty)) {
				// At rest — retain the last frame; the spatial grid still
				// matches the static node positions so hit-testing works.
				animationId = requestAnimationFrame(animate);
				return;
			}
			unfreeze(timestamp);
		} else if (hasRenderWork(state, dragging, isZoomAnimating(), animDataDirty)) {
			noteActivity(timestamp);
		} else {
			onQuietFrame(timestamp);
		}

		if (consumeFreezeGap()) {
			// First frame after a freeze gap: re-anchor the frame + auto-
			// rotation clocks so the gap doesn't teleport breathing/rotation.
			lastTimestamp = timestamp;
			resetAutoRotationClock();
		}

		render(timestamp);
		animationId = requestAnimationFrame(animate);
	}

	// Re-anchor the frame clock and restart scheduling. Called on visibility
	// resume and by the exported resumeNeuralAnimation() control.
	currentResumeHook = () => {
		// Reset `lastTimestamp` so the first frame after a pause/hidden period
		// does not produce a huge dt that teleports camera auto-rotation.
		lastTimestamp = performance.now();
		if (animationId === null && running && !isTabHidden) {
			animationId = requestAnimationFrame(animate);
		}
	};

	// Pause the RAF loop while the browser tab is hidden; resume when visible.
	// (Browsers already throttle rAF for hidden tabs, but this makes the
	// pause explicit and re-anchors the clock so auto-rotation doesn't jump.)
	const handleVisibilityChange = () => {
		isTabHidden = document.hidden;
		if (!isTabHidden) {
			currentResumeHook?.();
		}
	};
	document.addEventListener("visibilitychange", handleVisibilityChange);

	// ── Kick off ──
	startTime = performance.now();
	lastTimestamp = startTime;
	totalElapsed = 0;
	noteActivity(startTime);
	if (!isTabHidden) {
		animationId = requestAnimationFrame(animate);
	}

	// ── Cleanup function ──
	const cleanup = () => {
		if (animationId !== null) {
			cancelAnimationFrame(animationId);
			animationId = null;
		}
		document.removeEventListener("visibilitychange", handleVisibilityChange);
		currentResumeHook = null;
	};

	currentCleanup = cleanup;
	return cleanup;
}

// ─── Force Stop ──────────────────────────────────────────────────────────────

export function stopNeuralAnimation(): void {
	if (animationId !== null) {
		cancelAnimationFrame(animationId);
		animationId = null;
	}
	if (currentCleanup) {
		currentCleanup();
		currentCleanup = null;
	}
}

// ─── Pause / Resume Control (TASK-189) ───────────────────────────────────────

/**
 * Pauses the active animation loop. No frames are scheduled while paused.
 * The current frame is cancelled immediately; rendering resumes from the
 * same state via `resumeNeuralAnimation()`. Safe to call when no animation
 * is running.
 */
export function pauseNeuralAnimation(): void {
	running = false;
	if (animationId !== null) {
		cancelAnimationFrame(animationId);
		animationId = null;
	}
}

/**
 * Resumes the animation loop after `pauseNeuralAnimation()` (or after the
 * browser tab becomes visible again). Does nothing if the loop is already
 * running, or while the tab is still hidden (visibilitychange resumes it).
 */
export function resumeNeuralAnimation(): void {
	if (running) return;
	running = true;
	isTabHidden = typeof document !== "undefined" && document.hidden;
	if (isTabHidden) return; // resumes via visibilitychange when visible
	currentResumeHook?.();
}

/**
 * Reports whether the animation loop is currently active (running and the
 * tab is visible). Useful for consumers to decide whether to call
 * `pauseNeuralAnimation()` / `resumeNeuralAnimation()`.
 */
export function isNeuralAnimationRunning(): boolean {
	return running && !isTabHidden;
}

// ─── Wake Control (TASK-277) ─────────────────────────────────────────────────

/**
 * Instantly unfreezes a settled graph and (re)starts rendering. The renderer
 * freezes after ~20 quiet frames to eliminate idle CPU burn; consumers that
 * mutate the scene outside the regular interaction path (e.g. a camera reset)
 * call this to force an immediate redraw. A resize / data update wakes the
 * loop automatically via the frozen-frame check.
 */
export function wakeNeuralAnimation(): void {
	unfreeze(performance.now());
	markFreezeGap();
	if (animationId === null) currentResumeHook?.();
}

// ─── External Dimension Update ──────────────────────────────────────────────

export function updateNeuralDimensions(canvas: HTMLCanvasElement): void {
	const { width: w, height: h, dpr } = resizeNeuralCanvas(canvas);
	width = w;
	height = h;
	cx = width / 2;
	cy = height / 2;
	backingDpr = dpr;
	// Resize invalidates the retained frame (backing store + viewport
	// changed) — wake so the next frame re-renders at the new dimensions.
	wakeNeuralAnimation();
}

// ─── Live Data Update ───────────────────────────────────────────────────────

export function updateAnimationData(nodes: LayoutNode[], edges: LayoutEdge[]): void {
	animNodes = nodes;
	animEdges = edges;
	animDataDirty = true;
}
