// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mount, unmount, tick } from "svelte";
import App from "../../App.svelte";

// ─── Mutable fixtures (TASK-419) ─────────────────────────────────────────────
// App.svelte's shell gate (TASK-418) reads `$currentRepo` + `$activeTab` at
// mount time, so both stores are mocked as plain subscribers over a mutable
// vi.hoisted object — set the value, then mount. `api` is mocked so the real
// QueuePage can be exercised (its $effect fires queueStatus/queueJobs without
// hitting the network).
const { mock } = vi.hoisted(() => ({
	mock: {
		activeTab: "queue" as string,
		currentRepo: null as string | null,
		availableRepos: [] as unknown[],
		initPersistedState: vi.fn(),
		api: {
			capabilities: vi.fn().mockResolvedValue(null),
			queueStatus: vi.fn().mockResolvedValue({
				pending: 0,
				claimed: 0,
				done: 0,
				poison: 0,
				total: 0,
				processed: 0,
				failed: 0,
				poisoned: 0,
				lastBatchSize: 0,
				lastRunAt: null,
				running: false,
				started: false,
				modelReady: false,
				pollIntervalMs: 5000,
				batchSize: 10,
				leaseMs: 60000,
				embedLatency: { count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 }
			}),
			queueJobs: vi.fn().mockResolvedValue({
				jobs: [],
				pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 1 }
			}),
			queueRetryJob: vi.fn(),
			queueClearJob: vi.fn(),
			queueRetryAll: vi.fn()
		}
	}
}));

// Store module — only the exports App.svelte reads, each a plain subscriber
// (mock values are read at mount time; per-test re-mount re-reads them).
vi.mock("../../lib/stores", () => ({
	activeTab: {
		subscribe: (fn: (v: string) => void) => {
			fn(mock.activeTab);
			return () => {};
		}
	},
	currentRepo: {
		subscribe: (fn: (v: string | null) => void) => {
			fn(mock.currentRepo);
			return () => {};
		}
	},
	recentActionsTotalItems: {
		subscribe: (fn: (v: number) => void) => {
			fn(0);
			return () => {};
		}
	},
	dashboardStats: {
		subscribe: (fn: (v: unknown) => void) => {
			fn(null);
			return () => {};
		}
	},
	taskTimeStats: {
		subscribe: (fn: (v: unknown) => void) => {
			fn(null);
			return () => {};
		}
	},
	availableRepos: {
		subscribe: (fn: (v: unknown[]) => void) => {
			fn(mock.availableRepos);
			return () => {};
		}
	},
	initPersistedState: mock.initPersistedState
}));

// API module — QueuePage stays REAL (light presentational tree: header +
// status cards + jobs table + TASK-411 global banner) but all network goes
// through this mock.
vi.mock("../../lib/api", () => ({
	api: {
		capabilities: mock.api.capabilities,
		queueStatus: mock.api.queueStatus,
		queueJobs: mock.api.queueJobs,
		queueRetryJob: mock.api.queueRetryJob,
		queueClearJob: mock.api.queueClearJob,
		queueRetryAll: mock.api.queueRetryAll
	}
}));

// Composer — the full handler surface App.svelte destructures / calls.
vi.mock("../../lib/composables/useApp", () => ({
	createAppHandler: () => ({
		subscribe: (fn: (s: Record<string, unknown>) => void) => {
			fn({
				mobileMenuOpen: false,
				selectedMemory: null,
				selectedTask: null,
				drawerOpen: false,
				selectedReference: null,
				referenceDrawerOpen: false,
				memoryDrawerOpen: false,
				memoryDrawerItem: null,
				bulkImportOpen: false,
				bulkImportTarget: "memories",
				addTaskModalOpen: false,
				newTask: {},
				capabilities: null,
				referenceSearch: "",
				referenceFilter: "all"
			});
			return () => {};
		},
		set: vi.fn(),
		update: vi.fn(),
		sidebarCollapsed: {
			subscribe: (fn: (v: boolean) => void) => {
				fn(false);
				return () => {};
			}
		},
		filteredTools: {
			subscribe: (fn: (v: unknown[]) => void) => {
				fn([]);
				return () => {};
			}
		},
		filteredPrompts: {
			subscribe: (fn: (v: unknown[]) => void) => {
				fn([]);
				return () => {};
			}
		},
		filteredResources: {
			subscribe: (fn: (v: unknown[]) => void) => {
				fn([]);
				return () => {};
			}
		},
		loadRepos: vi.fn(),
		loadHealth: vi.fn(),
		loadData: vi.fn(),
		loadRecentActions: vi.fn(),
		onRepoSelect: vi.fn(),
		onRefresh: vi.fn(),
		onTabChange: vi.fn(),
		onKeyDown: vi.fn(),
		onEcosystemClick: vi.fn(),
		toggleMobileMenu: vi.fn(),
		openMemoryDrawer: vi.fn(),
		openNewMemoryDrawer: vi.fn(),
		openBulkImport: vi.fn(),
		openTaskDrawer: vi.fn(),
		closeDrawer: vi.fn(),
		handleTaskUpdated: vi.fn(),
		handleMemorySaved: vi.fn(),
		handleMemoryDeleted: vi.fn(),
		createTask: vi.fn(),
		toggleAddTaskModal: vi.fn(),
		toggleReferenceDrawer: vi.fn(),
		toggleMemoryDrawer: vi.fn()
	})
}));

// Utils + confirm — keep module loads side-effect free.
vi.mock("../../lib/utils", () => ({
	createChatTask: vi.fn().mockResolvedValue(undefined),
	formatDate: (d: string) => d ?? ""
}));
vi.mock("../../lib/confirm", () => ({
	confirmAction: vi.fn(),
	confirmDelete: vi.fn(),
	alertError: vi.fn(),
	alertSuccess: vi.fn()
}));

// Heavy sub-components are stubbed (same approach as TopBar/ArenaViewport/
// MemoryDrawer tests); QueuePage + QueueStatusCards + QueueJobsTable stay real
// so the queue assertions probe actual rendered content.
vi.mock("../RepoSidebar.svelte", () => ({ default: () => ({}) }));
vi.mock("../TopBar.svelte", () => ({ default: () => ({}) }));
vi.mock("../KanbanBoard.svelte", () => ({ default: () => ({}) }));
vi.mock("../StatsWidget.svelte", () => ({ default: () => ({}) }));
vi.mock("../TaskStatsWidget.svelte", () => ({ default: () => ({}) }));
vi.mock("../TimeStatsWidget.svelte", () => ({ default: () => ({}) }));
vi.mock("../MemoryList.svelte", () => ({ default: () => ({}) }));
vi.mock("../RecentActions.svelte", () => ({ default: () => ({}) }));
vi.mock("../DetailDrawer.svelte", () => ({ default: () => ({}) }));
vi.mock("../ReferenceDrawer.svelte", () => ({ default: () => ({}) }));
vi.mock("../MemoryDrawer.svelte", () => ({ default: () => ({}) }));
vi.mock("../BulkImportModal.svelte", () => ({ default: () => ({}) }));
vi.mock("../AddTaskModal.svelte", () => ({ default: () => ({}) }));
vi.mock("../ReferenceTab.svelte", () => ({ default: () => ({}) }));
vi.mock("../FloatingChat.svelte", () => ({ default: () => ({}) }));
vi.mock("../StandardsPanel.svelte", () => ({ default: () => ({}) }));
vi.mock("../CodebasePage.svelte", () => ({ default: () => ({}) }));
vi.mock("../HandoffsPanel.svelte", () => ({ default: () => ({}) }));
vi.mock("../KGGraph.svelte", () => ({ default: () => ({}) }));
vi.mock("../AgentArena.svelte", () => ({ default: () => ({}) }));
vi.mock("../GlobalCommandCenter.svelte", () => ({ default: () => ({}) }));
vi.mock("../WorkspaceSwitcher.svelte", () => ({ default: () => ({}) }));
vi.mock("../../lib/Icon.svelte", () => ({ default: () => ({}) }));

function mountApp() {
	const target = document.createElement("div");
	const component = mount(App, { target });
	return { target, component };
}

// Flush the route's dynamic import plus QueuePage's async $effect
// (api.queueStatus/queueJobs are already resolved promises) so both the lazy
// view module and its state updates land before assertions.
async function settle(target?: HTMLElement) {
	for (let i = 0; i < 50; i++) {
		if (target && (target.querySelector(".feature-shell") || target.querySelector(".empty"))) return;
		await new Promise((r) => setTimeout(r, 1));
		await tick();
	}
}

describe("App shell gate (TASK-418)", () => {
	// Routes are code-split, so warm the lazy module cache once: App's dynamic
	// import then resolves within the same microtask queue the assertions use.
	beforeAll(async () => {
		await import("../QueuePage.svelte");
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("exports a valid Svelte component", () => {
		expect(App).toBeDefined();
		expect(typeof App).toBe("function");
	});

	it("renders the Queue tab in global mode (no repo) — no empty state, global banner visible", async () => {
		mock.activeTab = "queue";
		mock.currentRepo = null;
		const { target, component } = mountApp();
		await settle(target);

		// Gate must NOT swap the shell for the workspace gate.
		expect(target.textContent).not.toContain("No workspaces yet");
		// Real QueuePage renders (feature-shell is its root div).
		expect(target.querySelector(".feature-shell")).not.toBeNull();
		// TASK-411 global-mode banner is present only with no repo filter.
		expect(target.querySelector(".notice-banner")).not.toBeNull();
		expect(target.textContent).toContain("Global queue");
		// loadJobs fires in global mode with an empty repo (server-wide outbox).
		expect(mock.api.queueJobs).toHaveBeenCalledWith({
			repo: "",
			page: 1,
			pageSize: 50,
			status: "poison"
		});
		unmount(component);
	});

	it("gates a per-repo tab (memories) behind a repo selection", async () => {
		mock.activeTab = "memories";
		mock.currentRepo = null;
		mock.availableRepos = [];
		const { target, component } = mountApp();
		await settle(target);

		expect(target.querySelector(".empty")).not.toBeNull();
		expect(target.querySelector(".feature-shell")).toBeNull();
		unmount(component);
	});

	// With zero workspaces the gate is an ONBOARDING screen: telling this user
	// to "select a repository from the sidebar" is a dead end because the
	// sidebar is empty. It must state how a workspace comes into existence.
	it("explains how to create a workspace when none exist", async () => {
		mock.activeTab = "memories";
		mock.currentRepo = null;
		mock.availableRepos = [];
		const { target, component } = mountApp();
		await settle(target);

		expect(target.textContent).toContain("No workspaces yet");
		expect(target.textContent).toContain("codebase-index");
		unmount(component);
	});

	// With workspaces present the correct instruction is different: pick one.
	it("asks the user to choose a workspace when some exist", async () => {
		mock.activeTab = "memories";
		mock.currentRepo = null;
		mock.availableRepos = [{ repo: "alpha" }];
		const { target, component } = mountApp();
		await settle(target);

		expect(target.textContent).toContain("Choose a workspace");
		expect(target.textContent).not.toContain("No workspaces yet");
		unmount(component);
	});

	it("renders the Queue tab with a repo selected — no global banner, repo-filtered load", async () => {
		mock.activeTab = "queue";
		mock.currentRepo = "my-repo";
		const { target, component } = mountApp();
		await settle(target);

		expect(target.textContent).not.toContain("No workspaces yet");
		expect(target.querySelector(".feature-shell")).not.toBeNull();
		// Global banner is global-mode-only.
		expect(target.querySelector(".notice-banner")).toBeNull();
		expect(target.textContent).not.toContain("Global queue");
		// QueuePage receives the selected repo scope.
		expect(mock.api.queueJobs).toHaveBeenCalledWith({
			repo: "my-repo",
			page: 1,
			pageSize: 50,
			status: "poison"
		});
		unmount(component);
	});
});
