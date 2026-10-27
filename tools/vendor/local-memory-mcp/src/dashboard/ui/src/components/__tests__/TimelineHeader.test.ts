// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount, unmount } from "svelte";
import TimelineHeader from "../TimelineHeader.svelte";

vi.mock("../../lib/Icon.svelte", () => ({
	default: () => ({})
}));

describe("TimelineHeader", () => {
	it("exports a valid Svelte component", () => {
		expect(TimelineHeader).toBeDefined();
		expect(typeof TimelineHeader).toBe("function");
	});

	it("renders filter tabs with role='tablist' and accessible name when expanded", () => {
		const target = document.createElement("div");
		const component = mount(TimelineHeader, {
			target,
			props: {
				expanded: true,
				activeFilter: "all",
				eventCount: 5
			}
		});

		const tablist = target.querySelector('[role="tablist"]');
		expect(tablist).not.toBeNull();
		expect(tablist?.getAttribute("aria-label")).toBe("Event log filters");

		const tabs = target.querySelectorAll('[role="tab"]');
		expect(tabs.length).toBe(4);

		const allTab = tabs[0];
		expect(allTab.getAttribute("aria-selected")).toBe("true");
		expect(allTab.getAttribute("tabindex")).toBe("0");

		const errorsTab = tabs[1];
		expect(errorsTab.getAttribute("aria-selected")).toBe("false");
		expect(errorsTab.getAttribute("tabindex")).toBe("-1");

		unmount(component);
	});
});
