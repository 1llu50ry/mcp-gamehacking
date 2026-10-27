// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount, unmount } from "svelte";
import TopBar from "../TopBar.svelte";

// Mock store dependencies — use relative paths from __tests__/ dir
vi.mock("../../lib/stores", () => ({
	healthData: {
		subscribe: (fn: any) => {
			fn(null);
			return () => {};
		}
	},
	currentRepo: {
		subscribe: (fn: any) => {
			fn("");
			return () => {};
		}
	},
	availableRepos: {
		subscribe: (fn: any) => {
			fn([]);
			return () => {};
		}
	},
	theme: {
		subscribe: (fn: any) => {
			fn("light");
			return () => {};
		}
	},
	themePreference: {
		subscribe: (fn: any) => {
			fn("system");
			return () => {};
		}
	},
	chatRefreshSignal: {
		subscribe: (fn: any) => {
			fn(0);
			return () => {};
		}
	},
	activeTab: {
		subscribe: (fn: any) => {
			fn("dashboard");
			return () => {};
		}
	},
	derived: (_fn: any) => ({
		subscribe: (fn2: any) => {
			fn2(null);
			return () => {};
		}
	})
}));

// Mock sub-components — must be callable for Svelte 5
vi.mock("../TopBarRepoInfo.svelte", () => ({ default: () => ({}) }));
vi.mock("../TopBarLinks.svelte", () => ({ default: () => ({}) }));
vi.mock("../TopBarActions.svelte", () => ({ default: () => ({}) }));

// Mock composer
vi.mock("../../lib/composables/useTopBar", () => ({
	createTopBarHandler: () => ({
		countdownSeconds: {
			subscribe: (fn: any) => {
				fn(30);
				return () => {};
			}
		},
		refreshing: {
			subscribe: (fn: any) => {
				fn(false);
				return () => {};
			}
		},
		npmDownloads: {
			subscribe: (fn: any) => {
				fn(null);
				return () => {};
			}
		},
		npmLoading: {
			subscribe: (fn: any) => {
				fn(false);
				return () => {};
			}
		},
		formatDownloads: (_n: any) => "0",
		toggleTheme: () => {},
		startCountdown: () => {},
		manualRefresh: () => {},
		getRepoInitials: () => "",
		destroy: () => {}
	})
}));

// Mock arenaStateManager
vi.mock("../../lib/arena/arenaStateManager", () => ({
	arenaStateManager: {
		getStore: () => ({
			subscribe: (fn: any) => {
				fn({ metrics: { successRate: 0, throughput: 0 } });
				return () => {};
			}
		})
	}
}));

describe("TopBar", () => {
	it("exports a valid Svelte component", () => {
		expect(TopBar).toBeDefined();
		expect(typeof TopBar).toBe("function");
	});

	it("renders without error", () => {
		const target = document.createElement("div");
		const component = mount(TopBar, { target });
		expect(target.querySelector(".top-bar")).not.toBeNull();
		unmount(component);
	});
});
