/**
 * Settle detection + freeze control (TASK-277, audit F3 round 2).
 *
 * Root cause of the round-1 jank: the RAF loop rendered the FULL scene every
 * frame forever — continuous camera auto-rotation + signal spawning + node
 * projection + grid rebuild + edge/node raster — even when the graph was
 * fully settled (audit measured idle 6.7fps / 3.7fps settled and up to 393ms
 * long tasks, while the static control tab ran 40.8fps with 0 long tasks;
 * i.e. a static render is cheap — the CONTINUOUS loop is the cost).
 *
 * Fix: settle detection + freeze. After SETTLE_FREEZE_FRAMES consecutive
 * "quiet" frames (no drag, no zoom lerp, no pending data mutation, no
 * hover/selection/tooltip change) the graph enters frozen mode: the RAF
 * slot keeps firing but each frozen frame only performs a cheap O(1) wake
 * check — NO render, NO signals, NO projection, NO draw. Any of the wake
 * conditions (drag / hover change / zoom / resize / data mutation /
 * selection change) instantly unfreezes and renders a short animation burst
 * — including camera auto-rotation — before settling again.
 *
 * While frozen, hit-testing keeps working: the retained spatial grid matches
 * the (now static) node positions exactly, so queryNodeCandidates() is still
 * accurate without any per-frame rebuild.
 */
import type { LayoutNode, LayoutEdge } from "../KGForceLayout";
import type { NeuralRenderState } from "./nodes";

const SETTLE_FREEZE_FRAMES = 20;
// Time-based freeze guard: freeze after SETTLE_FREEZE_MS of quiet time even if
// fewer than SETTLE_FREEZE_FRAMES have rendered. Expensive frames (e.g. the
// full-resolution settle burst right after a drag) would otherwise stretch the
// frame-count freeze delay linearly with frame cost (20 × ~100ms = 2s of
// post-release jank).
const SETTLE_FREEZE_MS = 600;
let quietFrames = 0;
let frozen = false;
let lastActivityTimestamp = 0;
// Set when the loop transitions out of a frozen stretch; the next rendered
// frame re-anchors the frame clock + auto-rotation clock so a long frozen
// gap doesn't teleport breathing/rotation.
let freezeGapPending = false;

// Last rendered render-state (reference-compared each frozen frame to detect
// hover/selection/tooltip changes without any per-frame DOM work).
let lastHoveredNode: LayoutNode | null = null;
let lastSelectedNode: LayoutNode | null = null;
let lastSelectedEdge: LayoutEdge | null = null;
let lastShowTooltip = false;
let lastTooltipX = 0;
let lastTooltipY = 0;
let lastHiddenNodeCount = 0;

/** Fresh animation start: reset all settle/freeze state (intro burst first). */
export function resetSettleState(): void {
	quietFrames = 0;
	frozen = false;
	freezeGapPending = false;
	lastActivityTimestamp = 0;
	lastHoveredNode = null;
	lastSelectedNode = null;
	lastSelectedEdge = null;
	lastShowTooltip = false;
	lastTooltipX = 0;
	lastTooltipY = 0;
	lastHiddenNodeCount = 0;
}

export function isFrozen(): boolean {
	return frozen;
}

/** Records a frame with interaction activity (resets the quiet counter). */
export function noteActivity(timestamp: number): void {
	quietFrames = 0;
	lastActivityTimestamp = timestamp;
}

/**
 * Records a quiet frame; freezes (and arms the freeze-gap flag) once the
 * quiet streak crosses either threshold. Returns true when freezing.
 */
export function onQuietFrame(timestamp: number): boolean {
	quietFrames++;
	if (quietFrames >= SETTLE_FREEZE_FRAMES || timestamp - lastActivityTimestamp >= SETTLE_FREEZE_MS) {
		frozen = true;
		freezeGapPending = true;
		return true;
	}
	return false;
}

/** Unfreezes after a wake condition and re-anchors the activity timestamp. */
export function unfreeze(timestamp: number): void {
	frozen = false;
	quietFrames = 0;
	lastActivityTimestamp = timestamp;
}

/** True once per transition out of a frozen stretch (see freezeGapPending). */
export function consumeFreezeGap(): boolean {
	const pending = freezeGapPending;
	freezeGapPending = false;
	return pending;
}

/** Arms the freeze-gap flag (used by the external wake control). */
export function markFreezeGap(): void {
	freezeGapPending = true;
}

/**
 * Syncs the last-rendered render-state snapshot. Frozen frames reference-
 * compare against these to detect host-driven state changes
 * (hover/selection/tooltip) without any DOM work.
 */
export function snapshotRenderState(state: NeuralRenderState): void {
	lastHoveredNode = state.hoveredNode;
	lastSelectedNode = state.selectedNode;
	lastSelectedEdge = state.selectedEdge;
	lastShowTooltip = state.showTooltip;
	lastTooltipX = state.tooltipPos.x;
	lastTooltipY = state.tooltipPos.y;
	lastHiddenNodeCount = state.hiddenNodeCount ?? 0;
}

/**
 * True when anything invalidates the last rendered frame: a change to the
 * shared render state (hover/selection/tooltip). This is the frozen-frame wake
 * check — O(1), zero allocation, no DOM reads.
 */
export function renderStateChanged(state: NeuralRenderState): boolean {
	return (
		state.hoveredNode !== lastHoveredNode ||
		state.selectedNode !== lastSelectedNode ||
		state.selectedEdge !== lastSelectedEdge ||
		state.showTooltip !== lastShowTooltip ||
		state.tooltipPos.x !== lastTooltipX ||
		state.tooltipPos.y !== lastTooltipY ||
		(state.hiddenNodeCount ?? 0) !== lastHiddenNodeCount
	);
}

/**
 * Full frozen-frame wake check: interaction (drag / zoom lerp), a pending
 * data mutation, or a change to the shared render state.
 */
export function hasRenderWork(
	state: NeuralRenderState,
	isDragging: boolean,
	isZooming: boolean,
	animDataDirty: boolean
): boolean {
	return isDragging || isZooming || animDataDirty || renderStateChanged(state);
}
