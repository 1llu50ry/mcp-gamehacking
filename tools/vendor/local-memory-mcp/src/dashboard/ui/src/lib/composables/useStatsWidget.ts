import { derived, writable } from "svelte/store";
import { dashboardStats } from "../stores";
import { api } from "../api";
import type { Task } from "../stores";

// We'll use a local store to hold the recent active tasks fetched specifically for the leaderboard
const activeTasksStore = writable<Task[]>([]);

export function createStatsHandler() {
	const memoryStats = derived(dashboardStats, ($s) => {
		if (!$s) return null;
		return $s;
	});

	const taskStats = derived(dashboardStats, ($s) => {
		return $s?.taskStats ?? null;
	});

	// Presentation note: these derived stores intentionally carry NO colors.
	// They previously embedded raw hex values (`#6366f1`, `rgba(99,102,241,0.12)`)
	// which meant the data layer decided the palette, five brand colors leaked
	// into a single widget, and neither theme nor contrast could be adjusted
	// without editing a composable. Colour now lives entirely in the view.
	const summaryItems = derived(dashboardStats, ($s) => [
		{ label: "Total", val: $s?.total ?? 0, icon: "brain" },
		{ label: "Facts", val: $s?.byType?.code_fact ?? 0, icon: "code" },
		{ label: "Decisions", val: $s?.byType?.decision ?? 0, icon: "gavel" },
		{ label: "Archive", val: $s?.byType?.task_archive ?? 0, icon: "archive" }
	]);

	const byTypeStats = derived(dashboardStats, ($s) => {
		if (!$s?.byType) return [];
		return Object.entries($s.byType).map(([type, count]) => ({
			label: type.replace("_", " "),
			count: count
		}));
	});

	// Derived store for top 5 active tasks (the source is our specific fetch)
	const activeTasks = derived(activeTasksStore, ($tasks) => $tasks);

	// Better strategy: create a helper that the component can trigger
	async function refreshActiveTasks(repo: string) {
		if (!repo) return;
		try {
			const data = await api.tasks({
				repo,
				status: "in_progress,pending",
				pageSize: 5
			});
			activeTasksStore.set(data.tasks || []);
		} catch (err) {
			console.error("Failed to load active tasks for widget:", err);
		}
	}

	return {
		memoryStats,
		taskStats,
		summaryItems,
		byTypeStats,
		activeTasks,
		refreshActiveTasks
	};
}
