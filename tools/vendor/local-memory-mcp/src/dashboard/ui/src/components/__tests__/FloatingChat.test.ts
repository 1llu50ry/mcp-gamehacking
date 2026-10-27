// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount, unmount } from "svelte";
import FloatingChat from "../FloatingChat.svelte";

vi.mock("../../lib/stores", () => ({
	// Non-arena tab so the FAB is visible (TASK-273 hides it on the Arena tab).
	activeTab: {
		subscribe: (fn: any) => {
			fn("dashboard");
			return () => {};
		}
	},
	currentRepo: {
		subscribe: (fn: any) => {
			fn("test/repo");
			return () => {};
		}
	},
	recentActions: {
		set: vi.fn(),
		subscribe: (fn: any) => {
			fn([]);
			return () => {};
		}
	},
	recentActionsPage: {
		set: vi.fn(),
		subscribe: (fn: any) => {
			fn(1);
			return () => {};
		}
	},
	recentActionsTotalItems: {
		subscribe: (fn: any) => {
			fn(0);
			return () => {};
		}
	}
}));

vi.mock("../../lib/api", () => ({ api: {} }));

vi.mock("../ChatHeader.svelte", () => ({ default: () => ({}) }));
vi.mock("../ChatMessage.svelte", () => ({ default: () => ({}) }));
vi.mock("../ChatInput.svelte", () => ({ default: () => ({}) }));

vi.mock("../../lib/composables/useRecentActions", () => ({
	createRecentActionsHandler: () => ({
		groupedActions: {
			subscribe: (fn: any) => {
				fn([]);
				return () => {};
			}
		},
		recentActions: {
			subscribe: (fn: any) => {
				fn([]);
				return () => {};
			}
		},
		recentActionsPage: {
			subscribe: (fn: any) => {
				fn(1);
				return () => {};
			}
		},
		isLoadingMore: false,
		scrollToBottom: () => {},
		getLabel: () => ({ main: "" }),
		getConfig: () => ({ icon: "", label: "", color: "", bgAlpha: 0 }),
		parseResponse: () => ({ text: "", isLong: false }),
		toggleExpand: () => {},
		expandedResponses: { has: () => false }
	})
}));

vi.mock("../../lib/utils", () => ({ createChatTask: vi.fn() }));
vi.mock("../../lib/chatUtils", () => ({
	loadPage: vi.fn(),
	sendChatMessage: vi.fn()
}));
vi.mock("../../lib/Icon.svelte", () => ({ default: () => ({}) }));

describe("FloatingChat", () => {
	it("exports a valid Svelte component", () => {
		expect(FloatingChat).toBeDefined();
		expect(typeof FloatingChat).toBe("function");
	});

	it("renders without error", () => {
		const target = document.createElement("div");
		const component = mount(FloatingChat, { target });
		expect(target.querySelector(".chat-fab")).not.toBeNull();
		unmount(component);
	});
});
