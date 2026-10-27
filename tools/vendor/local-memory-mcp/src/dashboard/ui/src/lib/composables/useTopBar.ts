import { get, writable } from "svelte/store";
import { theme, themePreference } from "../stores";
import { getRepoInitials } from "../utils";

export const GITHUB_URL = "https://github.com/vheins/local-memory-mcp";
export const NPM_URL = "https://www.npmjs.com/package/@vheins/local-memory-mcp";
export const DONATION_URL = "https://teer.id/vheins";
export const DOCUBOOK_URL = "https://www.docubook.pro/";

export function createTopBarHandler(onRefresh: () => void | Promise<boolean>) {
	const countdownSeconds = writable(30);
	const refreshing = writable(false);
	const npmDownloads = writable<number | null>(null);
	const npmLoading = writable(true);

	let countdownTimer: ReturnType<typeof setInterval>;
	let onVisibilityChange: (() => void) | null = null;
	let refreshInFlight = false;
	let consecutiveFailures = 0;
	const NPM_PKG = "@vheins/local-memory-mcp";

	// ─── Polling backoff + visibility gating (TASK-276 / audit F10) ───────────
	// The 30s countdown is the dashboard's main poller. Under load the server
	// returns 408s and requests pile up; fixes: never start a poll while one
	// is in flight, pause while the tab is hidden, and back off exponentially
	// on failure (15s → 30s → 60s → 120s cap), resetting on the first success.
	const HEALTHY_INTERVAL_SECONDS = 30;
	const BACKOFF_BASE_SECONDS = 15;
	const BACKOFF_CAP_SECONDS = 120;

	function currentIntervalSeconds(): number {
		return consecutiveFailures > 0
			? Math.min(BACKOFF_CAP_SECONDS, BACKOFF_BASE_SECONDS * 2 ** (consecutiveFailures - 1))
			: HEALTHY_INTERVAL_SECONDS;
	}

	/** Single-flight refresh wrapper: skips when already running, applies backoff. */
	async function runRefresh(): Promise<void> {
		if (refreshInFlight) return; // skip-on-inflight — never stack requests
		refreshInFlight = true;
		refreshing.set(true);
		try {
			const result = await onRefresh();
			// A falsy result means at least one loader failed (or 408 threw) →
			// escalate backoff; otherwise restore the healthy cadence.
			consecutiveFailures = result === false ? consecutiveFailures + 1 : 0;
		} catch {
			consecutiveFailures++;
		} finally {
			refreshInFlight = false;
			refreshing.set(false);
		}
	}

	function formatDownloads(n: number): string {
		if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
		if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
		return String(n);
	}

	async function fetchNpmDownloads() {
		try {
			const res = await fetch(`https://api.npmjs.org/downloads/point/last-month/${NPM_PKG}`);
			if (res.ok) {
				const data = await res.json();
				npmDownloads.set(data.downloads ?? null);
			}
		} catch {
			npmDownloads.set(null);
		} finally {
			npmLoading.set(false);
		}
	}

	function toggleTheme(event?: MouseEvent) {
		if (event?.shiftKey) {
			themePreference.set("auto");
			return;
		}

		themePreference.update((pref) => {
			if (pref === "auto") {
				return get(theme) === "dark" ? "light" : "dark";
			}
			return pref === "dark" ? "light" : "dark";
		});
	}

	function startCountdown() {
		clearInterval(countdownTimer);
		countdownSeconds.set(currentIntervalSeconds());
		countdownTimer = setInterval(() => {
			// Pause while a refresh is in flight (no stacked polls) or the tab
			// is hidden (TASK-276).
			if (refreshInFlight) return;
			if (typeof document !== "undefined" && document.hidden) return;

			countdownSeconds.update((s) => {
				if (s <= 1) {
					void runRefresh();
					return currentIntervalSeconds();
				}
				return s - 1;
			});
		}, 1000);

		// Pause when the tab is hidden; resume + immediate refresh on visible.
		if (typeof document !== "undefined" && !onVisibilityChange) {
			onVisibilityChange = () => {
				if (!document.hidden && !refreshInFlight) {
					countdownSeconds.set(1);
					void runRefresh();
				}
			};
			document.addEventListener("visibilitychange", onVisibilityChange);
		}
	}

	async function manualRefresh() {
		await runRefresh();
		startCountdown();
	}

	function destroy() {
		clearInterval(countdownTimer);
		if (onVisibilityChange && typeof document !== "undefined") {
			document.removeEventListener("visibilitychange", onVisibilityChange);
			onVisibilityChange = null;
		}
	}

	return {
		countdownSeconds,
		refreshing,
		npmDownloads,
		npmLoading,
		formatDownloads,
		fetchNpmDownloads,
		toggleTheme,
		startCountdown,
		manualRefresh,
		getRepoInitials,
		destroy
	};
}
