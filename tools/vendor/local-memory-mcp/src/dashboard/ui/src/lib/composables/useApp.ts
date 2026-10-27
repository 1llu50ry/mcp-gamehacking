import { writable, get, derived } from "svelte/store";
import { api } from "../api";
import { alertError } from "../confirm";

const TAB_SWITCH_DEBOUNCE_MS = 50;
const DRAWER_CLOSE_TRANSITION_MS = 300;

// ─── Client-side global stats cache ──────────────────────────────────────────
// Global dashboard stats are invariant between repo-level mutations. A short
// client TTL avoids redundant HTTP round-trips on repo select / tab switch /
// refresh while keeping staleness bounded to ≤5 s.
const GLOBAL_STATS_CACHE_TTL_MS = 5_000;
let globalStatsCache: { ts: number } | null = null;
import {
	activeTab,
	currentRepo,
	availableRepos,
	dashboardStats,
	globalDashboardStats,
	taskTimeStats,
	globalTaskTimeStats,
	recentActions,
	recentActionsPage,
	recentActionsPageSize,
	recentActionsTotalItems,
	healthData,
	isRepoSidebarCollapsed
} from "../stores";
import type { Memory, Task, RecentAction, RepoMeta, ReferenceItem, ReferenceDataState } from "../stores";

export interface AppState {
	mobileMenuOpen: boolean;
	selectedMemory: Memory | null;
	selectedTask: Task | null;
	drawerOpen: boolean;
	selectedReference: ReferenceItem | null;
	referenceDrawerOpen: boolean;
	memoryDrawerOpen: boolean;
	memoryDrawerItem: Memory | null;
	bulkImportOpen: boolean;
	bulkImportTarget: "memories" | "tasks";
	addTaskModalOpen: boolean;
	newTask: { task_code: string; title: string; phase: string; description: string; status: string; priority: number };
	capabilities: ReferenceDataState | null;
	referenceSearch: string;
	referenceFilter: "all" | "tools" | "prompts" | "resources" | "ecosystem";
}

export function createAppHandler(refs: {
	memoryList: { refresh: () => void } | null;
	kanbanBoard: { loadTasks: (repo: string) => void } | null;
}) {
	const { subscribe, set, update } = writable<AppState>({
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
		newTask: { task_code: "", title: "", phase: "", description: "", status: "pending", priority: 3 },
		capabilities: null,
		referenceSearch: "",
		referenceFilter: "all"
	});

	async function loadRepos() {
		try {
			const data = await api.repos();
			availableRepos.set(data.repos || []);
			if (data.repos?.length > 0) {
				const saved = localStorage.getItem("selectedRepo");
				const exists = data.repos.find((r: RepoMeta) => r.repo === saved);
				const repoToSet = exists ? saved! : data.repos[0].repo;
				currentRepo.set(repoToSet);
				localStorage.setItem("selectedRepo", repoToSet);
			}
		} catch (e) {
			console.error("Failed to load repos:", e);
		}
	}

	async function loadHealth(): Promise<boolean> {
		try {
			const data = await api.health();
			healthData.set(data);
			return true;
		} catch {
			healthData.set(null);
			return false;
		}
	}

	async function loadGlobalStats(forceRefresh = false): Promise<boolean> {
		const now = Date.now();
		if (!forceRefresh && globalStatsCache && now - globalStatsCache.ts < GLOBAL_STATS_CACHE_TTL_MS) {
			return true;
		}
		try {
			const [stats, timeStats] = await Promise.all([api.stats(), api.taskTimeStats()]);
			globalDashboardStats.set(stats);
			globalTaskTimeStats.set(timeStats);
			globalStatsCache = { ts: now };
			return true;
		} catch (e) {
			console.error("Failed to load global stats:", e);
			return false;
		}
	}

	async function loadStats(): Promise<boolean> {
		const repo = get(currentRepo);
		if (!repo) return true;
		let ok = true;
		try {
			const data = await api.stats(repo);
			dashboardStats.set(data);
		} catch (e) {
			console.error("Failed to load stats:", e);
			ok = false;
		}
		try {
			const data = await api.taskTimeStats(repo);
			taskTimeStats.set(data);
		} catch (err) {
			console.error("Failed to load task time stats:", err);
			ok = false;
		}
		return ok;
	}

	async function loadRecentActions(page?: number, append: boolean = false): Promise<boolean> {
		const repo = get(currentRepo);
		if (!repo) return true;
		const p = page ?? get(recentActionsPage);
		try {
			const data = await api.recentActions(repo, p, get(recentActionsPageSize));
			if (append) {
				recentActions.update((actions: RecentAction[]) => [...actions, ...(data.actions || [])]);
			} else {
				recentActions.set(data.actions || []);
			}
			recentActionsPage.set(data.pagination?.page ?? p);
			recentActionsTotalItems.set(data.pagination?.totalItems ?? 0);
			return true;
		} catch (e) {
			console.error("Failed to load recent actions:", e);
			return false;
		}
	}

	async function loadData(forceRefresh = false): Promise<boolean> {
		const repo = get(currentRepo);
		if (repo) {
			const results = await Promise.allSettled([loadGlobalStats(forceRefresh), loadStats(), loadRecentActions()]);
			// TASK-276: report failure to the polling layer so the 30s
			// countdown can back off instead of hammering an overloaded server.
			return results.every((r) => r.status === "fulfilled" && r.value === true);
		}
		return loadGlobalStats(forceRefresh);
	}

	async function onRepoSelect(repo: string) {
		currentRepo.set(repo);
		await loadData();
		refs.memoryList?.refresh();
		refs.kanbanBoard?.loadTasks(repo);
		update((s) => ({ ...s, mobileMenuOpen: false }));
	}

	/**
	 * Refreshes all dashboard data. Returns whether every loader succeeded so
	 * the polling layer (TopBar countdown) can apply exponential backoff on
	 * failure/408 (TASK-276 / audit F10).
	 */
	async function onRefresh(): Promise<boolean> {
		const results = await Promise.allSettled([loadHealth(), loadData(true)]);
		const ok = results.every((r) => r.status === "fulfilled" && r.value === true);
		const tab = get(activeTab);
		const repo = get(currentRepo);
		if (tab === "memories") refs.memoryList?.refresh();
		if (tab === "tasks" && repo) refs.kanbanBoard?.loadTasks(repo);
		return ok;
	}

	async function onTabChange(tab: string) {
		activeTab.set(tab);
		const repo = get(currentRepo);
		if (tab === "memories") {
			setTimeout(() => refs.memoryList?.refresh(), TAB_SWITCH_DEBOUNCE_MS);
		} else if (tab === "tasks" && repo) {
			setTimeout(() => refs.kanbanBoard?.loadTasks(repo), TAB_SWITCH_DEBOUNCE_MS);
		} else if (tab === "reference") {
			const s = get({ subscribe });
			if (!s.capabilities) {
				try {
					const cap = await api.capabilities();
					update((curr) => ({ ...curr, capabilities: cap }));
				} catch (err) {
					console.error("Failed to load capabilities:", err);
				}
			}
		}
	}

	function openBulkImport(target: "memories" | "tasks") {
		update((s) => ({ ...s, bulkImportTarget: target, bulkImportOpen: true }));
	}

	function openReferenceDrawer(itemType: "tool" | "prompt" | "resource", data: ReferenceItem["data"]) {
		update((s) => ({
			...s,
			selectedReference: { type: itemType, data } as ReferenceItem,
			referenceDrawerOpen: true
		}));
	}

	function openMemoryDrawer(mem: Memory) {
		update((s) => ({ ...s, memoryDrawerItem: mem, memoryDrawerOpen: true }));
	}

	function openNewMemoryDrawer() {
		update((s) => ({ ...s, memoryDrawerItem: null, memoryDrawerOpen: true }));
	}

	function handleMemorySaved() {
		refs.memoryList?.refresh();
	}

	function handleMemoryDeleted() {
		refs.memoryList?.refresh();
	}

	async function openTaskDrawer(task: Task) {
		update((s) => ({ ...s, selectedTask: task, selectedMemory: null, drawerOpen: true }));
		try {
			const fullTask = await api.taskById(task.id);
			const curr = get({ subscribe });
			if (curr.selectedTask?.id === fullTask.id) {
				update((s) => ({ ...s, selectedTask: fullTask }));
			}
		} catch (err) {
			console.error("Failed to fetch full task details:", err);
		}
	}

	function closeDrawer() {
		update((s) => ({ ...s, drawerOpen: false }));
		setTimeout(() => {
			update((s) => ({ ...s, selectedMemory: null, selectedTask: null }));
		}, DRAWER_CLOSE_TRANSITION_MS);
	}

	function handleTaskUpdated(updated: Task) {
		update((s) => ({ ...s, selectedTask: updated }));
		const repo = get(currentRepo);
		if (repo) refs.kanbanBoard?.loadTasks(repo);
	}

	async function createTask() {
		const repo = get(currentRepo);
		const s = get({ subscribe });
		const { newTask } = s;
		if (!repo || !newTask.task_code || !newTask.title) return;

		try {
			await api.createTask({ ...newTask, repo });
			update((state) => ({
				...state,
				addTaskModalOpen: false,
				newTask: { task_code: "", title: "", phase: "", description: "", status: "pending", priority: 3 }
			}));
			refs.kanbanBoard?.loadTasks(repo);
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : "Unknown error";
			alertError("Failed to create task: " + message);
		}
	}

	function onKeyDown(e: KeyboardEvent) {
		const tag = (e.target as HTMLElement)?.tagName;
		if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
		if (e.key === "Escape") closeDrawer();
		if (e.key === "r" || e.key === "R") onRefresh();
	}

	function toggleMobileMenu() {
		update((s) => ({ ...s, mobileMenuOpen: !s.mobileMenuOpen }));
	}

	function setReferenceSearch(search: string) {
		update((s) => ({ ...s, referenceSearch: search }));
	}

	function setReferenceFilter(filter: "all" | "tools" | "prompts" | "resources" | "ecosystem") {
		update((s) => ({ ...s, referenceFilter: filter }));
	}

	function toggleReferenceDrawer(open: boolean) {
		update((s) => ({ ...s, referenceDrawerOpen: open }));
	}

	function toggleMemoryDrawer(open: boolean) {
		update((s) => ({ ...s, memoryDrawerOpen: open }));
	}

	function toggleAddTaskModal(open: boolean) {
		update((s) => ({ ...s, addTaskModalOpen: open }));
	}

	function toggleBulkImport(open: boolean) {
		update((s) => ({ ...s, bulkImportOpen: open }));
	}

	function onEcosystemClick() {
		activeTab.set("reference");
		update((s) => ({ ...s, referenceFilter: "ecosystem", referenceSearch: "" }));
	}

	const sidebarCollapsed = derived(isRepoSidebarCollapsed, ($c) => $c);

	const filteredTools = derived({ subscribe }, ($s) => {
		return ($s.capabilities?.tools || []).filter(
			(t: ReferenceItem) =>
				($s.referenceFilter === "all" || $s.referenceFilter === "tools") &&
				(!$s.referenceSearch ||
					t.data.name.toLowerCase().includes($s.referenceSearch.toLowerCase()) ||
					(t.data.description || "").toLowerCase().includes($s.referenceSearch.toLowerCase()))
		);
	});

	const filteredPrompts = derived({ subscribe }, ($s) => {
		return ($s.capabilities?.prompts || []).filter(
			(p: ReferenceItem) =>
				($s.referenceFilter === "all" || $s.referenceFilter === "prompts") &&
				(!$s.referenceSearch ||
					p.data.name.toLowerCase().includes($s.referenceSearch.toLowerCase()) ||
					(p.data.description || "").toLowerCase().includes($s.referenceSearch.toLowerCase()))
		);
	});

	const filteredResources = derived({ subscribe }, ($s) => {
		return ($s.capabilities?.resources || []).filter(
			(r: ReferenceItem) =>
				($s.referenceFilter === "all" || $s.referenceFilter === "resources") &&
				(!$s.referenceSearch ||
					r.data.name.toLowerCase().includes($s.referenceSearch.toLowerCase()) ||
					(r.data.description || "").toLowerCase().includes($s.referenceSearch.toLowerCase()))
		);
	});

	return {
		subscribe,
		set,
		update,
		sidebarCollapsed,
		filteredTools,
		filteredPrompts,
		filteredResources,
		loadRepos,
		loadHealth,
		loadGlobalStats,
		loadData,
		loadStats,
		loadRecentActions,
		onRepoSelect,
		onRefresh,
		onTabChange,
		openBulkImport,
		openReferenceDrawer,
		openMemoryDrawer,
		openNewMemoryDrawer,
		handleMemorySaved,
		handleMemoryDeleted,
		openTaskDrawer,
		closeDrawer,
		handleTaskUpdated,
		createTask,
		onKeyDown,
		toggleMobileMenu,
		setReferenceSearch,
		setReferenceFilter,
		toggleReferenceDrawer,
		toggleMemoryDrawer,
		toggleAddTaskModal,
		toggleBulkImport,
		onEcosystemClick,
		refs
	};
}
