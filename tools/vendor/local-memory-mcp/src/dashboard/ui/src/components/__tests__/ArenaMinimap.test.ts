// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, unmount, tick } from "svelte";
import type { ComponentProps } from "svelte";
import ArenaMinimap from "../ArenaMinimap.svelte";
import type { ArenaRenderer } from "../../lib/arena/arenaRenderer";
import type { ArenaLayoutConfig, ArenaScene } from "../../lib/arena/arenaTypes";

const { mockSetPan } = vi.hoisted(() => ({ mockSetPan: vi.fn() }));

vi.mock("../../lib/arena/arenaStateManager", () => ({
	arenaStateManager: { setPan: mockSetPan }
}));

const LAYOUT: ArenaLayoutConfig = { canvasWidth: 1280, canvasHeight: 800 };

/** Stubbed renderer.getZones() → the 5 manager zone rects (registry colors). */
const ZONES = [
	{ id: "backlog", label: "Backlog", x: 0, y: 0, w: 320, h: 200, color: "#8b5cf6" },
	{ id: "pending", label: "Pending", x: 320, y: 0, w: 320, h: 200, color: "#f59e0b" },
	{ id: "in_progress", label: "In Progress", x: 640, y: 0, w: 640, h: 400, color: "#3b82f6" },
	{ id: "blocked", label: "Blocked", x: 0, y: 200, w: 320, h: 200, color: "#ef4444" },
	{ id: "recovery", label: "Recovery Center", x: 320, y: 200, w: 320, h: 200, color: "#14b8a6" }
];

const VIEWPORT_INFO = { zoom: 1, panX: 0, panY: 0, canvasW: 960, canvasH: 520 };

/** minimap scale = min(160 / 1280, 100 / 800) = 0.125 (exact in float). */
const SCALE = 0.125;

// Record fillStyle/strokeStyle assignments so tests can prove colors come
// from the zone objects (no local hardcoded color map).
interface CtxStub {
	fillStyle: string;
	strokeStyle: string;
	lineWidth: number;
	fillRect: ReturnType<typeof vi.fn>;
	strokeRect: ReturnType<typeof vi.fn>;
	beginPath: ReturnType<typeof vi.fn>;
	arc: ReturnType<typeof vi.fn>;
	fill: ReturnType<typeof vi.fn>;
	stroke: ReturnType<typeof vi.fn>;
	fillHistory: string[];
	strokeHistory: string[];
}

function createCtxStub(): CtxStub {
	const fillHistory: string[] = [];
	const strokeHistory: string[] = [];
	let fillStyle = "";
	let strokeStyle = "";
	return {
		get fillStyle(): string {
			return fillStyle;
		},
		set fillStyle(v: string) {
			fillStyle = v;
			fillHistory.push(v);
		},
		get strokeStyle(): string {
			return strokeStyle;
		},
		set strokeStyle(v: string) {
			strokeStyle = v;
			strokeHistory.push(v);
		},
		lineWidth: 0,
		fillRect: vi.fn(),
		strokeRect: vi.fn(),
		beginPath: vi.fn(),
		arc: vi.fn(),
		fill: vi.fn(),
		stroke: vi.fn(),
		fillHistory,
		strokeHistory
	};
}

function makeRendererStub(): ArenaRenderer {
	return {
		getZones: vi.fn(() => ZONES),
		getViewportInfo: vi.fn(() => VIEWPORT_INFO)
	} as unknown as ArenaRenderer;
}

function makeScene(): ArenaScene {
	return {
		agents: new Map([["a1", { id: "a1", x: 100, y: 100, color: "#06b6d4" }]]),
		tasks: new Map([["t1", { id: "t1", x: 200, y: 150, status: "in_progress" }]]),
		handoffs: [],
		repositories: new Map()
	} as unknown as ArenaScene;
}

type MinimapProps = ComponentProps<typeof ArenaMinimap>;

describe("ArenaMinimap", () => {
	let ctx2d: CtxStub;

	beforeEach(() => {
		vi.clearAllMocks();
		ctx2d = createCtxStub();
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx2d as unknown as CanvasRenderingContext2D);
	});

	async function mountMinimap(props: MinimapProps = {}) {
		const target = document.createElement("div");
		const component = mount(ArenaMinimap, { target, props });
		await tick(); // flush the draw $effect
		return { target, component };
	}

	it("exports a valid Svelte component", () => {
		expect(ArenaMinimap).toBeDefined();
		expect(typeof ArenaMinimap).toBe("function");
	});

	it("lays out the minimap canvas without throwing (5 stubbed zones)", async () => {
		const renderer = makeRendererStub();
		const { target, component } = await mountMinimap({
			renderer,
			layout: LAYOUT,
			scene: makeScene(),
			isDark: false,
			currentZoom: 1
		});

		expect(target.querySelector(".minimap-wrap")).not.toBeNull();
		const canvas = target.querySelector("canvas.minimap-canvas");
		expect(canvas).not.toBeNull();
		expect((canvas as HTMLCanvasElement).width).toBe(160);
		expect((canvas as HTMLCanvasElement).height).toBe(100);

		expect(renderer.getZones).toHaveBeenCalled();
		unmount(component);
	});

	it("maps the 5 zone rects to minimized positions inside the canvas", async () => {
		const renderer = makeRendererStub();
		const { component } = await mountMinimap({
			renderer,
			layout: LAYOUT,
			scene: makeScene(),
			currentZoom: 1
		});

		for (const z of ZONES) {
			expect(ctx2d.fillRect).toHaveBeenCalledWith(z.x * SCALE, z.y * SCALE, z.w * SCALE, z.h * SCALE);
			const x = z.x * SCALE;
			const y = z.y * SCALE;
			const w = z.w * SCALE;
			const h = z.h * SCALE;
			expect(x).toBeGreaterThanOrEqual(0);
			expect(y).toBeGreaterThanOrEqual(0);
			expect(x + w).toBeLessThanOrEqual(160);
			expect(y + h).toBeLessThanOrEqual(100);
		}
		unmount(component);
	});

	it("colors come from the zone objects — no local hardcoded color map", async () => {
		const renderer = makeRendererStub();
		const { component } = await mountMinimap({
			renderer,
			layout: LAYOUT,
			scene: makeScene(),
			isDark: true,
			currentZoom: 1
		});

		// Every zone is drawn with its own color + alpha suffix (dark mode).
		for (const z of ZONES) {
			expect(ctx2d.fillHistory).toContain(`${z.color}44`);
			expect(ctx2d.strokeHistory).toContain(`${z.color}88`);
		}
		// Task dot tinted by its zone color (STATUS_TO_ZONE → zone object).
		expect(ctx2d.fillHistory).toContain("#3b82f6");
		// Agent dot uses the agent's own color.
		expect(ctx2d.fillHistory).toContain("#06b6d4");
		unmount(component);
	});

	it("does not throw with an empty scene", async () => {
		const renderer = makeRendererStub();
		const emptyScene = {
			agents: new Map(),
			tasks: new Map(),
			handoffs: [],
			repositories: new Map()
		} as unknown as ArenaScene;
		const { target, component } = await mountMinimap({
			renderer,
			layout: LAYOUT,
			scene: emptyScene,
			currentZoom: 1
		});

		expect(target.querySelector("canvas.minimap-canvas")).not.toBeNull();
		expect(renderer.getZones).toHaveBeenCalled();
		unmount(component);
	});

	it("navigates via mousedown → arenaStateManager.setPan", async () => {
		const renderer = makeRendererStub();
		const { target, component } = await mountMinimap({
			renderer,
			layout: LAYOUT,
			scene: makeScene(),
			currentZoom: 1
		});

		const canvas = target.querySelector("canvas.minimap-canvas") as HTMLCanvasElement;
		canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 0, bubbles: true }));

		// worldX/Y = 0 → pan centers the viewport: canvasW/2 - 0*zoom.
		expect(mockSetPan).toHaveBeenCalledWith(VIEWPORT_INFO.canvasW / 2, VIEWPORT_INFO.canvasH / 2);
		unmount(component);
	});
});
