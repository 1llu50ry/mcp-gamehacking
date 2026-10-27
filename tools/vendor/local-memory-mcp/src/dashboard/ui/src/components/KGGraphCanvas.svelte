<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher } from "svelte";
	import { NODE_RADIUS } from "$lib/kg/KGForceLayout";
	import { MAX_DPR } from "$lib/kg/kg-neural-renderer/layout";
	import type { LayoutNode, LayoutEdge } from "$lib/kg/KGForceLayout";
	import {
		startNeuralAnimation,
		stopNeuralAnimation,
		updateAnimationData,
		updateNeuralDimensions,
		wakeNeuralAnimation,
		zoomCamera,
		startDragCamera,
		dragCamera,
		endDragCamera,
		resetCamera,
		getZoomPercent,
		isCameraDragging,
		queryNodeCandidates,
		isSpatialGridReady
	} from "$lib/kg/KGNeuralRenderer";
	import type { NeuralRenderState } from "$lib/kg/KGNeuralRenderer";

	// ─── Props ─────────────────────────────────────────────────────────────────
	export let layoutNodes: LayoutNode[] = [];
	export let layoutEdges: LayoutEdge[] = [];
	export let getNodeByKey: (key: string) => LayoutNode | undefined = () => undefined;
	export let graphState: NeuralRenderState;
	export let isZeroEdgeOverview = false;
	export let nodeCount = 0;

	// Interaction callbacks (parent handles modal/drawer state)
	export let onDetailEntityChange: (name: string) => void = () => {};
	export let onDeleteNodeRequest: (name: string) => void = () => {};
	export let onDeleteEdgeRequest: (source: string, target: string, relationType: string) => void = () => {};
	export let onResize: (width: number, height: number) => void = () => {};
	export let onZoomPercentChange: (pct: number) => void = () => {};

	// Canvas state
	let canvas: HTMLCanvasElement;
	const dispatch = createEventDispatcher();
	let ctx: CanvasRenderingContext2D | null = null;
	let canvasWidth = 800;
	let canvasHeight = 600;

	// Interaction tracking
	let dragStartPos: { x: number; y: number } | null = null;
	let didDrag = false;
	let zoomPercent = 100;
	let lastPinchDist = 0;

	// Animation
	let animationCleanup: (() => void) | null = null;
	let canvasReady = false;

	// Idempotent-resize guard (TASK-415, mirrors ArenaViewportCanvas's
	// lastInitKey pattern). handleResize → updateNeuralDimensions writes
	// canvas.style.width/height (layout-affecting) + the backing store and
	// re-notifies the parent — running that on EVERY ResizeObserver fire,
	// including unchanged/mount-time fires, writes layout mid-observe and
	// triggers the transient "ResizeObserver loop completed with undelivered
	// notifications" console warning. Keying on the CSS-pixel size makes a
	// no-op resize a true no-op (no canvas writes, no parent notify), which
	// breaks the feedback cycle; real resizes still re-init.
	let lastCanvasKey = "";

	/** CSS-pixel size key of the observed parent (both the guard COMPARES and
	 * the seed INITIALIZES with this — one source, one rounding, so the
	 * mount-time RO notification can never mismatch the seed). */
	function canvasSizeKey(): string {
		const rect = canvas?.parentElement?.getBoundingClientRect();
		const w = rect ? rect.width : 800;
		const h = rect ? rect.height : 600;
		return `${Math.round(w)}x${Math.round(h)}`;
	}

	// ─── Lifecycle ─────────────────────────────────────────────────────────────
	let resizeObserver: ResizeObserver | null = null;

	onMount(() => {
		if (!canvas) return;
		updateNeuralDimensions(canvas);
		// Backing store is sized with the CAPPED dpr (TASK-271). CSS-pixel
		// dimensions therefore must divide by the capped value, not the raw
		// devicePixelRatio, or width/height would shrink on DPR > 1.5 displays.
		const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
		canvasWidth = canvas.width / dpr;
		canvasHeight = canvas.height / dpr;
		// Seed the guard with the initial size so the ResizeObserver's first
		// (always-delivered) notification is a no-op — no canvas writes or
		// parent notify mid-observe on mount (TASK-415). Seeded from the SAME
		// source/rounding the guard compares (canvasSizeKey), so the initial
		// notification can never mismatch and re-trigger the loop.
		lastCanvasKey = canvasSizeKey();
		ctx = canvas.getContext("2d");
		canvasReady = true;
		dispatch("ready");

		resizeObserver = new ResizeObserver(() => handleResize());
		if (canvas.parentElement) {
			resizeObserver.observe(canvas.parentElement);
		}
	});

	onDestroy(() => {
		resizeObserver?.disconnect();
		resizeObserver = null;
		stopNeuralAnimation();
		animationCleanup = null;
	});

	function handleResize() {
		if (!canvas) return;
		// Idempotent re-init (TASK-415): act only when the CSS-pixel size
		// actually changed. The rect is read BEFORE any write so the guard
		// compares the same source the re-init applies; rounding keeps
		// sub-pixel jitter from re-triggering. updateNeuralDimensions writes
		// canvas.style.width/height + backing store and wakes the renderer,
		// and onResize notifies the parent — both must stay skipped when the
		// size is unchanged or the mount-time RO feedback loop fires.
		const key = canvasSizeKey();
		if (key === lastCanvasKey) return;
		lastCanvasKey = key;
		updateNeuralDimensions(canvas);
		const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
		canvasWidth = canvas.width / dpr;
		canvasHeight = canvas.height / dpr;
		ctx = canvas.getContext("2d")!;
		onResize(canvasWidth, canvasHeight);
	}

	// ─── React to layout data changes ──────────────────────────────────────────

	function ensureAnimation() {
		if (animationCleanup) {
			updateAnimationData(layoutNodes, layoutEdges);
		} else if (ctx) {
			animationCleanup = startNeuralAnimation(canvas, canvasWidth, canvasHeight, layoutNodes, layoutEdges, graphState);
		}
	}

	$: if (layoutNodes.length > 0 && ctx && canvasReady) {
		ensureAnimation();
	}

	// ─── Interaction handlers ───────────────────────────────────────────────────

	function handleCanvasClick(e: MouseEvent) {
		if (didDrag) return;

		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		const hitRadius = NODE_RADIUS + 4;
		const node = findNodeAt(mx, my, hitRadius);
		if (node) {
			graphState.selectedNode = node;
			graphState.selectedEdge = null;
			graphState.showTooltip = false;
			onDetailEntityChange(node.name);
			return;
		}

		// Edge hit test with AABB pre-rejection before the segment distance check
		const edgeHitRadius = 10;
		for (const edge of layoutEdges) {
			const a = getNodeByKey(edge.source);
			const b = getNodeByKey(edge.target);
			if (!a || !b) continue;
			if (
				(a.x < mx - edgeHitRadius && b.x < mx - edgeHitRadius) ||
				(a.x > mx + edgeHitRadius && b.x > mx + edgeHitRadius) ||
				(a.y < my - edgeHitRadius && b.y < my - edgeHitRadius) ||
				(a.y > my + edgeHitRadius && b.y > my + edgeHitRadius)
			) {
				continue;
			}
			const dist = distToSegment(mx, my, a.x, a.y, b.x, b.y);
			if (dist < edgeHitRadius) {
				graphState.selectedEdge = edge;
				graphState.selectedNode = null;
				graphState.showTooltip = false;
				onDetailEntityChange("");
				return;
			}
		}

		graphState.selectedNode = null;
		graphState.selectedEdge = null;
		graphState.showTooltip = false;
		onDetailEntityChange("");
	}

	function handleCanvasDblClick(e: MouseEvent) {
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		const node = findNodeAt(mx, my, NODE_RADIUS + 4);
		if (node) {
			graphState.selectedNode = node;
			onDetailEntityChange("");
			onDeleteNodeRequest(node.name);
		}
	}

	function handleCanvasRightClick(e: MouseEvent) {
		e.preventDefault();
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		// Edge hit test with AABB pre-rejection before the segment distance check
		const edgeHitRadius = 10;
		for (const edge of layoutEdges) {
			const a = getNodeByKey(edge.source);
			const b = getNodeByKey(edge.target);
			if (!a || !b) continue;
			if (
				(a.x < mx - edgeHitRadius && b.x < mx - edgeHitRadius) ||
				(a.x > mx + edgeHitRadius && b.x > mx + edgeHitRadius) ||
				(a.y < my - edgeHitRadius && b.y < my - edgeHitRadius) ||
				(a.y > my + edgeHitRadius && b.y > my + edgeHitRadius)
			) {
				continue;
			}
			const dist = distToSegment(mx, my, a.x, a.y, b.x, b.y);
			if (dist < edgeHitRadius) {
				graphState.selectedEdge = edge;
				graphState.selectedNode = null;
				onDeleteEdgeRequest(edge.source, edge.target, edge.relation_type);
				return;
			}
		}
	}

	function handleCanvasMove(e: MouseEvent) {
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;

		if (isCameraDragging()) return;

		const found = findNodeAt(mx, my, NODE_RADIUS + 4);

		if (found !== graphState.hoveredNode) {
			graphState.hoveredNode = found;
			canvas.style.cursor = found ? "pointer" : "default";
		}
	}

	// ─── Zoom & Drag handlers ───────────────────────────────────────────────

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		zoomCamera(e.deltaY);
		zoomPercent = getZoomPercent();
		onZoomPercentChange(zoomPercent);
	}

	function handleMouseDown(e: MouseEvent) {
		if (e.button !== 0) return;
		dragStartPos = { x: e.clientX, y: e.clientY };
		didDrag = false;
		startDragCamera(e.clientX, e.clientY);
	}

	function handleMouseMoveForDrag(e: MouseEvent) {
		if (!dragStartPos) return;
		const dx = e.clientX - dragStartPos.x;
		const dy = e.clientY - dragStartPos.y;
		if (!didDrag && Math.hypot(dx, dy) > 3) {
			didDrag = true;
		}
		if (didDrag) {
			dragCamera(e.clientX, e.clientY);
			canvas.style.cursor = "grabbing";
		}
	}

	function handleMouseUp(_e: MouseEvent) {
		if (dragStartPos) {
			endDragCamera();
			dragStartPos = null;
			didDrag = false;
			canvas.style.cursor = "default";
		}
	}

	function handleMouseLeave(_e: MouseEvent) {
		if (dragStartPos) {
			endDragCamera();
			dragStartPos = null;
			didDrag = false;
			canvas.style.cursor = "default";
		}
	}

	// ─── Touch pinch zoom ───────────────────────────────────────────────────

	function getPinchDist(t1: Touch, t2: Touch): number {
		return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
	}

	function handleTouchStart(e: TouchEvent) {
		if (e.touches.length === 2) {
			e.preventDefault();
			lastPinchDist = getPinchDist(e.touches[0], e.touches[1]);
		} else if (e.touches.length === 1) {
			const t = e.touches[0];
			startDragCamera(t.clientX, t.clientY);
			dragStartPos = { x: t.clientX, y: t.clientY };
			didDrag = false;
		}
	}

	function handleTouchMove(e: TouchEvent) {
		if (e.touches.length === 2) {
			e.preventDefault();
			const dist = getPinchDist(e.touches[0], e.touches[1]);
			if (lastPinchDist > 0) {
				const delta = lastPinchDist - dist;
				zoomCamera(delta * 0.5);
				zoomPercent = getZoomPercent();
				onZoomPercentChange(zoomPercent);
			}
			lastPinchDist = dist;
		} else if (e.touches.length === 1 && dragStartPos) {
			const t = e.touches[0];
			const dx = t.clientX - dragStartPos.x;
			const dy = t.clientY - dragStartPos.y;
			if (!didDrag && Math.hypot(dx, dy) > 3) {
				didDrag = true;
			}
			if (didDrag) {
				dragCamera(t.clientX, t.clientY);
			}
		}
	}

	function handleTouchEnd(e: TouchEvent) {
		if (e.touches.length < 2) {
			lastPinchDist = 0;
		}
		if (e.touches.length === 0) {
			endDragCamera();
			dragStartPos = null;
			didDrag = false;
		}
	}

	// ─── Zoom control exports (used by parent via bind:this) ────────────────

	export function handleZoomIn() {
		zoomCamera(-10);
		zoomPercent = getZoomPercent();
		onZoomPercentChange(zoomPercent);
	}

	export function handleZoomOut() {
		zoomCamera(10);
		zoomPercent = getZoomPercent();
		onZoomPercentChange(zoomPercent);
	}

	export function handleResetCamera() {
		resetCamera();
		// Camera reset changes the view even at the default zoom — wake the
		// settled renderer so the new framing is drawn immediately (TASK-277).
		wakeNeuralAnimation();
		zoomPercent = getZoomPercent();
		onZoomPercentChange(zoomPercent);
	}

	// ─── Geometry helper ────────────────────────────────────────────────────

	function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
		const dx = x2 - x1;
		const dy = y2 - y1;
		const len2 = dx * dx + dy * dy;
		if (len2 === 0) return Math.hypot(px - x1, py - y1);
		let t = ((px - x1) * dx + (py - y1) * dy) / len2;
		t = Math.max(0, Math.min(1, t));
		return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
	}

	// ─── Spatial-grid hit testing ───────────────────────────────────────────
	// Pre-select a small candidate set from the renderer's spatial grid (rebuilt
	// each frame with the latest projected positions), then run the exact
	// distance check on candidates only — avoids an O(N) scan per mousemove.
	// Falls back to a linear scan when the grid isn't built yet (animation not
	// started), preserving identical behavior.
	function findNodeAt(mx: number, my: number, hitRadius: number): LayoutNode | null {
		if (isSpatialGridReady()) {
			const candidates = queryNodeCandidates(mx, my, hitRadius);
			for (const n of candidates) {
				const dx = mx - n.x;
				const dy = my - n.y;
				if (dx * dx + dy * dy <= hitRadius * hitRadius) return n;
			}
			return null;
		}

		for (const n of layoutNodes) {
			const dx = mx - n.x;
			const dy = my - n.y;
			if (dx * dx + dy * dy <= hitRadius * hitRadius) return n;
		}
		return null;
	}
</script>

<canvas
	bind:this={canvas}
	on:click={handleCanvasClick}
	on:dblclick={handleCanvasDblClick}
	on:contextmenu={handleCanvasRightClick}
	on:mousemove={handleCanvasMove}
	on:mousemove={handleMouseMoveForDrag}
	on:mousedown={handleMouseDown}
	on:mouseup={handleMouseUp}
	on:mouseleave={handleMouseLeave}
	on:wheel={handleWheel}
	on:touchstart={handleTouchStart}
	on:touchmove={handleTouchMove}
	on:touchend={handleTouchEnd}
	aria-label={isZeroEdgeOverview
		? `Knowledge Graph zero-relation overview showing ${layoutNodes.length} of ${nodeCount} entities`
		: "Knowledge Graph visualization"}
	tabindex="0"
></canvas>
