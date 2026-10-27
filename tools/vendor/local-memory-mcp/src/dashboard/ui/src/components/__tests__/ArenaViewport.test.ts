// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, unmount } from "svelte";
import type { ComponentProps } from "svelte";
import ArenaViewport from "../ArenaViewport.svelte";
import type { ArenaScene } from "../../lib/arena/arenaTypes";

// Mutable store fixture — vi.hoisted so both the mock factory (hoisted to the
// top of the file) and the tests can reference it (vitest hoisting rule).
const { mockStoreState, mockSetZoom, mockSetPan, mockResetView } = vi.hoisted(() => ({
	mockStoreState: {
		ui: {
			selectedEntityId: null,
			selectedEntityType: null,
			zoom: 1.0,
			panX: 0,
			panY: 0,
			hoveredEntityId: null,
			activeFilter: {
				repository: null,
				roles: [],
				priorities: [],
				statuses: [],
				search: ""
			},
			timelineVisible: false,
			sidePanelVisible: false,
			sidePanelView: "agent",
			eventLog: [],
			paused: false
		}
	},
	mockSetZoom: vi.fn(),
	mockSetPan: vi.fn(),
	mockResetView: vi.fn()
}));

// Mock the singleton arenaStateManager (same pattern as TopBar/FilterBar tests).
vi.mock("../../lib/arena/arenaStateManager", () => ({
	arenaStateManager: {
		getStore: () => ({
			subscribe: (fn: (state: unknown) => void) => {
				fn(mockStoreState);
				return () => {};
			}
		}),
		setZoom: mockSetZoom,
		setPan: mockSetPan,
		resetView: mockResetView
	}
}));

// Sub-components are stubbed: the canvas child spins up a real ArenaRenderer
// (rAF + ResizeObserver + canvas 2d context), which is not available
// deterministically in jsdom. ArenaViewportControls stays real so the zoom
// percentage truly reflects the mocked store.
vi.mock("../ArenaViewportCanvas.svelte", () => ({ default: () => ({}) }));
vi.mock("../ArenaViewportInteraction.svelte", () => ({ default: () => ({}) }));
vi.mock("../ArenaMinimap.svelte", () => ({ default: () => ({}) }));
vi.mock("../HoverTooltip.svelte", () => ({ default: () => ({}) }));
vi.mock("../../lib/Icon.svelte", () => ({ default: () => ({}) }));

type ViewportProps = ComponentProps<typeof ArenaViewport>;

function makeScene(agentCount: number): ArenaScene {
	return {
		agents: new Map(Array.from({ length: agentCount }, (_, i) => [String(i), { id: String(i) }])),
		tasks: new Map(),
		handoffs: [],
		repositories: new Map()
	} as unknown as ArenaScene;
}

function mountViewport(props: ViewportProps = {}) {
	const target = document.createElement("div");
	const component = mount(ArenaViewport, { target, props });
	return { target, component };
}

describe("ArenaViewport", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockStoreState.ui.zoom = 1.0;
		mockStoreState.ui.panX = 0;
		mockStoreState.ui.panY = 0;
	});

	it("exports a valid Svelte component", () => {
		expect(ArenaViewport).toBeDefined();
		expect(typeof ArenaViewport).toBe("function");
	});

	it("mounts with scene + layout props without error", () => {
		const { target, component } = mountViewport({
			scene: makeScene(2),
			loading: false,
			isDark: true,
			reducedMotion: true
		});
		expect(target.querySelector(".arena-wrap")).not.toBeNull();
		expect(target.querySelector(".zoom-controls")).not.toBeNull();
		unmount(component);
	});

	it("zoom control reflects the store zoom", () => {
		mockStoreState.ui.zoom = 1.5;
		let { target, component } = mountViewport({ scene: makeScene(1) });
		expect(target.querySelector(".zoom-pct")?.textContent).toBe("150%");
		unmount(component);

		mockStoreState.ui.zoom = 0.75;
		({ target, component } = mountViewport({ scene: makeScene(1) }));
		expect(target.querySelector(".zoom-pct")?.textContent).toBe("75%");
		unmount(component);
	});

	it("renders the empty state only when no agents are active", () => {
		let { target, component } = mountViewport({ scene: makeScene(0), loading: false });
		expect(target.querySelector(".arena-empty")).not.toBeNull();
		expect(target.textContent).toContain("No active agents");
		unmount(component);

		({ target, component } = mountViewport({ scene: makeScene(2), loading: false }));
		expect(target.querySelector(".arena-empty")).toBeNull();
		unmount(component);
	});

	it("wires the zoom controls to the arena store", () => {
		const { target, component } = mountViewport({ scene: makeScene(1) });

		const zoomIn = target.querySelector('[aria-label="Zoom in"]');
		const zoomOut = target.querySelector('[aria-label="Zoom out"]');
		const reset = target.querySelector('[aria-label="Reset view"]');
		expect(zoomIn).not.toBeNull();
		expect(zoomOut).not.toBeNull();
		expect(reset).not.toBeNull();

		(zoomIn as HTMLButtonElement).click();
		expect(mockSetZoom).toHaveBeenCalledWith(1.15);

		mockSetZoom.mockClear();
		(zoomOut as HTMLButtonElement).click();
		expect(mockSetZoom).toHaveBeenCalledWith(0.85);

		(reset as HTMLButtonElement).click();
		expect(mockResetView).toHaveBeenCalledTimes(1);
		unmount(component);
	});
});
