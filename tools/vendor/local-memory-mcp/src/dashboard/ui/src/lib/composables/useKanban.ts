import { writable, get } from "svelte/store";
import { onMount } from "svelte";
import { api } from "../api";
import { currentRepo, taskSearch } from "../stores";
import type { Task } from "../stores";
import { exportToJSON, exportToCSV } from "../utils";
import { alertError } from "../confirm";

export interface KanbanState {
	loadingCols: Set<string>;
	pagination: Record<
		string,
		{ page: number; pageSize: number; hasMore: boolean; totalItems: number; totalPages: number }
	>;
	columnTasks: Record<string, Task[]>;
	draggedTask: Task | null;
	sourceCol: string | null;
	dragOverCol: string | null;
	selectedTaskIds: Set<string>;
}

export const COLUMNS: { status: string; label: string; bg: string; border: string; icon: string; color: string }[] = [
	{
		status: "backlog",
		label: "Backlog",
		bg: "rgba(100,116,139,0.07)",
		border: "rgba(100,116,139,0.18)",
		icon: "archive",
		color: "#64748b"
	},
	{
		status: "pending",
		label: "To Do",
		bg: "rgba(14,165,233,0.06)",
		border: "rgba(14,165,233,0.18)",
		icon: "circle-dot",
		color: "#0ea5e9"
	},
	{
		status: "in_progress",
		label: "In Progress",
		bg: "rgba(168,85,247,0.07)",
		border: "rgba(168,85,247,0.18)",
		icon: "zap",
		color: "#a855f7"
	},
	{
		status: "blocked",
		label: "Blocked",
		bg: "rgba(239,68,68,0.07)",
		border: "rgba(239,68,68,0.18)",
		icon: "alert-circle",
		color: "#ef4444"
	},
	{
		status: "completed",
		label: "Completed",
		bg: "rgba(16,185,129,0.06)",
		border: "rgba(16,185,129,0.18)",
		icon: "circle-check",
		color: "#10b981"
	},
	{
		status: "canceled",
		label: "Canceled",
		bg: "rgba(148,163,184,0.07)",
		border: "rgba(148,163,184,0.18)",
		icon: "circle-x",
		color: "#94a3b8"
	}
];

// Prioritized/staggered loading: the 4 ACTIVE columns fire in parallel first (in
// taskStatusOrderBy priority order), then the 2 TERMINAL columns in a second batch.
// This keeps request concurrency at 4 instead of 6 while all columns still fill —
// per-column pagination/hasMore depends on per-status totalItems, so a single
// multi-status request would break it (TaskService.list returns one flat page).
const ACTIVE_COLUMN_STATUSES = ["in_progress", "pending", "backlog", "blocked"];
const TERMINAL_COLUMN_STATUSES = ["completed", "canceled"];

export function createKanbanHandler() {
	const initialPagination: Record<
		string,
		{ page: number; pageSize: number; hasMore: boolean; totalItems: number; totalPages: number }
	> = {};
	const initialColumnTasks: Record<string, Task[]> = {};

	COLUMNS.forEach((c) => {
		initialPagination[c.status] = { page: 1, pageSize: 20, hasMore: true, totalItems: 0, totalPages: 0 };
		initialColumnTasks[c.status] = [];
	});

	const initialState: KanbanState = {
		loadingCols: new Set(),
		pagination: initialPagination,
		columnTasks: initialColumnTasks,
		draggedTask: null,
		sourceCol: null,
		dragOverCol: null,
		selectedTaskIds: new Set()
	};

	const { subscribe, update } = writable<KanbanState>(initialState);

	async function loadColumn(repo: string, status: string, search: string) {
		const state = get({ subscribe });
		if (state.loadingCols.has(status)) return;

		update((s) => {
			const next = new Set(s.loadingCols);
			next.add(status);
			return { ...s, loadingCols: next };
		});

		const p = state.pagination[status];
		try {
			const data = await api.tasks({
				repo,
				status,
				search,
				page: p.page,
				pageSize: p.pageSize
			});

			update((s) => {
				const rawTasks = p.page === 1 ? data.tasks || [] : [...(s.columnTasks[status] || []), ...(data.tasks || [])];
				const nextTasks = [...new Map(rawTasks.map((t) => [t.id, t])).values()];
				const totalItems = data.pagination?.totalItems ?? nextTasks.length;
				const totalPages = data.pagination?.totalPages ?? Math.ceil(totalItems / p.pageSize);

				return {
					...s,
					columnTasks: { ...s.columnTasks, [status]: nextTasks },
					pagination: {
						...s.pagination,
						[status]: {
							...p,
							totalItems,
							totalPages,
							hasMore: nextTasks.length < totalItems
						}
					}
				};
			});
		} catch (e) {
			console.error(`Failed to load ${status}:`, e);
		} finally {
			update((s) => {
				const next = new Set(s.loadingCols);
				next.delete(status);
				return { ...s, loadingCols: next };
			});
		}
	}

	async function loadTasks(repo: string, search: string) {
		if (!repo) return;

		update((s) => {
			const nextPagination = { ...s.pagination };
			const nextColumnTasks = { ...s.columnTasks };
			COLUMNS.forEach((c) => {
				nextPagination[c.status] = { page: 1, pageSize: 20, hasMore: true, totalItems: 0, totalPages: 0 };
				nextColumnTasks[c.status] = [];
			});
			return { ...s, pagination: nextPagination, columnTasks: nextColumnTasks };
		});

		// ACTIVE columns first (concurrency peaks at 4), then TERMINAL columns.
		await Promise.all(ACTIVE_COLUMN_STATUSES.map((status) => loadColumn(repo, status, search)));
		await Promise.all(TERMINAL_COLUMN_STATUSES.map((status) => loadColumn(repo, status, search)));
	}

	async function loadMore(status: string) {
		const repo = get(currentRepo);
		const search = get(taskSearch);
		if (!repo) return;

		update((s) => ({
			...s,
			pagination: {
				...s.pagination,
				[status]: { ...s.pagination[status], page: s.pagination[status].page + 1 }
			}
		}));

		await loadColumn(repo, status, search);
	}

	function handleDragStart(e: DragEvent, task: Task, colStatus: string) {
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setData("text/plain", task.id);
		}
		update((s) => ({ ...s, draggedTask: task, sourceCol: colStatus }));
	}

	function handleDragOver(e: DragEvent, colStatus: string) {
		e.preventDefault();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = "move";
		}
		const state = get({ subscribe });
		if (!state.draggedTask || state.sourceCol === colStatus) return;
		update((s) => ({ ...s, dragOverCol: colStatus }));
	}

	function handleDragLeave(colStatus: string) {
		update((s) => {
			if (s.dragOverCol === colStatus) return { ...s, dragOverCol: null };
			return s;
		});
	}

	async function handleDrop(targetCol: string) {
		const repo = get(currentRepo);
		const search = get(taskSearch);
		const state = get({ subscribe });
		const { draggedTask, sourceCol } = state;

		update((s) => ({ ...s, dragOverCol: null, draggedTask: null, sourceCol: null }));

		if (!draggedTask || !sourceCol || sourceCol === targetCol) return;

		// Optimistic update
		update((s) => {
			const nextCols = { ...s.columnTasks };
			nextCols[sourceCol] = nextCols[sourceCol].filter((t) => t.id !== draggedTask.id);
			const updatedTask = { ...draggedTask, status: targetCol };
			nextCols[targetCol] = [updatedTask, ...(nextCols[targetCol] || []).filter((t) => t.id !== updatedTask.id)];
			return { ...s, columnTasks: nextCols };
		});

		try {
			const updatedTask = await api.updateTask(draggedTask.id, { status: targetCol });
			update((s) => {
				const nextCols = { ...s.columnTasks };
				nextCols[targetCol] = (nextCols[targetCol] || []).map((task) =>
					task.id === updatedTask.id ? updatedTask : task
				);
				return { ...s, columnTasks: nextCols };
			});
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Unknown error";
			console.error("Failed to move task:", message);
			if (repo) loadTasks(repo, search);
		}
	}

	async function handleExport(format: "json" | "csv") {
		const repo = get(currentRepo);
		if (!repo) return;
		try {
			const data = await api.export(repo);
			const filename = `${repo.replace(/\//g, "_")}_tasks_export`;
			if (format === "json") {
				exportToJSON(data.tasks || [], filename + ".json");
			} else {
				exportToCSV((data.tasks as unknown as Record<string, unknown>[]) || [], filename + ".csv");
			}
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Unknown error";
			alertError("Export failed: " + message);
		}
	}

	// Centralized Initialization & Subscription
	onMount(() => {
		let initializing = true;
		const unsubRepo = currentRepo.subscribe((repo) => {
			const search = get(taskSearch);
			if (repo) loadTasks(repo, search);
		});

		// Instead of using input event inside html, subscribe to search directly
		let searchTimeout: ReturnType<typeof setTimeout>;
		const unsubSearch = taskSearch.subscribe((search) => {
			if (initializing) return;
			const r = get(currentRepo);
			if (r) {
				clearTimeout(searchTimeout);
				searchTimeout = setTimeout(() => {
					loadTasks(r, search);
				}, 150);
			}
		});

		initializing = false;

		return () => {
			unsubRepo();
			unsubSearch();
			clearTimeout(searchTimeout);
		};
	});

	function toggleSelectTask(id: string) {
		update((s) => {
			const next = new Set(s.selectedTaskIds);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return { ...s, selectedTaskIds: next };
		});
	}

	function clearSelection() {
		update((s) => ({ ...s, selectedTaskIds: new Set() }));
	}

	async function handleBulkDelete() {
		const state = get({ subscribe });
		const ids = Array.from(state.selectedTaskIds);
		if (ids.length === 0) return;

		try {
			await api.bulkTaskAction("delete", ids);
			update((s) => {
				const nextCols = { ...s.columnTasks };
				for (const col of Object.keys(nextCols)) {
					nextCols[col] = nextCols[col].filter((t) => !s.selectedTaskIds.has(t.id));
				}
				return { ...s, columnTasks: nextCols, selectedTaskIds: new Set() };
			});
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Unknown error";
			alertError("Failed to delete: " + message);
		}
	}

	async function handleBulkStatusMove(targetStatus: string) {
		const state = get({ subscribe });
		const ids = Array.from(state.selectedTaskIds);
		if (ids.length === 0) return;

		try {
			await api.bulkTaskAction("status", ids, { status: targetStatus });
			update((s) => {
				const nextCols = { ...s.columnTasks };
				for (const col of Object.keys(nextCols)) {
					const movedTasks = nextCols[col].filter((t) => s.selectedTaskIds.has(t.id));
					const remainingTasks = nextCols[col].filter((t) => !s.selectedTaskIds.has(t.id));
					nextCols[col] = remainingTasks;
					if (col === targetStatus) {
						const movedWithStatus = movedTasks.map((t) => ({ ...t, status: targetStatus }));
						nextCols[col] = [...movedWithStatus, ...nextCols[col]];
					}
				}
				return { ...s, columnTasks: nextCols, selectedTaskIds: new Set() };
			});
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Unknown error";
			alertError("Failed to move tasks: " + message);
		}
	}

	return {
		subscribe,
		loadTasks,
		loadMore,
		handleDragStart,
		handleDragOver,
		handleDragLeave,
		handleDrop,
		handleExport,
		toggleSelectTask,
		clearSelection,
		handleBulkDelete,
		handleBulkStatusMove
	};
}
