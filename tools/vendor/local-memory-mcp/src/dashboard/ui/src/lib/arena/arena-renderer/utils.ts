import type { HelperVariant, ArenaScene } from "../arenaTypes";
import type { FilterState } from "../arenaEvents";

// ─── Level of Detail ────────────────────────────────────────────────────────
export const LOD_FULL = 0;
export const LOD_NORMAL = 1;
export const LOD_SIMPLIFIED = 2;
export const LOD_AGGREGATE = 3;
export type LODLevel = typeof LOD_FULL | typeof LOD_NORMAL | typeof LOD_SIMPLIFIED | typeof LOD_AGGREGATE;

// ─── Motion ────────────────────────────────────────────────────────────────
export const SPEED_WALK = 85;
export const SPEED_WANDER = 50;
export const ARRIVE_DIST = 6;
export const WANDER_INT: [number, number] = [2800, 5000];
export const WANDER_PAUSE: [number, number] = [600, 1600];

// ─── Handoff Animation ────────────────────────────────────────────────────
export const HANDOFF_SPEED = 100;
export const PICKUP_DURATION = 800;
export const ARRIVE_DURATION = 600;

// ─── Zoom constraints ──────────────────────────────────────────────────────
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 3.0;

// ─── Color helpers ─────────────────────────────────────────────────────────
export function h2r(hex: string): [number, number, number] {
	if (!hex) return [0, 0, 0];
	let s = hex.replace("#", "");
	if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
	else if (s.length === 8) s = s.slice(0, 6);
	const n = parseInt(s, 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function lighten(hex: string, amt: number) {
	const [r, g, b] = h2r(hex);
	return `rgb(${Math.min(255, r + amt)},${Math.min(255, g + amt)},${Math.min(255, b + amt)})`;
}
export function darken(hex: string, amt: number) {
	const [r, g, b] = h2r(hex);
	return `rgb(${Math.max(0, r - amt)},${Math.max(0, g - amt)},${Math.max(0, b - amt)})`;
}
export function rgba(hex: string, a: number) {
	const [r, g, b] = h2r(hex);
	return `rgba(${r},${g},${b},${a})`;
}
export function strHash(s: string): number {
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
	return h;
}
export function tileNoise(x: number, y: number): number {
	return Math.abs(Math.sin(x * 127.1 + y * 311.7) * 43758.5453) % 1;
}

// ─── HiDPI ─────────────────────────────────────────────────────────────────
/**
 * Device-pixel ratio the canvas backing store was allocated at.
 *
 * The backing store (`canvas.width/height`) is sized in DEVICE pixels so the
 * scene renders at native panel resolution, while every other coordinate in
 * the arena — world positions, pan offsets, hit tests, cull bounds — is in CSS
 * pixels. Deriving the ratio from the element itself keeps the two spaces
 * reconciled without threading a `dpr` prop through the whole renderer, and it
 * stays correct if the user drags the window to a display with a different
 * ratio. Falls back to 1 before layout, when clientWidth is still 0.
 */
export function getCanvasDpr(canvas: HTMLCanvasElement): number {
	const cssW = canvas.clientWidth;
	if (!cssW) return 1;
	const ratio = canvas.width / cssW;
	return ratio > 0 ? ratio : 1;
}

/** Canvas size in CSS pixels — the space all arena coordinates live in. */
export function getCanvasCssSize(canvas: HTMLCanvasElement): { w: number; h: number } {
	const dpr = getCanvasDpr(canvas);
	return { w: canvas.width / dpr, h: canvas.height / dpr };
}

// ─── Canvas typography scale ───────────────────────────────────────────────
/**
 * Four sizes, one stack. The arena previously carried 18 distinct font
 * declarations between 4.5px and 10px — below the ~9px legibility floor, so
 * labels were decoration rather than information, and no two panels agreed on
 * a size. These are the only sizes any arena draw routine should use.
 *
 * Sizes are in CSS pixels at zoom 1; the viewport transform scales them, and
 * the DPR transform renders them at native resolution.
 */
export const ARENA_FONT_STACK = "system-ui,-apple-system,'Segoe UI',sans-serif";
export const ARENA_FONT_MONO = "ui-monospace,SFMono-Regular,Menlo,monospace";

export const ARENA_TEXT_TITLE = 13;
export const ARENA_TEXT_BODY = 11;
export const ARENA_TEXT_LABEL = 10;
export const ARENA_TEXT_MICRO = 9;

/** Build a canvas font string from the scale. `weight` omitted = regular. */
export function arenaFont(size: number, weight?: "bold", mono = false): string {
	const stack = mono ? ARENA_FONT_MONO : ARENA_FONT_STACK;
	return weight ? `${weight} ${size}px ${stack}` : `${size}px ${stack}`;
}

// ─── Canvas rounded-rect helper ────────────────────────────────────────────
/**
 * Path a rounded rectangle. Degenerate-rect safe: transiently negative or
 * zero w/h (spawn/entrance tweens scale geometry from 0) never reach the
 * canvas arcTo calls — a negative radius throws IndexSizeError. When either
 * dimension is <= 0 the path is left empty (nothing to draw).
 */
export function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
	if (!(w > 0) || !(h > 0)) {
		ctx.beginPath();
		return;
	}
	r = Math.max(0, Math.min(r, Math.floor(w / 2), Math.floor(h / 2)));
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + w - r, y);
	ctx.arcTo(x + w, y, x + w, y + r, r);
	ctx.lineTo(x + w, y + h - r);
	ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
	ctx.lineTo(x + r, y + h);
	ctx.arcTo(x, y + h, x, y + h - r, r);
	ctx.lineTo(x, y + r);
	ctx.arcTo(x, y, x + r, y, r);
	ctx.closePath();
}

// ─── Geometric containment ─────────────────────────────────────────────────
/**
 * Point-in-rect test — the single source for geometric membership used by
 * the zone stats strip and the aggregate overlay (inclusive bounds, so a
 * point exactly on an edge belongs to the rect, matching the historical
 * inline copies exactly).
 */
export function pointInRect(x: number, y: number, rect: { x: number; y: number; w: number; h: number }): boolean {
	return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

// ─── Blocked reason visual helpers ──────────────────────────────────────────
export const BLOCKED_REASON_COLORS: Record<string, string> = {
	dependency: "#F59E0B",
	"rate-limit": "#F97316",
	human: "#3B82F6",
	conflict: "#EF4444",
	token: "#A855F7",
	memory: "#EC4899",
	tool: "#6B7280"
};

export const BLOCKED_REASON_ICONS: Record<string, string> = {
	dependency: "🔗",
	"rate-limit": "⏱",
	human: "👤",
	conflict: "🔀",
	token: "💰",
	memory: "🧠",
	tool: "⚙"
};

// ─── Agent styling tables ──────────────────────────────────────────────────
export const HAIR_COLORS = [
	"#1a0a00",
	"#2d1a00",
	"#0f0f0f",
	"#4a2d00",
	"#8B4513",
	"#d4a800",
	"#c0392b",
	"#7b2d8b",
	"#1a3a5c",
	"#2d4a1a"
];
export const SKIN_TONES = ["#f5c89a", "#e8a870", "#d4875a", "#c06840", "#8B5e3c", "#6b3d28"];
export const PANT_COLORS = ["#1e3a5f", "#2d4a1a", "#3d2a1a", "#2a1a3d", "#1a3d3d", "#3d1a2a", "#2a2a3d"];

export const HELPER_SHIRT_COLORS: Record<HelperVariant, string> = {
	male_nurse: "#1e6e9e",
	female_nurse: "#2d8e6e",
	staff1: "#5a3e8a",
	staff2: "#8a5a3e"
};
export const HELPER_HAIR: Record<HelperVariant, string> = {
	male_nurse: "#1a0a00",
	female_nurse: "#4a2d00",
	staff1: "#0f0f0f",
	staff2: "#2d1a00"
};
export const HELPER_SKIN: Record<HelperVariant, string> = {
	male_nurse: "#e8a870",
	female_nurse: "#f5c89a",
	staff1: "#d4875a",
	staff2: "#c06840"
};

// ─── Wander state ──────────────────────────────────────────────────────────
export interface WanderState {
	nextPickAt: number;
}

// ─── Render context ─────────────────────────────────────────────────────────
export interface RenderCtx {
	ctx: CanvasRenderingContext2D;
	canvasW: number;
	canvasH: number;
	isDark: boolean;
	ts: number;
	zoom: number;
	panX: number;
	panY: number;
	lod: LODLevel;
	hoveredId: string | null;
	reducedMotion: boolean;
	reducedTransparency: boolean;
}

export function makeCtx(
	ctx: CanvasRenderingContext2D,
	canvasW: number,
	canvasH: number,
	isDark: boolean,
	ts: number,
	zoom: number,
	panX: number,
	panY: number,
	lod: LODLevel,
	hoveredId: string | null,
	reducedMotion: boolean,
	reducedTransparency: boolean
): RenderCtx {
	return { ctx, canvasW, canvasH, isDark, ts, zoom, panX, panY, lod, hoveredId, reducedMotion, reducedTransparency };
}

// ─── Filter helpers ─────────────────────────────────────────────────────────
export function matchesAgentFilter(
	agent: { role: string; repos: string[]; name: string; claimedTaskIds: string[] },
	filter: FilterState,
	tasks?: Map<string, { title: string; taskCode: string }> | null
): boolean {
	if (filter.roles.length > 0 && !filter.roles.includes(agent.role)) return false;
	if (filter.repository && !agent.repos.includes(filter.repository)) return false;
	if (filter.search) {
		const q = filter.search.toLowerCase();
		if (!agent.name.toLowerCase().includes(q)) {
			if (!tasks) return false;
			const taskMatch = agent.claimedTaskIds.some((tid) => {
				const t = tasks.get(tid);
				return t && (t.title.toLowerCase().includes(q) || t.taskCode.toLowerCase().includes(q));
			});
			if (!taskMatch) return false;
		}
	}
	return true;
}

export function matchesTaskFilter(
	task: {
		repo: string;
		priorityLevel: string;
		status: string;
		title: string;
		taskCode: string;
		claimedByAgentId: string | null;
	},
	filter: FilterState,
	agents?: Map<string, { role: string }> | null
): boolean {
	if (filter.repository && task.repo !== filter.repository) return false;
	if (filter.priorities.length > 0 && !filter.priorities.includes(task.priorityLevel)) return false;
	if (filter.statuses.length > 0 && !filter.statuses.includes(task.status)) return false;
	if (filter.search) {
		const q = filter.search.toLowerCase();
		if (!task.title.toLowerCase().includes(q) && !task.taskCode.toLowerCase().includes(q)) return false;
	}
	if (filter.roles.length > 0 && task.claimedByAgentId) {
		const agent = agents?.get(task.claimedByAgentId);
		if (agent && !filter.roles.includes(agent.role)) return false;
	}
	return true;
}

export function isFilterActive(filter: FilterState): boolean {
	return (
		filter.repository !== null ||
		filter.roles.length > 0 ||
		filter.priorities.length > 0 ||
		filter.statuses.length > 0 ||
		filter.search !== ""
	);
}

/**
 * Content comparison for FilterState. The filter object is mutated IN PLACE
 * by the arena state manager (arenaStateManager.ts Object.assign) and its
 * arrays can be replaced or spliced — a reference comparison would miss every
 * change (TASK-409).
 */
export function filterEquals(a: FilterState, b: FilterState): boolean {
	return (
		a.repository === b.repository &&
		a.search === b.search &&
		a.roles.length === b.roles.length &&
		a.roles.every((v, i) => v === b.roles[i]) &&
		a.priorities.length === b.priorities.length &&
		a.priorities.every((v, i) => v === b.priorities[i]) &&
		a.statuses.length === b.statuses.length &&
		a.statuses.every((v, i) => v === b.statuses[i])
	);
}

/**
 * Cheap O(n) content digest of a scene — entity counts + per-entity visual
 * state (positions rounded to px, status, action, speech bubble). Used by the
 * renderer to detect REAL scene changes across polls without allocating a
 * comparison structure. Each contributing string mixes its LENGTH + first +
 * last + middle chars + a full-string FNV-1a rolling hash, so distinct
 * same-length strings sharing a first char (e.g. ids "agent-1"/"agent-2")
 * can no longer collide per field — the old length+first-char-only mix made
 * those deterministic collisions, which a change detector can't afford for
 * the "changed" side (a missed change = a stale render). Remaining collisions
 * are genuine 32-bit hash collisions only (~2^-32 per field pair): a false
 * "changed" costs one extra render, never a missed one. Integer ops only, no
 * allocation — cheap enough per poll.
 */
export function sceneSignature(scene: ArenaScene): string {
	let h = 0;
	const mix = (v: string | number) => {
		if (typeof v === "number") {
			h = (h * 31 + v) | 0;
			return;
		}
		const len = v.length;
		h = (h * 31 + len) | 0;
		h = (h * 31 + (v.charCodeAt(0) || 0)) | 0;
		h = (h * 31 + (v.charCodeAt(len - 1) || 0)) | 0;
		if (len > 2) h = (h * 31 + (v.charCodeAt(len >> 1) || 0)) | 0;
		// FNV-1a over the whole string — the full content, so any two
		// different strings differ in the digest regardless of the sampled
		// chars above (shared prefixes, flipped middles, same-length diffs).
		let roll = 0x811c9dc5;
		for (let i = 0; i < len; i++) {
			roll ^= v.charCodeAt(i);
			roll = Math.imul(roll, 0x01000193);
		}
		h = (h * 31 + roll) | 0;
	};
	mix(scene.agents.size);
	mix(scene.tasks.size);
	mix(scene.handoffs.length);
	mix(scene.repositories.size);
	for (const a of scene.agents.values()) {
		mix(a.id);
		mix(Math.round(a.x));
		mix(Math.round(a.y));
		mix(Math.round(a.targetX));
		mix(Math.round(a.targetY));
		mix(a.state);
		mix(a.currentAction);
		mix(a.health);
		mix(a.speechBubble ?? "");
	}
	for (const t of scene.tasks.values()) {
		mix(t.id);
		mix(Math.round(t.x));
		mix(Math.round(t.y));
		mix(t.status);
		mix(t.progress);
		mix(t.priorityLevel);
	}
	for (const hp of scene.handoffs) mix(hp.id ?? "");
	for (const r of scene.repositories.values()) mix(r.id);
	return String(h);
}
