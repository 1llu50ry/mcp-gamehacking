<script lang="ts">
	/**
	 * Failed-job cards — the narrow-viewport presentation of the same rows the
	 * table shows on desktop.
	 *
	 * Split out of QueueJobsTable so the table markup and the card markup stop
	 * competing for one file. Visibility stays media-query driven (hidden above
	 * 720px) rather than JS-gated, so there is no resize listener and no
	 * hydration mismatch; the parent renders both and CSS picks one.
	 *
	 * Purely presentational: every mutation is a callback, matching the
	 * table's contract.
	 */
	import type { QueueJob } from "../lib/api";
	import { formatDate } from "../lib/utils";
	import { EmptyState } from "./ui";

	let {
		jobs = [],
		loading = false,
		busy = null,
		statusLabel,
		onRetry = null,
		onClear = null
	}: {
		jobs: QueueJob[];
		loading: boolean;
		busy: { id: string; action: "retry" | "clear" } | null;
		statusLabel: (s: QueueJob["status"]) => string;
		onRetry: ((job: QueueJob) => void) | null;
		onClear: ((job: QueueJob) => void) | null;
	} = $props();
</script>

<div class="job-cards" aria-label="Failed queue jobs">
	{#if loading}
		{#each { length: 3 } as _, i (i)}
			<div class="job-card"><div class="skeleton" style="height:140px;border-radius:10px;"></div></div>
		{/each}
	{:else if jobs.length === 0}
		<EmptyState
			icon="circle-check"
			title="No failed jobs"
			description="Failed (poison) jobs will appear here for re-run or clearing."
		/>
	{:else}
		{#each jobs as job (job.id)}
			<article class="job-card">
				<div class="job-heading">
					<div class="entity-cell">
						<span class="entity-kind">{job.entity_kind}</span><strong>{job.entity_id}</strong>
					</div>
					<span class="status-pill status-failed">{statusLabel(job.status)}</span>
				</div>
				<dl>
					<div>
						<dt>Attempts</dt>
						<dd>{job.attempts} / {job.max_attempts}</dd>
					</div>
					<div>
						<dt>Enqueued</dt>
						<dd>{formatDate(job.enqueued_at)}</dd>
					</div>
				</dl>
				{#if job.last_error}<p class="job-error">{job.last_error}</p>{/if}
				<div class="mobile-actions">
					<button class="btn btn-ghost" onclick={() => onRetry?.(job)} disabled={busy?.id === job.id}>Re-run</button
					><button class="btn btn-danger" onclick={() => onClear?.(job)} disabled={busy?.id === job.id}>Clear</button>
				</div>
			</article>
		{/each}
	{/if}
</div>

<style>
	/* Moved verbatim from QueueJobsTable so the split is presentation-neutral.
	   The card list is desktop-hidden; the table takes over above 720px. */
	.job-cards {
		display: none;
	}

	.entity-cell {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.entity-kind {
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-primary);
	}

	.status-pill {
		border-radius: 999px;
		padding: 2px 8px;
		font-size: 0.67rem;
		text-transform: uppercase;
		font-weight: 850;
		border: 1px solid var(--color-border);
		display: inline-block;
	}

	.status-failed {
		color: #b91c1c;
		background: rgba(239, 68, 68, 0.12);
	}

	:global(html.dark) .status-failed {
		color: #fca5a5;
	}

	@media (max-width: 720px) {
		.job-cards {
			display: grid;
			gap: var(--space-3);
		}
		.job-card {
			display: grid;
			gap: 14px;
			padding: var(--space-4);
			border: 1px solid var(--color-border);
			border-radius: var(--radius-lg);
			background: var(--color-surface);
		}
		.job-heading {
			display: flex;
			align-items: flex-start;
			justify-content: space-between;
			gap: 12px;
		}
		.job-heading strong {
			max-width: 190px;
			overflow-wrap: anywhere;
			font-size: 0.85rem;
		}
		.job-card dl {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 12px;
			margin: 0;
		}
		.job-card dl div {
			display: grid;
			gap: 4px;
		}
		.job-card dt {
			font-size: 0.68rem;
			font-weight: 700;
			color: var(--color-text-muted);
			text-transform: uppercase;
		}
		.job-card dd {
			margin: 0;
			font-size: 0.8rem;
		}
		.job-error {
			margin: 0;
			padding: 12px;
			border-radius: var(--radius-md);
			background: rgba(239, 68, 68, 0.1);
			color: var(--color-danger);
			font-size: 0.78rem;
			overflow-wrap: anywhere;
		}
		.mobile-actions {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 8px;
		}
	}
</style>
