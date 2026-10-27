// @vitest-environment jsdom
// RepoSidebar navigation surface tests (TASK-435 — regression guard for the
// TASK-425 nav restructure).
//
// The left sidebar nav is the app's ONLY navigation surface: NAV_ITEMS
// (lib/navigation.ts) drives every view gate in App.svelte. These tests pin
// down the TASK-405/TASK-425 a11y contract — exactly 11 role=tab items, a
// single tablist with the accessible name "Dashboard sections", aria-selected
// synchronized with the `activeTab` store, and onTabSelect emission — so a
// future regression (dropped item, broken gate, duplicated tablist) fails CI
// instead of passing silently.
//
// Store strategy: the REAL stores module is used (no store mock) so
// `activeTab.set()` exercises the actual subscription → re-render path.
// stores.ts is side-effect-free at import time (initPersistedState is opt-in).
// useRepoSidebar / RepoItem / Icon are mocked per the App.test.ts pattern —
// nav semantics (role/aria-selected/label) are what we assert, not icon or
// repo-list plumbing.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, setup, cleanup } from "@testing-library/svelte";

import RepoSidebar from "../RepoSidebar.svelte";
import { NAV_ITEMS } from "../../lib/navigation";
import {
	activeTab,
	isRepoSidebarCollapsed,
	availableRepos,
	currentRepo,
	pinnedRepos,
	repoSearchQuery
} from "../../lib/stores";

// ─── Mocks (App.test.ts pattern) ────────────────────────────────────────────
// Nav handler: collapse/select/pin plumbing is not under test here.
vi.mock("../../lib/composables/useRepoSidebar", () => ({
	createRepoSidebarHandler: () => ({
		toggleCollapse: vi.fn(),
		selectRepo: vi.fn(),
		togglePin: vi.fn(),
		onDragStart: vi.fn(),
		onDragOver: vi.fn(),
		onDrop: vi.fn(),
		onDragEnd: vi.fn(),
		getRepoInitials: (repo: string) => repo.slice(0, 2)
	})
}));
// Sub-components: heavy repo list + SVG icons are stubbed; the assertions
// below probe the nav semantics only.
vi.mock("../../lib/Icon.svelte", () => ({ default: () => ({}) }));
vi.mock("../RepoItem.svelte", () => ({ default: () => ({}) }));

// ─── Independent contract (NOT derived from NAV_ITEMS, so a removed/re-ordered
//     item fails the test instead of making it tautological) ────────────────
const EXPECTED_NAV = [
	{ id: "dashboard", label: "Overview", scope: "global" },
	{ id: "arena", label: "Agent Arena", scope: "global" },
	{ id: "queue", label: "Queue", scope: "global" },
	{ id: "tasks", label: "Tasks", scope: "workspace" },
	{ id: "memories", label: "Memories", scope: "workspace" },
	{ id: "codebase", label: "Codebase", scope: "workspace" },
	{ id: "knowledge-graph", label: "Knowledge Graph", scope: "workspace" },
	{ id: "standards", label: "Standards", scope: "workspace" },
	{ id: "handoffs", label: "Handoffs", scope: "workspace" },
	{ id: "activity", label: "Activity", scope: "workspace" },
	{ id: "reference", label: "MCP Reference", scope: "system" }
] as const;

function renderSidebar(onTabSelect = vi.fn(), onRepoSelect = vi.fn()) {
	return render(RepoSidebar, { props: { onRepoSelect, onTabSelect } });
}

// Reset module-level store state between tests (real stores persist across
// tests in the same file) and (re)configure the testing-library env.
beforeEach(async () => {
	activeTab.set("arena");
	isRepoSidebarCollapsed.set(false);
	availableRepos.set([]);
	currentRepo.set(null);
	pinnedRepos.set([]);
	repoSearchQuery.set("");
	vi.clearAllMocks();
	await setup();
});

afterEach(() => {
	cleanup();
});

// ─── NAV_ITEMS model (TASK-425 contract) ────────────────────────────────────
describe("NAV_ITEMS nav model (TASK-425 contract)", () => {
	it("exposes exactly the 11 dashboard views with unique ids and correct labels", () => {
		expect(NAV_ITEMS).toHaveLength(EXPECTED_NAV.length);
		expect(NAV_ITEMS.map((n) => n.id)).toEqual(EXPECTED_NAV.map((n) => n.id));
		expect(NAV_ITEMS.map((n) => n.label)).toEqual(EXPECTED_NAV.map((n) => n.label));
		expect(new Set(NAV_ITEMS.map((n) => n.id)).size).toBe(NAV_ITEMS.length);
	});
});

// ─── RepoSidebar navigation rendering (TASK-435) ────────────────────────────
describe("RepoSidebar navigation (TASK-435)", () => {
	it("renders one primary navigation landmark with explicit global, workspace, and system groups", () => {
		const { container } = renderSidebar();
		expect(screen.getAllByRole("navigation", { name: "Primary navigation" })).toHaveLength(1);
		expect(
			Array.from(container.querySelectorAll("[data-scope]")).map((group) => group.getAttribute("data-scope"))
		).toEqual(["global", "workspace", "system"]);
	});

	it("renders all 11 destinations as links-in-place with stable ids and labels", () => {
		renderSidebar();
		for (const item of EXPECTED_NAV) {
			const destination = screen.getByRole("button", { name: item.label });
			expect(destination.id).toBe(`nav-${item.id}`);
		}
	});

	it("marks exactly one destination as the current page", () => {
		activeTab.set("queue");
		renderSidebar();

		const queue = screen.getByRole("button", { name: "Queue" });
		expect(queue.getAttribute("aria-current")).toBe("page");
		expect(screen.getByRole("button", { name: "Overview" }).hasAttribute("aria-current")).toBe(false);
	});

	it("syncs aria-current when the activeTab store changes", async () => {
		renderSidebar();
		expect(screen.getByRole("button", { name: "Agent Arena" }).getAttribute("aria-current")).toBe("page");

		activeTab.set("standards");
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Standards" }).getAttribute("aria-current")).toBe("page");
			expect(screen.getByRole("button", { name: "Agent Arena" }).hasAttribute("aria-current")).toBe(false);
		});
	});

	it("emits onTabSelect with the clicked destination id", async () => {
		const onTabSelect = vi.fn();
		renderSidebar(onTabSelect);

		await fireEvent.click(screen.getByRole("button", { name: "Memories" }));
		await fireEvent.click(screen.getByRole("button", { name: "Tasks" }));

		expect(onTabSelect).toHaveBeenCalledTimes(2);
		expect(onTabSelect).toHaveBeenNthCalledWith(1, "memories");
		expect(onTabSelect).toHaveBeenNthCalledWith(2, "tasks");
	});

	it("collapsed state keeps all destinations with descriptive tooltips and hides labels", () => {
		isRepoSidebarCollapsed.set(true);
		const { container } = renderSidebar();

		for (const item of EXPECTED_NAV) {
			const destination = container.querySelector(`#nav-${item.id}`);
			expect(destination).not.toBeNull();
			expect(destination?.getAttribute("title")).toContain(item.label);
		}
		expect(container.querySelectorAll(".nav-label")).toHaveLength(0);
	});
});
