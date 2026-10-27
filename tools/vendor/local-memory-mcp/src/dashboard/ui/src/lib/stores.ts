import { writable, derived } from "svelte/store";
import type {
	RepoMeta,
	Memory,
	Task,
	DashboardStats,
	RecentAction,
	TaskTimeStats,
	HealthData,
	Theme,
	ThemePreference
} from "./interfaces";

// ─── Stores ─────────────────────────────────────────────────────────────────

// App state
export const theme = writable<Theme>("light");
export const themePreference = writable<ThemePreference>("auto");
export const activeTab = writable<string>("arena");
export const isLoading = writable<boolean>(false);

// Repo state
export const availableRepos = writable<RepoMeta[]>([]);
export const currentRepo = writable<string | null>(null);
export const isRepoSidebarCollapsed = writable<boolean>(false);
export const pinnedRepos = writable<string[]>([]);
export const repoSearchQuery = writable<string>("");

// Stats state
export const dashboardStats = writable<DashboardStats | null>(null);
export const globalDashboardStats = writable<DashboardStats | null>(null);
export const taskTimeStats = writable<TaskTimeStats | null>(null);
export const globalTaskTimeStats = writable<TaskTimeStats | null>(null);

// Memory state
export const memories = writable<Memory[]>([]);
export const memoriesTotal = writable<number>(0);
export const memoriesPage = writable<number>(1);
export const memoriesPageSize = writable<number>(25);
export const memoriesSearch = writable<string>("");
export const memoriesTypeFilter = writable<string>("");
export const memoriesImportanceMin = writable<number | null>(null);
export const memoriesImportanceMax = writable<number | null>(null);
export const memoriesSortBy = writable<string>("updated_at");
export const memoriesSortOrder = writable<string>("desc");
export const selectedMemoryIds = writable<Set<string>>(new Set());

// Task state
export const tasks = writable<Task[]>([]);
export const taskSearch = writable<string>("");
export const taskStatusFilter = writable<string>("");

// Recent actions
export const recentActions = writable<RecentAction[]>([]);
export const recentActionsTotalItems = writable<number>(0);
export const recentActionsPage = writable<number>(1);
export const recentActionsPageSize = writable<number>(25);

// Drawer state
export const drawerTaskId = writable<string | null>(null);

// Connection status
export const healthData = writable<HealthData | null>(null);

// Chat refresh signal — increment to trigger TopBar countdown reset
export const chatRefreshSignal = writable(0);

// Derived: ordered repos (pinned first)
export const orderedRepos = derived([availableRepos, pinnedRepos, repoSearchQuery], ([$repos, $pinned, $query]) => {
	const filtered = $query ? $repos.filter((r) => r.repo.toLowerCase().includes($query.toLowerCase())) : $repos;
	const pinned = filtered
		.filter((r) => $pinned.includes(r.repo))
		.sort((a, b) => $pinned.indexOf(a.repo) - $pinned.indexOf(b.repo));
	const unpinned = filtered.filter((r) => !$pinned.includes(r.repo));
	return { pinned, unpinned };
});

// Derived: total pages for memories
export const memoriesTotalPages = derived([memoriesTotal, memoriesPageSize], ([$total, $size]) =>
	Math.max(1, Math.ceil($total / $size))
);

// ─── Knowledge Graph top-N view (TASK-213) ──────────────────────────────────
// The KG graph no longer paginates; it renders the top-N highest-degree nodes
// (graphLimit) with a progressive 'Show more' button. `kgGraphLimit` starts at
// 300 and grows by +300 per Show-more, capped at min(1000, totalItems).
export const kgGraphLimit = writable<number>(300);
export const kgTotalItems = writable<number>(0);

// ─── Persistence helpers ─────────────────────────────────────────────────────

function isNightTime(date = new Date()) {
	const hour = date.getHours();
	return hour >= 18 || hour < 6;
}

function resolveTheme(preference: ThemePreference, date = new Date()): Theme {
	return preference === "auto" ? (isNightTime(date) ? "dark" : "light") : preference;
}

function getMillisUntilNextThemeBoundary(date = new Date()) {
	const nextBoundary = new Date(date);
	if (isNightTime(date)) {
		nextBoundary.setHours(6, 0, 0, 0);
		if (date.getHours() >= 18) {
			nextBoundary.setDate(nextBoundary.getDate() + 1);
		}
		return nextBoundary.getTime() - date.getTime();
	}

	nextBoundary.setHours(18, 0, 0, 0);
	return nextBoundary.getTime() - date.getTime();
}

function applyTheme(resolvedTheme: Theme) {
	document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
	localStorage.setItem("theme", resolvedTheme);
}

export function initPersistedState() {
	let themeTimer: ReturnType<typeof setTimeout> | null = null;
	let currentPreference: ThemePreference = "auto";

	const storedPreference = localStorage.getItem("themePreference");
	const legacyTheme = localStorage.getItem("theme");
	const savedPreference: ThemePreference =
		storedPreference === "auto" || storedPreference === "light" || storedPreference === "dark"
			? storedPreference
			: legacyTheme === "dark" || legacyTheme === "light"
				? legacyTheme
				: "auto";

	themePreference.set(savedPreference);
	const resolvedTheme = resolveTheme(savedPreference);
	theme.set(resolvedTheme);
	localStorage.setItem("themePreference", savedPreference);
	applyTheme(resolvedTheme);

	const scheduleAutoThemeSync = () => {
		if (themeTimer) {
			clearTimeout(themeTimer);
			themeTimer = null;
		}

		if (currentPreference === "auto") {
			const delay = Math.max(1000, getMillisUntilNextThemeBoundary());
			themeTimer = setTimeout(() => {
				const autoTheme = resolveTheme("auto");
				theme.set(autoTheme);
				applyTheme(autoTheme);
				scheduleAutoThemeSync();
			}, delay);
		}
	};

	themePreference.subscribe((preference) => {
		currentPreference = preference;
		localStorage.setItem("themePreference", preference);
		const nextTheme = resolveTheme(preference);
		theme.set(nextTheme);
		applyTheme(nextTheme);
		scheduleAutoThemeSync();
	});

	// Sidebar collapsed
	isRepoSidebarCollapsed.set(localStorage.getItem("repoSidebarCollapsed") === "1");

	// Pinned repos
	try {
		const raw = localStorage.getItem("pinnedRepos");
		pinnedRepos.set(raw ? JSON.parse(raw) : []);
	} catch {
		pinnedRepos.set([]);
	}

	// Active tab
	const savedTab = localStorage.getItem("activeTab");
	if (savedTab) activeTab.set(savedTab);

	isRepoSidebarCollapsed.subscribe((v) => {
		localStorage.setItem("repoSidebarCollapsed", v ? "1" : "0");
	});

	pinnedRepos.subscribe((v) => {
		localStorage.setItem("pinnedRepos", JSON.stringify(v));
	});

	activeTab.subscribe((v) => {
		localStorage.setItem("activeTab", v);
	});
}

// Re-export types for backward compatibility if needed, but better to update imports
export * from "./interfaces";
