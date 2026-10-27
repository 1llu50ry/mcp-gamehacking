// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount, unmount } from "svelte";
import MemoryCards from "../MemoryCards.svelte";
import type { Memory } from "../../lib/stores";

function createMockMemory(overrides: Partial<Memory> = {}): Memory {
	return {
		id: "mem-123",
		title: "Test Memory Title",
		content: "Test memory content",
		type: "code_fact",
		importance: 3,
		scope: { repo: "repo-a", owner: "alice" },
		owner: "alice",
		created_at: "2026-09-11T10:00:00Z",
		updated_at: "2026-09-11T10:30:00Z",
		...overrides
	};
}

describe("MemoryCards", () => {
	it("renders owner badge when owner is present", () => {
		const target = document.createElement("div");
		const mem = createMockMemory({ owner: "alice" });

		const component = mount(MemoryCards, {
			target,
			props: {
				memories: [mem],
				loading: false,
				hasError: false,
				selectedIds: new Set<string>(),
				onToggleSelect: () => {},
				onMemoryClick: () => {}
			}
		});

		const ownerBadge = target.querySelector(".owner-badge");
		expect(ownerBadge).not.toBeNull();
		expect(ownerBadge?.textContent?.trim()).toBe("alice");
		expect(ownerBadge?.getAttribute("title")).toBe("Owner: alice");
		expect(ownerBadge?.classList.contains("owner-unknown")).toBe(false);

		unmount(component);
	});

	it("renders unknown owner badge when owner is empty", () => {
		const target = document.createElement("div");
		const mem = createMockMemory({ owner: "", scope: { repo: "repo-a", owner: "" } });

		const component = mount(MemoryCards, {
			target,
			props: {
				memories: [mem],
				loading: false,
				hasError: false,
				selectedIds: new Set<string>(),
				onToggleSelect: () => {},
				onMemoryClick: () => {}
			}
		});

		const ownerBadge = target.querySelector(".owner-badge");
		expect(ownerBadge).not.toBeNull();
		expect(ownerBadge?.textContent?.trim()).toBe("unknown");
		expect(ownerBadge?.getAttribute("title")).toBe("owner unknown (repo-only view)");
		expect(ownerBadge?.classList.contains("owner-unknown")).toBe(true);

		unmount(component);
	});

	it("renders distinct owner badges for two different memories", () => {
		const target = document.createElement("div");
		const mem1 = createMockMemory({ id: "m1", title: "Memory 1", owner: "alice" });
		const mem2 = createMockMemory({ id: "m2", title: "Memory 2", owner: "bob" });

		const component = mount(MemoryCards, {
			target,
			props: {
				memories: [mem1, mem2],
				loading: false,
				hasError: false,
				selectedIds: new Set<string>(),
				onToggleSelect: () => {},
				onMemoryClick: () => {}
			}
		});

		const badges = target.querySelectorAll(".owner-badge");
		expect(badges.length).toBe(2);
		expect(badges[0].textContent?.trim()).toBe("alice");
		expect(badges[1].textContent?.trim()).toBe("bob");

		unmount(component);
	});
});
