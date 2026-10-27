/**
 * Creates a visibility-gated poller that pauses when the document is hidden
 * and resumes (with an immediate fetch) when it becomes visible again.
 *
 * SSR contract: when `document` is unavailable (SSR / jsdom-less tests),
 * the poller is a no-op — no interval, no listener, no initial fetch.
 *
 * @param fetchFn  Called on each tick (only when document is visible).
 * @param intervalMs  Polling interval in milliseconds.
 * @returns `{ start(); stop() }` — call start() to begin, stop() to clean up.
 */
export function createVisibilityPoller(
	fetchFn: () => void | Promise<void>,
	intervalMs: number
): { start(): void; stop(): void; setIntervalMs(ms: number): void } {
	let intervalId: ReturnType<typeof setInterval> | null = null;
	let onVisibilityChange: (() => void) | null = null;
	let currentIntervalMs = intervalMs;

	const tick = () => {
		if (document.visibilityState === "visible") {
			void fetchFn();
		}
	};

	function start(): void {
		// Guard: no DOM → no-op (SSR / test without jsdom)
		if (typeof document === "undefined") return;

		// Already running — guard against double-start
		if (intervalId !== null) return;

		intervalId = setInterval(tick, currentIntervalMs);

		onVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				void fetchFn();
			}
		};
		document.addEventListener("visibilitychange", onVisibilityChange);
	}

	function stop(): void {
		if (intervalId !== null) {
			clearInterval(intervalId);
			intervalId = null;
		}
		if (onVisibilityChange && typeof document !== "undefined") {
			document.removeEventListener("visibilitychange", onVisibilityChange);
			onVisibilityChange = null;
		}
	}

	/**
	 * Changes the polling interval live (TASK-276 / audit F10). Used for
	 * exponential backoff on failures/408s — the running timer is re-armed at
	 * the new cadence; healthy cadence is restored by calling it with the
	 * normal interval after a successful poll.
	 */
	function setIntervalMs(ms: number): void {
		currentIntervalMs = ms;
		if (intervalId !== null) {
			clearInterval(intervalId);
			intervalId = setInterval(tick, currentIntervalMs);
		}
	}

	return { start, stop, setIntervalMs };
}
