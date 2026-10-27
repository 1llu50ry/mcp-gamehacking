<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import type { QueueJob } from "../lib/api";
	import QueueJobCards from "./QueueJobCards.svelte";
	import { formatDate } from "../lib/utils";
	import { EmptyState, TablePagination } from "./ui";

	/**
	 * Failed (poison) jobs table (TASK-297 split — F2). Renders the jobs array
	 * as-is from GET /api/queue/jobs?status=poison with per-row Re-run/Clear
	 * and pagination. Pure presentational: all data fetching, mutation and
	 * confirmation orchestration live in QueuePage and arrive via props /
	 * callbacks.
	 */
	let {
		jobs = [],
		loading = false,
		page = 1,
		totalItems = 0,
		totalPages = 1,
		busy = null,
		retryingAll = false,
		onRetry = null,
		onClear = null,
		onRetryAll = null,
		onRefresh = null,
		onPageChange = null
	}: {
		jobs: QueueJob[];
		loading: boolean;
		page: number;
		totalItems: number;
		totalPages: number;
		busy: { id: string; action: "retry" | "clear" } | null;
		retryingAll: boolean;
		onRetry: ((job: QueueJob) => void) | null;
		onClear: ((job: QueueJob) => void) | null;
		onRetryAll: (() => void) | null;
		onRefresh: (() => void) | null;
		onPageChange: ((next: number) => void) | null;
	} = $props();

	// ── Status label mapping (poison → "Failed" is UI-only) ───────────────────
	function statusLabel(s: QueueJob["status"]): string {
		return s === "poison" ? "Failed (poison)" : s.charAt(0).toUpperCase() + s.slice(1);
	}
</script>

<section class="queue-section" aria-label="Failed jobs">
	<div class="table-header">
		<div>
			<div class="table-title">Failed jobs</div>
			<div class="table-subtitle">
				{loading ? "Loading…" : `${totalItems} failed job${totalItems === 1 ? "" : "s"}`}
			</div>
		</div>
		<div class="table-actions">
			<button
				class="btn btn-ghost btn-sm"
				onclick={() => onRefresh?.()}
				disabled={loading}
				title="Refresh queue"
				aria-label="Refresh queue"
			>
				<Icon name="refresh-cw" size={13} strokeWidth={2} />
			</button>
			<button
				class="btn btn-primary btn-sm"
				onclick={() => onRetryAll?.()}
				disabled={retryingAll || loading}
				title="Re-run all failed jobs"
				aria-label="Re-run all failed jobs"
			>
				<Icon name="refresh-cw" size={13} strokeWidth={2} />
				{retryingAll ? "Re-running…" : "Re-run all"}
			</button>
		</div>
	</div>

	<div class="mem-table-wrap">
		<table class="mem-table">
			<thead>
				<tr class="mem-thead-row">
					<th scope="col" class="mem-th" style="min-width:120px;">Entity</th>
					<th scope="col" class="mem-th" style="min-width:100px;">Status</th>
					<th scope="col" class="mem-th" style="width:90px;">Attempts</th>
					<th scope="col" class="mem-th" style="width:120px;">Enqueued</th>
					<th scope="col" class="mem-th" style="width:120px;">Processed</th>
					<th scope="col" class="mem-th" style="min-width:220px;">Last error</th>
					<th scope="col" class="mem-th" style="width:170px;">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					{#each { length: 5 } as _, i (i)}
						<tr>
							<td colspan="7" class="mem-td">
								<div class="skeleton" style="height:20px;border-radius:6px;"></div>
							</td>
						</tr>
					{/each}
				{:else if jobs.length === 0}
					<tr>
						<td colspan="7" class="mem-td" style="padding:0;border-bottom:none;">
							<EmptyState
								icon="circle-check"
								title="No failed jobs"
								description="Failed (poison) jobs will appear here for re-run or clearing."
							/>
						</td>
					</tr>
				{:else}
					{#each jobs as job, i (`${job.id}-${i}`)}
						<tr class="mem-row">
							<td class="mem-td">
								<div class="entity-cell">
									<span class="entity-kind">{job.entity_kind}</span>
									<span class="entity-id">{job.entity_id}</span>
								</div>
							</td>
							<td class="mem-td">
								<span
									class="status-pill"
									class:status-failed={job.status === "poison"}
									class:status-pending={job.status === "pending"}
								>
									{statusLabel(job.status)}
								</span>
							</td>
							<td class="mem-td" style="font-size:0.78rem;color:var(--color-text-muted);white-space:nowrap;">
								{job.attempts} / {job.max_attempts}
							</td>
							<td class="mem-td" style="font-size:0.75rem;color:var(--color-text-muted);white-space:nowrap;">
								{formatDate(job.enqueued_at)}
							</td>
							<td class="mem-td" style="font-size:0.75rem;color:var(--color-text-muted);white-space:nowrap;">
								{formatDate(job.processed_at)}
							</td>
							<td class="mem-td">
								<div class="truncate error-cell" title={job.last_error ?? ""}>
									{job.last_error || "—"}
								</div>
							</td>
							<td class="mem-td">
								<div class="row-actions">
									<button
										class="row-action-btn has-label retry-btn"
										onclick={() => onRetry?.(job)}
										disabled={busy?.id === job.id}
										title="Re-run job"
										aria-label={`Re-run queue job for ${job.entity_id}`}
									>
										<Icon name="refresh-cw" size={13} strokeWidth={2} />
										<span class="action-label">
											{busy?.id === job.id && busy?.action === "retry" ? "Re-running…" : "Re-run"}
										</span>
									</button>
									<button
										class="row-action-btn has-label delete-btn"
										onclick={() => onClear?.(job)}
										disabled={busy?.id === job.id}
										title="Clear job"
										aria-label={`Clear queue job for ${job.entity_id}`}
									>
										<Icon name="trash" size={13} strokeWidth={2} />
										<span class="action-label">
											{busy?.id === job.id && busy?.action === "clear" ? "Clearing…" : "Clear"}
										</span>
									</button>
								</div>
							</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<QueueJobCards {jobs} {loading} {busy} {statusLabel} {onRetry} {onClear} />

	<TablePagination {page} {totalPages} {totalItems} itemLabel="jobs" {loading} {onPageChange} />
</section>

<style>
	.queue-section {
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-surface, #fff);
		padding: 16px;
	}

	/* ── Table header ── */
	.table-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 12px;
	}

	.table-title {
		font-size: 0.92rem;
		font-weight: 850;
		color: var(--color-text);
	}

	.table-subtitle {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		font-weight: 600;
		margin-top: 2px;
	}

	.table-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	/* ── Entity cell ── */
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

	.entity-id {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 240px;
	}

	/* ── Status pill ── */
	.status-pill {
		border-radius: 999px;
		padding: 2px 8px;
		font-size: 0.67rem;
		text-transform: uppercase;
		font-weight: 850;
		border: 1px solid var(--color-border);
		display: inline-block;
	}

	.status-pending {
		color: #0369a1;
		background: rgba(14, 165, 233, 0.12);
	}

	.status-failed {
		color: #b91c1c;
		background: rgba(239, 68, 68, 0.12);
	}

	:global(html.dark) .status-failed {
		color: #fca5a5;
	}

	.error-cell {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		max-width: 320px;
	}

	.action-label {
		line-height: 1;
	}

	@media (max-width: 720px) {
		.queue-section {
			padding: 16px;
		}
		.table-header {
			align-items: stretch;
			flex-direction: column;
		}
		.table-actions,
		.table-actions .btn {
			width: 100%;
		}
		.table-actions .btn {
			justify-content: center;
		}
	}
</style>
