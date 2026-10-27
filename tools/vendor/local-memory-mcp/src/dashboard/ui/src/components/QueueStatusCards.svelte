<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import type { QueueStatus } from "../lib/api";

	/**
	 * Queue status summary (TASK-297 split — F2) — global worker/queue
	 * counters rendered as-is from GET /api/queue/status. Pure presentational:
	 * `status` is the raw QueueStatus payload and all fetching/orchestration
	 * lives in QueuePage. Counts are GLOBAL (not repo-scoped) by contract.
	 */
	let { status = null }: { status: QueueStatus | null } = $props();
</script>

<section class="queue-section" aria-label="Queue status summary">
	<div class="stat-grid">
		<div class="stat-card">
			<div class="stat-label">Pending</div>
			<div class="stat-number">{status?.pending ?? "—"}</div>
		</div>
		<div class="stat-card">
			<div class="stat-label">Claimed</div>
			<div class="stat-number">{status?.claimed ?? "—"}</div>
		</div>
		<div class="stat-card">
			<div class="stat-label">Done</div>
			<div class="stat-number">{status?.done ?? "—"}</div>
		</div>
		<div class="stat-card stat-failed">
			<div class="stat-label">Failed</div>
			<div class="stat-number">{status?.poison ?? "—"}</div>
		</div>
	</div>
	<div class="worker-counters">
		<span><Icon name="bar-chart" size={12} strokeWidth={2} /> Processed: {status?.processed ?? "—"}</span>
		<span>Failed (lifetime): {status?.failed ?? "—"}</span>
		<span>Poisoned: {status?.poisoned ?? "—"}</span>
		{#if status}
			<span class="worker-state" class:worker-active={status.running}>
				<span class="status-dot" class:status-dot-online={status.running}></span>
				{status.running ? "Worker running" : "Worker idle"}
			</span>
		{/if}
	</div>
</section>

<style>
	.queue-section {
		border-radius: 14px;
		border: 1px solid var(--color-border);
		background: var(--color-surface, #fff);
		padding: 16px;
	}

	/* ── Status summary ── */
	.stat-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 12px;
	}

	.stat-card {
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 12px 14px;
		background: rgba(255, 255, 255, 0.04);
	}

	:global(html.dark) .stat-card {
		background: rgba(10, 18, 38, 0.4);
	}

	.stat-failed .stat-number {
		color: #dc2626;
	}

	.stat-label {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		margin-bottom: 4px;
	}

	.stat-number {
		font-size: 1.5rem;
		font-weight: 850;
		color: var(--color-text);
		letter-spacing: -0.02em;
	}

	.worker-counters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 14px;
		margin-top: 12px;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.worker-counters span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}

	.worker-state .status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #94a3b8;
	}

	.worker-state.worker-active .status-dot {
		background: #10b981;
		box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
	}

	@media (max-width: 720px) {
		.stat-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
