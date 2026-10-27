<script lang="ts">
	import ContextMenu from "./ContextMenu.svelte";
	import { ArenaRenderer } from "../lib/arena/arenaRenderer";
	import type { ArenaScene } from "../lib/arena/arenaTypes";
	import { arenaStateManager } from "../lib/arena/arenaStateManager";

	// ── Zoom constraints ────────────────────────────────────────────────────
	const ZOOM_MIN = 0.1;
	const ZOOM_MAX = 3.0;
	const ZOOM_ANIM_DURATION = 300;

	// ── Zone key mapping ────────────────────────────────────────────────────
	const ZONE_KEY_MAP: Record<string, string> = {
		"1": "pending",
		"2": "in_progress",
		"3": "backlog",
		"4": "blocked",
		"5": "recovery"
	};

	let {
		renderer = null,
		scene = null,
		canvas,
		zoom = 1.0,
		panX = 0,
		panY = 0,
		onhover,
		onselect
	}: {
		renderer?: ArenaRenderer | null;
		scene?: ArenaScene | null;
		canvas: HTMLCanvasElement;
		zoom?: number;
		panX?: number;
		panY?: number;
		onhover?: (id: string | null, type: "agent" | "task" | null, pos: { x: number; y: number } | null) => void;
		onselect?: (id: string | null, type: "agent" | "task" | "repository" | null) => void;
	} = $props();

	// ── Local state ─────────────────────────────────────────────────────────
	let isPanning = $state(false);
	let panLastX = 0;
	let panLastY = 0;
	let lastClickTime = 0;
	let ctxVisible = $state(false);
	let ctxX = $state(0);
	let ctxY = $state(0);
	let ctxEntityType: "agent" | "task" | "repository" | null = $state(null);
	let ctxEntityId: string | null = $state(null);
	let focusMode: "canvas" | "controls" = "canvas";
	let selectedEntityId: string | null = null;
	let selectedEntityType: "agent" | "task" | "repository" | null = null;

	/**
	 * Pointer position in CSS pixels relative to the canvas — the space hit
	 * tests, pan and world coordinates all use.
	 *
	 * Deliberately NOT scaled by `canvas.width / rect.width`: that ratio is the
	 * device-pixel ratio now that the backing store is DPR-scaled, so applying
	 * it would offset every click by the DPR factor on HiDPI displays. The
	 * element's CSS box already IS the CSS-pixel space.
	 */
	function canvasCoords(e: MouseEvent): { cx: number; cy: number } {
		const rect = canvas.getBoundingClientRect();
		return { cx: e.clientX - rect.left, cy: e.clientY - rect.top };
	}

	function onMouseMove(e: MouseEvent): void {
		if (isPanning) {
			const dx = e.clientX - panLastX;
			const dy = e.clientY - panLastY;
			panLastX = e.clientX;
			panLastY = e.clientY;
			// Pointer deltas are already CSS pixels, and pan is stored in CSS
			// pixels — no backing-store scaling (see canvasCoords).
			arenaStateManager.setPan(panX + dx, panY + dy);
			return;
		}
		if (!renderer || !scene) {
			onhover?.(null, null, null);
			return;
		}
		const { cx, cy } = canvasCoords(e);
		const hit = renderer.hitTest(cx, cy);
		if (hit) {
			const aid = hit.type === "agent" ? hit.id : null;
			renderer.setHovered(aid);
			onhover?.(hit.id, hit.type, {
				x: e.clientX - canvas.getBoundingClientRect().left + 14,
				y: e.clientY - canvas.getBoundingClientRect().top - 10
			});
		} else {
			renderer.setHovered(null);
			onhover?.(null, null, null);
		}
	}

	function onMouseDown(e: MouseEvent): void {
		if (e.button !== 1) return;
		e.preventDefault();
		isPanning = true;
		panLastX = e.clientX;
		panLastY = e.clientY;
		canvas.style.cursor = "grabbing";
	}

	function onMouseUp(e: MouseEvent): void {
		if (e.button !== 1 || !isPanning) return;
		isPanning = false;
		canvas.style.cursor = "default";
	}

	function onMouseLeave(): void {
		onhover?.(null, null, null);
		renderer?.setHovered(null);
		if (isPanning) {
			isPanning = false;
			canvas.style.cursor = "default";
		}
	}

	function onWheel(e: WheelEvent): void {
		e.preventDefault();
		const { cx, cy } = canvasCoords(e);
		const delta = -e.deltaY * 0.001;
		const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * (1 + delta)));
		const wx = (cx - panX) / zoom;
		const wy = (cy - panY) / zoom;
		arenaStateManager.setZoom(newZoom);
		arenaStateManager.setPan(cx - wx * newZoom, cy - wy * newZoom);
	}

	function onCanvasClick(e: MouseEvent): void {
		if (e.button !== 0) return;
		const now = Date.now();
		const { cx, cy } = canvasCoords(e);
		if (now - lastClickTime < 350) {
			if (!renderer) return;
			const hit = renderer.hitTestAgentWithPos(cx, cy);
			if (hit) animateZoomTo(hit.wx, hit.wy, 2.5);
			else {
				const wx = (cx - panX) / zoom;
				const wy = (cy - panY) / zoom;
				animateZoomTo(wx, wy, Math.min(ZOOM_MAX, zoom * 1.8));
			}
			lastClickTime = 0;
			return;
		}
		lastClickTime = now;
		if (!renderer || !scene) return;
		const hit = renderer.hitTest(cx, cy);
		if (hit) {
			selectedEntityId = hit.id;
			selectedEntityType = hit.type;
			arenaStateManager.setSelected(hit.id, hit.type);
			if (hit.type === "agent") arenaStateManager.setSidePanelView("agent");
			else if (hit.type === "task") arenaStateManager.setSidePanelView("task");
			onselect?.(hit.id, hit.type);
		} else {
			selectedEntityId = null;
			selectedEntityType = null;
			arenaStateManager.setSelected(null, null);
			onselect?.(null, null);
		}
	}

	function onContextMenu(e: MouseEvent): void {
		e.preventDefault();
		if (!renderer || !scene) return;
		const { cx, cy } = canvasCoords(e);
		const hit = renderer.hitTest(cx, cy);
		if (hit) {
			ctxEntityType = hit.type;
			ctxEntityId = hit.id;
			ctxX = e.clientX;
			ctxY = e.clientY;
			ctxVisible = true;
			selectedEntityId = hit.id;
			selectedEntityType = hit.type;
			arenaStateManager.setSelected(hit.id, hit.type);
		} else ctxVisible = false;
	}

	function onContextAction(e: CustomEvent<{ action: string; entityId: string; entityType: string }>): void {
		const { action, entityId, entityType } = e.detail;
		if (action === "focus") {
			if (renderer) renderer.focusEntity(entityId, entityType as "agent" | "task");
		} else if (action === "view-details" || action === "view-logs") {
			arenaStateManager.setSelected(entityId, entityType as "agent" | "task" | "repository");
			arenaStateManager.setSidePanelView(entityType === "repository" ? "repo" : (entityType as "agent" | "task"));
		}
	}

	function onContextClose(): void {
		ctxVisible = false;
	}

	function onKeyDown(e: KeyboardEvent): void {
		const tag = (e.target as HTMLElement)?.tagName;
		if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
		if (!scene) return;
		switch (e.key) {
			case "Tab":
				e.preventDefault();
				focusMode = focusMode === "canvas" ? "controls" : "canvas";
				if (focusMode === "canvas") canvas?.focus();
				break;
			case "ArrowUp":
			case "ArrowDown":
			case "ArrowLeft":
			case "ArrowRight":
				if (focusMode !== "canvas" || !renderer) break;
				e.preventDefault();
				navigateEntity(e.key);
				break;
			case "Enter":
				e.preventDefault();
				if (selectedEntityId && selectedEntityType) {
					arenaStateManager.setSelected(selectedEntityId, selectedEntityType);
					if (selectedEntityType === "agent") arenaStateManager.setSidePanelView("agent");
					else if (selectedEntityType === "task") arenaStateManager.setSidePanelView("task");
					else if (selectedEntityType === "repository") arenaStateManager.setSidePanelView("repo");
					if (renderer) renderer.focusEntity(selectedEntityId, selectedEntityType as "agent" | "task");
				}
				break;
			case "Escape":
				e.preventDefault();
				if (ctxVisible) ctxVisible = false;
				else {
					selectedEntityId = null;
					selectedEntityType = null;
					arenaStateManager.setSelected(null, null);
				}
				break;
			case "r":
				if (e.ctrlKey || e.metaKey) break;
				e.preventDefault();
				arenaStateManager.resetView();
				break;
			case "f": {
				if (e.ctrlKey || e.metaKey) break;
				e.preventDefault();
				const fb = document.querySelector(".filter-bar") as HTMLElement | null;
				if (fb) fb.style.display = fb.style.display === "none" ? "" : "none";
				break;
			}
			case "e":
				if (e.ctrlKey || e.metaKey) break;
				e.preventDefault();
				arenaStateManager.toggleTimeline();
				break;
			case "/":
				e.preventDefault();
				break;
			case " ":
				if (e.ctrlKey || e.metaKey) break;
				e.preventDefault();
				arenaStateManager.togglePause();
				break;
			default:
				if (ZONE_KEY_MAP[e.key] && !e.ctrlKey && !e.metaKey && !e.altKey) {
					e.preventDefault();
					focusZone(ZONE_KEY_MAP[e.key]);
				}
				break;
		}
	}

	function navigateEntity(direction: string): void {
		if (!scene || !renderer) return;
		const agents = Array.from(scene.agents.values());
		const tasks = Array.from(scene.tasks.values());
		const all = [
			...agents.map((a) => ({ id: a.id, type: "agent" as const, x: a.x, y: a.y })),
			...tasks.map((t) => ({ id: t.id, type: "task" as const, x: t.x, y: t.y }))
		];
		if (all.length === 0) return;
		if (!selectedEntityId) {
			const f = all[0];
			selectedEntityId = f.id;
			selectedEntityType = f.type;
			arenaStateManager.setSelected(f.id, f.type);
			return;
		}
		const cur = all.find((e) => e.id === selectedEntityId);
		if (!cur) {
			const f = all[0];
			selectedEntityId = f.id;
			selectedEntityType = f.type;
			arenaStateManager.setSelected(f.id, f.type);
			return;
		}
		let best: (typeof all)[0] | null = null;
		let bestDist = Infinity;
		for (const ent of all) {
			if (ent.id === cur.id) continue;
			const dx2 = ent.x - cur.x,
				dy2 = ent.y - cur.y;
			let ok = false;
			if (direction === "ArrowUp") ok = dy2 < -5;
			else if (direction === "ArrowDown") ok = dy2 > 5;
			else if (direction === "ArrowLeft") ok = dx2 < -5;
			else if (direction === "ArrowRight") ok = dx2 > 5;
			if (ok) {
				const d = Math.hypot(dx2, dy2);
				if (d < bestDist) {
					bestDist = d;
					best = ent;
				}
			}
		}
		if (best) {
			selectedEntityId = best.id;
			selectedEntityType = best.type;
			arenaStateManager.setSelected(best.id, best.type);
		}
	}

	function focusZone(zoneId: string): void {
		if (!renderer) return;
		const zones = renderer.getZones();
		const zone = zones.find((z) => z.id === zoneId);
		if (!zone || !canvas) return;
		animateZoomTo(zone.x + zone.w / 2, zone.y + zone.h / 2, Math.min(ZOOM_MAX, 1.8));
	}

	function animateZoomTo(worldX: number, worldY: number, targetZoom: number): void {
		if (!canvas) return;
		const startZoom = zoom,
			startPanX = panX,
			startPanY = panY;
		// clientWidth/Height = CSS pixels. canvas.width is the DPR-scaled
		// backing store and would centre the target off-screen on HiDPI.
		const targetPanX = canvas.clientWidth / 2 - worldX * targetZoom;
		const targetPanY = canvas.clientHeight / 2 - worldY * targetZoom;
		const startTime = performance.now();
		function tick(now: number): void {
			const e2 = now - startTime,
				t = Math.min(1, e2 / ZOOM_ANIM_DURATION),
				ease = 1 - Math.pow(1 - t, 3);
			arenaStateManager.setZoom(startZoom + (targetZoom - startZoom) * ease);
			arenaStateManager.setPan(
				startPanX + (targetPanX - startPanX) * ease,
				startPanY + (targetPanY - startPanY) * ease
			);
			if (t < 1) requestAnimationFrame(tick);
		}
		requestAnimationFrame(tick);
	}
</script>

<div
	class="interaction-layer"
	onmousemove={onMouseMove}
	onmousedown={onMouseDown}
	onmouseup={onMouseUp}
	onmouseleave={onMouseLeave}
	onwheel={onWheel}
	onclick={onCanvasClick}
	oncontextmenu={onContextMenu}
	onkeydown={onKeyDown}
	role="none"
>
	<ContextMenu
		visible={ctxVisible}
		x={ctxX}
		y={ctxY}
		entityType={ctxEntityType}
		entityId={ctxEntityId}
		on:action={onContextAction}
		on:close={onContextClose}
	/>
</div>

<style>
	.interaction-layer {
		position: absolute;
		inset: 0;
	}
</style>
