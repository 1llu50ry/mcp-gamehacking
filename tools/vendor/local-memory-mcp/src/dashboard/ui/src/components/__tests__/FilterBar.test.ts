// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount, unmount } from "svelte";
import FilterBar from "../FilterBar.svelte";

// Mock the singleton arenaStateManager
vi.mock("../../lib/arena/arenaStateManager", () => ({
	arenaStateManager: {
		getStore: () => ({
			subscribe: (fn: any) => {
				fn({
					ui: {
						activeFilter: {
							repository: null,
							roles: [],
							priorities: [],
							statuses: [],
							search: ""
						}
					}
				});
				return () => {};
			}
		}),
		setFilter: vi.fn()
	}
}));

// Mock sub-component — must be a callable function for Svelte 5
vi.mock("../FilterMenu.svelte", () => ({
	default: () => ({})
}));

// Mock Icon — must be a callable function for Svelte 5
vi.mock("../../lib/Icon.svelte", () => ({
	default: () => ({})
}));

// Mock filterBarUtils
vi.mock("../../lib/filterBarUtils", () => ({
	computeActiveCount: () => 0
}));

describe("FilterBar", () => {
	it("exports a valid Svelte component", () => {
		expect(FilterBar).toBeDefined();
		expect(typeof FilterBar).toBe("function");
	});

	it("renders without error", () => {
		const target = document.createElement("div");
		const component = mount(FilterBar, { target });
		expect(target.querySelector(".filter-bar-root")).not.toBeNull();
		expect(target.querySelector(".filter-toggle")).not.toBeNull();
		unmount(component);
	});
});
