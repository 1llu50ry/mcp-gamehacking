// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount, unmount } from "svelte";
import CodebaseSearchBar from "../CodebaseSearchBar.svelte";

// Mock the API module to prevent actual network calls
vi.mock("../../lib/api", () => ({
	api: {
		codebaseSearch: vi.fn().mockResolvedValue({ results: [] })
	}
}));

describe("CodebaseSearchBar", () => {
	it("exports a valid Svelte component", () => {
		expect(CodebaseSearchBar).toBeDefined();
		expect(typeof CodebaseSearchBar).toBe("function");
	});

	it("renders without error", () => {
		const target = document.createElement("div");
		const component = mount(CodebaseSearchBar, {
			target,
			props: { repo: "", onSymbolSelect: () => {} }
		});
		expect(target.querySelector(".search-bar-container")).not.toBeNull();
		expect(target.querySelector(".search-input")).not.toBeNull();
		unmount(component);
	});
});
