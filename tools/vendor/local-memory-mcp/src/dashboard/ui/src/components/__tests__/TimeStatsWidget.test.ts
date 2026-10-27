// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import TimeStatsWidget from "../TimeStatsWidget.svelte";

// Mock chart.js exports so canvas-dependent logic does not fail in jsdom
vi.mock("chart.js", () => ({
	Chart: class MockChart {
		static register = vi.fn();
		destroy = vi.fn();
		update = vi.fn();
	},
	BarController: vi.fn(),
	BarElement: vi.fn(),
	CategoryScale: vi.fn(),
	LinearScale: vi.fn(),
	Tooltip: vi.fn(),
	Legend: vi.fn(),
	registerables: []
}));

describe("TimeStatsWidget", () => {
	it("exports a valid Svelte component", () => {
		expect(TimeStatsWidget).toBeDefined();
		expect(typeof TimeStatsWidget).toBe("function");
	});

	it("renders a period selector with role='tablist' and accessible name", () => {
		const target = document.createElement("div");
		const component = mount(TimeStatsWidget, { target });

		const tablist = target.querySelector('[role="tablist"]');
		expect(tablist).not.toBeNull();
		expect(tablist?.getAttribute("aria-label")).toBe("Time performance periods");

		const tabs = target.querySelectorAll('[role="tab"]');
		expect(tabs.length).toBe(4);

		const tabLabels = Array.from(tabs).map((t) => t.textContent?.trim());
		expect(tabLabels).toEqual(["Today", "This Week", "This Month", "Overall"]);

		// Default active tab is "daily" ("Today")
		const todayTab = tabs[0];
		expect(todayTab.getAttribute("aria-selected")).toBe("true");
		expect(todayTab.getAttribute("tabindex")).toBe("0");

		// Non-active tabs have aria-selected="false" and tabindex="-1"
		for (let i = 1; i < tabs.length; i++) {
			expect(tabs[i].getAttribute("aria-selected")).toBe("false");
			expect(tabs[i].getAttribute("tabindex")).toBe("-1");
		}

		unmount(component);
	});

	it("updates aria-selected and roving tabindex on tab click", () => {
		const target = document.createElement("div");
		const component = mount(TimeStatsWidget, { target });

		const tabs = target.querySelectorAll<HTMLButtonElement>('[role="tab"]');
		const weekTab = tabs[1];

		weekTab.click();
		flushSync();

		expect(weekTab.getAttribute("aria-selected")).toBe("true");
		expect(weekTab.getAttribute("tabindex")).toBe("0");

		expect(tabs[0].getAttribute("aria-selected")).toBe("false");
		expect(tabs[0].getAttribute("tabindex")).toBe("-1");

		unmount(component);
	});
});
