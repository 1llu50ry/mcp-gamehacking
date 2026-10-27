export function createBenchClock() {
	let offsetMs = 0;
	return {
		now() {
			return new Date(Date.now() + offsetMs);
		},
		nowIso() {
			return new Date(Date.now() + offsetMs).toISOString();
		},
		advance(ms) {
			offsetMs += ms;
		},
		nextDueBackoffIso(db) {
			const row = db
				.prepare("SELECT MIN(backoff_until) as v FROM queue_jobs WHERE status='pending' AND backoff_until IS NOT NULL")
				.get();
			return row?.v ?? null;
		},
		waitUntilDue(db) {
			const dueIso = this.nextDueBackoffIso(db);
			if (!dueIso) return 0;
			const dueMs = new Date(dueIso).getTime();
			const curMs = this.now().getTime();
			const waitMs = Math.max(0, dueMs - curMs + 5);
			if (waitMs > 0) this.advance(waitMs);
			return waitMs;
		}
	};
}
