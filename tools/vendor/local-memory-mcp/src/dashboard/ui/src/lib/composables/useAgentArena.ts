import { writable, get } from "svelte/store";
import { api } from "../api";
import { availableRepos } from "../stores";
import type { Task, TaskClaim, Handoff } from "../interfaces";
import { buildArenaScene } from "../arena/arenaTransform";
import type { ArenaScene, ArenaLayoutConfig } from "../arena/arenaTypes";
import { eventCoordinator } from "../arena/arenaEventCoordinator";
import { arenaStateManager } from "../arena/arenaStateManager";
import { createVisibilityPoller } from "../arena/createVisibilityPoller";

export interface ArenaData {
	scene: ArenaScene | null;
	loading: boolean;
	error: string | null;
	lastUpdated: number;
	repoCount: number;
}

/** Polling interval when the tab is visible (ms). */
const POLL_INTERVAL_VISIBLE = 2_500;

// ─── Exponential backoff on failures/408s (TASK-276 / audit F10) ─────────────
// When the server can't keep up (408s under load), hammering it every 2.5s
// makes the pile-up worse. Backoff ladder: 15s → 30s → 60s → 120s (cap),
// reset to the healthy 2.5s cadence on the first successful poll.
const BACKOFF_BASE_MS = 15_000;
const BACKOFF_CAP_MS = 120_000;

export function createArenaHandler() {
	const store = writable<ArenaData>({
		scene: null,
		loading: false,
		error: null,
		lastUpdated: 0,
		repoCount: 0
	});

	let fetchInProgress = false;
	let layoutConfig: ArenaLayoutConfig | null = null;
	let unsubscribeRepos: (() => void) | null = null;
	// TASK-269 / audit F7: one AbortController per fetch — aborted on unmount
	// (stop) or when a newer fetch supersedes it, so stale responses can
	// never race a repo switch or leave orphaned work behind.
	let fetchAbortController: AbortController | null = null;
	let consecutiveFailures = 0;
	const poller = createVisibilityPoller(fetchData, POLL_INTERVAL_VISIBLE);

	/** Applies backoff after a failed poll; no-op while healthy. */
	function applyBackoff(): void {
		consecutiveFailures++;
		const backoffMs = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (consecutiveFailures - 1));
		poller.setIntervalMs(backoffMs);
	}

	/** Resets backoff after a successful poll. */
	function resetBackoff(): void {
		consecutiveFailures = 0;
		poller.setIntervalMs(POLL_INTERVAL_VISIBLE);
	}

	async function fetchData(): Promise<void> {
		if (fetchInProgress) return;
		if (!layoutConfig) return;

		const repos = get(availableRepos).map((r) => r.repo);
		if (repos.length === 0) {
			// Keep loading=true; repos will populate shortly from loadRepos().
			// Subscribe once so we re-trigger fetchData as soon as repos arrive.
			if (!unsubscribeRepos) {
				unsubscribeRepos = availableRepos.subscribe((list) => {
					if (list.length > 0) {
						unsubscribeRepos?.();
						unsubscribeRepos = null;
						void fetchData();
					}
				});
			}
			return;
		}
		// Clean up subscription once we have repos
		unsubscribeRepos?.();
		unsubscribeRepos = null;

		fetchInProgress = true;

		// Supersede any in-flight fetch — only the latest wins.
		fetchAbortController?.abort();
		const controller = new AbortController();
		fetchAbortController = controller;

		try {
			// TASK-269 / audit F7: previously this fetched 5 per-repo endpoints
			// for EVERY repo in parallel (~300 requests on a 64-repo install,
			// each ~2.6s, saturating the server). The server now joins the same
			// data into ONE aggregate response — same rows, one request.
			const data = await api.arenaOverview(controller.signal);
			if (controller.signal.aborted) return; // superseded / unmounted
			const allTasks: Task[] = data.tasks ?? [];
			const allClaims: TaskClaim[] = data.claims ?? [];
			const allHandoffs: Handoff[] = data.handoffs ?? [];

			// Deduplicate tasks by id (a task is keyed once regardless of repo).
			const uniqueTasks = Array.from(new Map(allTasks.map((t) => [t.id, t])).values());

			const scene = buildArenaScene(uniqueTasks, allClaims, allHandoffs, get(store).scene, layoutConfig!);

			store.update((s) => ({
				...s,
				scene,
				loading: false,
				error: null,
				lastUpdated: Date.now(),
				repoCount: repos.length
			}));

			// Sync the state manager with the latest scene snapshot.
			// This primes the state manager for future event-driven updates
			// while the rendering continues to use the existing store.
			arenaStateManager.initFromScene(scene);

			// Healthy poll — restore normal cadence (TASK-276).
			resetBackoff();
		} catch (e) {
			if (controller.signal.aborted) return; // aborted — not an error
			// Failure / 408 — back off exponentially instead of hammering the
			// server (TASK-276 / audit F10). Superseded fetches are excluded
			// above; every real failure escalates 15→30→60→120s.
			applyBackoff();
			store.update((s) => ({
				...s,
				loading: false,
				error: e instanceof Error ? e.message : "Failed to load arena data"
			}));
		} finally {
			if (fetchAbortController === controller) {
				fetchAbortController = null;
			}
			fetchInProgress = false;
		}
	}

	function setLayout(config: ArenaLayoutConfig): void {
		layoutConfig = config;
	}

	/** Expose the arenaStateManager's reactive ArenaState store. */
	function getStateStore() {
		return arenaStateManager.getStore();
	}

	function start(config: ArenaLayoutConfig): void {
		layoutConfig = config;
		store.update((s) => ({ ...s, loading: true }));

		// Register fetchData as the fallback fetch for the EventCoordinator.
		// When SSE is unavailable, the coordinator will poll via fetchData().
		eventCoordinator.setFallbackFetch(fetchData);

		// Trigger initial data load
		void fetchData();

		// Start visibility-gated periodic polling.
		// The poller is a no-op in SSR (no document).
		poller.start();
	}

	function stop(): void {
		poller.stop();
		unsubscribeRepos?.();
		unsubscribeRepos = null;
		eventCoordinator.destroy();
		// Abort any in-flight aggregate fetch so unmount never leaves work or
		// a stale scene update behind (TASK-269 / audit F7).
		fetchAbortController?.abort();
		fetchAbortController = null;
		fetchInProgress = false;
	}

	return {
		subscribe: store.subscribe,
		getStateStore,
		start,
		stop,
		setLayout,
		refresh: fetchData
	};
}
