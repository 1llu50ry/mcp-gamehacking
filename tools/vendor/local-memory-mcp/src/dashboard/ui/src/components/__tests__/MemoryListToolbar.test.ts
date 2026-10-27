// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import MemoryListToolbar from "../MemoryListToolbar.svelte";
import { memoriesSearch, memoriesTypeFilter, memoriesImportanceMin, memoriesPageSize } from "../../lib/stores";

// Mock Icon — must be a callable function for Svelte 5
vi.mock("../../lib/Icon.svelte", () => ({
	default: () => ({})
}));

// Mock ExportToolbar
vi.mock("../ExportToolbar.svelte", () => ({
	default: () => ({})
}));

describe("MemoryListToolbar", () => {
	beforeEach(() => {
		memoriesSearch.set("");
		memoriesTypeFilter.set("");
		memoriesImportanceMin.set(null);
		memoriesPageSize.set(25);
	});

	it("exports a valid Svelte component", () => {
		expect(MemoryListToolbar).toBeDefined();
		expect(typeof MemoryListToolbar).toBe("function");
	});

	it("renders search input and filter selects with filter-select class", () => {
		const target = document.createElement("div");
		const component = mount(MemoryListToolbar, {
			target,
			props: {}
		});

		expect(target.querySelector(".search-field")).not.toBeNull();
		expect(target.querySelector(".search-input")).not.toBeNull();

		const filterSelects = target.querySelectorAll("select.filter-select");
		expect(filterSelects.length).toBe(3);

		// Badge and clear-all should not be present initially
		expect(target.querySelector(".filter-status")).toBeNull();

		unmount(component);
	});

	it("renders active filter count badge and clear button when filter is changed", () => {
		memoriesTypeFilter.set("decision");

		const target = document.createElement("div");
		const component = mount(MemoryListToolbar, {
			target,
			props: {}
		});

		const statusEl = target.querySelector(".filter-status");
		expect(statusEl).not.toBeNull();
		expect(target.querySelector(".filter-count")?.textContent?.trim()).toBe("1");
		expect(target.querySelector(".clear-btn")).not.toBeNull();

		unmount(component);
	});

	it("resets filters when clear button is clicked", () => {
		memoriesTypeFilter.set("decision");
		memoriesImportanceMin.set(3);

		const target = document.createElement("div");
		const onClear = vi.fn();
		const onFilterChange = vi.fn();

		const component = mount(MemoryListToolbar, {
			target,
			props: {
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
		expect(target.querySelector(".filter-status")).toBeNull();

		unmount(component);
	});
});
