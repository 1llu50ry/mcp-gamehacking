// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import StandardSearchBar from "../StandardSearchBar.svelte";

// Mock Icon — must be a callable function for Svelte 5
vi.mock("../../lib/Icon.svelte", () => ({
	default: () => ({})
}));

describe("StandardSearchBar", () => {
	it("exports a valid Svelte component", () => {
		expect(StandardSearchBar).toBeDefined();
		expect(typeof StandardSearchBar).toBe("function");
	});

	it("renders search input, filter inputs, and scope select with filter-select class", () => {
		const target = document.createElement("div");
		const component = mount(StandardSearchBar, {
			target,
			props: {}
		});

		expect(target.querySelector(".search-field")).not.toBeNull();
		expect(target.querySelector(".search-input")).not.toBeNull();

		const filterInputs = target.querySelectorAll(".filter-input");
		expect(filterInputs.length).toBe(2);

		const scopeSelect = target.querySelector("select.filter-select");
		expect(scopeSelect).not.toBeNull();

		// Badge and clear-all should not be present when all filters are at default
		expect(target.querySelector(".filter-status")).toBeNull();
		expect(target.querySelector(".clear-btn")).toBeNull();

		unmount(component);
	});

	it("renders active filter count badge and clear button when filters are active", () => {
		const target = document.createElement("div");
		const component = mount(StandardSearchBar, {
			target,
			props: {
				language: "typescript",
				stack: "svelte",
				scope: "global"
			}
		});

		const statusEl = target.querySelector(".filter-status");
		expect(statusEl).not.toBeNull();

		const badgeEl = target.querySelector(".filter-badge");
		expect(badgeEl).not.toBeNull();
		expect(badgeEl?.getAttribute("aria-label")).toBe("3 active filters");

		const countEl = target.querySelector(".filter-count");
		expect(countEl?.textContent?.trim()).toBe("3");

		const clearBtn = target.querySelector(".clear-btn");
		expect(clearBtn).not.toBeNull();

		unmount(component);
	});

	it("displays singular '1 active filter' aria-label when count is 1", () => {
		const target = document.createElement("div");
		const component = mount(StandardSearchBar, {
			target,
			props: {
				language: "typescript"
			}
		});

		const badgeEl = target.querySelector(".filter-badge");
		expect(badgeEl).not.toBeNull();
		expect(badgeEl?.getAttribute("aria-label")).toBe("1 active filter");
		expect(target.querySelector(".filter-count")?.textContent?.trim()).toBe("1");

		unmount(component);
	});

	it("clicking clear-btn calls onClear and onFilterChange and resets filters", async () => {
		const target = document.createElement("div");
		const onClear = vi.fn();
		const onFilterChange = vi.fn();

		const component = mount(StandardSearchBar, {
			target,
			props: {
				language: "typescript",
				stack: "svelte",
				scope: "all",
				onClear,
				onFilterChange
			}
		});

		const clearBtn = target.querySelector(".clear-btn") as HTMLButtonElement;
		expect(clearBtn).not.toBeNull();

		clearBtn.click();
		flushSync();

		expect(onClear).toHaveBeenCalledTimes(1);
		expect(onFilterChange).toHaveBeenCalledTimes(1);

		// Badge and clear button should be gone now that filters are reset
		expect(target.querySelector(".filter-status")).toBeNull();

		unmount(component);
	});
});
