<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { formatDate } from "../lib/utils";
	import type { Handoff, TaskClaim } from "../lib/interfaces";
	import EmptyState from "./ui/EmptyState.svelte";

	export let handoffs: Handoff[] = [];
	export let loading = false;
	export let claims: TaskClaim[] = [];
	export let claimsLoading = false;
	export let releasingClaimId: string | null = null;
	export let onOpenViewDrawer: (handoff: Handoff) => void = () => {};
	export let onDeleteRow: (handoff: Handoff) => void = () => {};
	export let onReleaseClaim: (claim: TaskClaim) => void = () => {};
</script>

<!-- Table -->
<div class="mem-table-wrap">
	<table class="mem-table">
		<thead>
			<tr class="mem-thead-row">
				<th class="mem-th" style="min-width:140px;">From</th>
				<th class="mem-th" style="min-width:140px;">To</th>
				<th class="mem-th" style="min-width:100px;">Task</th>
				<th class="mem-th" style="min-width:200px;">Summary</th>
				<th class="mem-th" style="width:100px;">Status</th>
				<th class="mem-th" style="width:130px;">Created</th>
				<th class="mem-th" style="width:130px;">Expires</th>
				<th class="mem-th" style="width:60px;"></th>
			</tr>
		</thead>
		<tbody>
			{#if loading}
				{#each { length: 5 } as _, i (i)}
					<tr>
						<td colspan="8" class="mem-td">
							<div class="skeleton" style="height:20px;border-radius:6px;"></div>
						</td>
					</tr>
				{/each}
			{:else if handoffs.length === 0}
				<tr>
					<td colspan="8" class="mem-td" style="padding:0;border-bottom:none;">
						<EmptyState
							icon="git-branch"
							title="No handoffs found"
							description="Create a handoff when work needs context transfer between agents."
						/>
					</td>
				</tr>
			{:else}
				{#each handoffs as handoff, i (`${handoff.id}-${i}`)}
					<tr
						class="mem-row"
						on:click={() => onOpenViewDrawer(handoff)}
						role="button"
						tabindex="0"
						on:keydown={(e) => e.key === "Enter" && onOpenViewDrawer(handoff)}
					>
						<td class="mem-td" style="font-size:0.82rem;color:var(--color-text);font-weight:600;">
							{handoff.from_agent}
						</td>
						<td class="mem-td" style="font-size:0.82rem;color:var(--color-text);">
							{handoff.to_agent || "—"}
						</td>
						<td class="mem-td" style="font-size:0.75rem;color:var(--color-text-muted);">
							{handoff.task_code || handoff.task_id?.slice(0, 8) || "—"}
						</td>
						<td class="mem-td" style="max-width:300px;">
							<div class="truncate font-semibold" style="font-size:0.82rem;color:var(--color-text);">
								{handoff.summary}
							</div>
						</td>
						<td class="mem-td">
							<span
								class="status-pill"
								class:status-pending={handoff.status === "pending"}
								class:status-accepted={handoff.status === "accepted"}
								class:status-rejected={handoff.status === "rejected"}
								class:status-expired={handoff.status === "expired"}>{handoff.status}</span
							>
						</td>
						<td class="mem-td" style="font-size:0.75rem;color:var(--color-text-muted);white-space:nowrap;">
							{formatDate(handoff.created_at)}
						</td>
						<td class="mem-td" style="font-size:0.75rem;color:var(--color-text-muted);white-space:nowrap;">
							{handoff.expires_at ? formatDate(handoff.expires_at) : "—"}
						</td>
						<td class="mem-td row-actions reveal-on-hover" on:click|stopPropagation>
							<button
								class="row-action-btn delete-btn"
								on:click={() => onDeleteRow(handoff)}
								title="Expire"
								aria-label="Expire handoff"
								disabled={handoff.status === "expired"}
							>
								<Icon name="trash" size={13} strokeWidth={2} />
							</button>
						</td>
					</tr>
				{/each}
			{/if}
		</tbody>
	</table>
</div>

<!-- Mobile handoff cards -->
<div class="handoff-cards" aria-label="Handoffs">
	{#if loading}
		{#each { length: 3 } as _, i (i)}
			<div class="handoff-card"><div class="skeleton" style="height:112px;border-radius:10px;"></div></div>
		{/each}
	{:else if handoffs.length === 0}
		<div class="mobile-empty">
			<EmptyState
				icon="git-branch"
				title="No handoffs found"
				description="Create one when unfinished work needs context transfer."
			/>
		</div>
	{:else}
		{#each handoffs as handoff (handoff.id)}
			<article class="handoff-card">
				<button
					class="card-main"
					on:click={() => onOpenViewDrawer(handoff)}
					aria-label={`Open handoff ${handoff.summary}`}
				>
					<div class="card-heading">
						<strong>{handoff.summary}</strong>
						<span
							class="status-pill"
							class:status-pending={handoff.status === "pending"}
							class:status-accepted={handoff.status === "accepted"}
							class:status-rejected={handoff.status === "rejected"}
							class:status-expired={handoff.status === "expired"}>{handoff.status}</span
						>
					</div>
					<div class="route-line">
						<span>{handoff.from_agent}</span><Icon name="chevron-right" size={14} /><span
							>{handoff.to_agent || "Unassigned"}</span
						>
					</div>
					<div class="card-meta">
						<span>{handoff.task_code || handoff.task_id?.slice(0, 8) || "No task"}</span><span
							>{formatDate(handoff.created_at)}</span
						>
					</div>
				</button>
				<button
					class="btn btn-ghost card-expire"
					on:click={() => onDeleteRow(handoff)}
					disabled={handoff.status === "expired"}>Expire</button
				>
			</article>
		{/each}
	{/if}
</div>

<!-- Claims section -->
<div class="claims-section">
	<div class="claims-header">
		<div class="section-label">Active Claims</div>
		<span class="toolbar-subtitle">{claims.length} active</span>
	</div>
	{#if claimsLoading}
		<div class="muted-state">Loading claims...</div>
	{:else if claims.length === 0}
		<EmptyState
			icon="check"
			title="No active claims"
			description="Claimed tasks will appear here so you can inspect or release them."
		/>
	{:else}
		<div class="claim-list">
			{#each claims as claim, i (`${claim.id}-${i}`)}
				<div class="claim-row">
					<div>
						<div class="row-title">{claim.task_code || claim.task_id}</div>
						<div class="row-meta">
							<span>{claim.agent}</span>
							<span>{claim.role}</span>
							<span>{formatDate(claim.claimed_at)}</span>
						</div>
					</div>
					<button
						class="btn btn-ghost btn-sm"
						disabled={releasingClaimId === claim.id}
						on:click={() => onReleaseClaim(claim)}
					>
						{releasingClaimId === claim.id ? "Releasing..." : "Release"}
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	/* ── Status pills ── */
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
	.status-accepted {
		color: #047857;
		background: rgba(16, 185, 129, 0.12);
	}
	.status-rejected {
		color: #b91c1c;
		background: rgba(239, 68, 68, 0.12);
	}
	.status-expired {
		color: #64748b;
		background: rgba(100, 116, 139, 0.12);
	}

	/* ── Claims section ── */
	.claims-section {
		border-radius: 14px;
		border: 1px solid var(--color-border);
		background: var(--color-surface, #fff);
		padding: 16px;
	}
	.claims-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 12px;
	}
	.toolbar-subtitle {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		font-weight: 600;
	}
	.claim-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.claim-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 12px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.04);
	}
	.row-title {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 4px;
	}
	.row-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		color: var(--color-text-muted);
		font-size: 0.72rem;
		font-weight: 600;
	}
	.muted-state {
		color: var(--color-text-muted);
		font-size: 0.85rem;
		padding: 24px 4px;
		text-align: center;
	}
	.handoff-cards {
		display: none;
	}

	@media (max-width: 720px) {
		.handoff-cards {
			display: grid;
			gap: var(--space-3);
		}
		.handoff-card {
			display: grid;
			gap: 8px;
			padding: var(--space-4);
			border: 1px solid var(--color-border);
			border-radius: var(--radius-lg);
			background: var(--color-surface);
		}
		.card-main {
			display: grid;
			gap: 12px;
			padding: 0;
			border: 0;
			background: transparent;
			color: inherit;
			text-align: left;
			cursor: pointer;
		}
		.card-heading {
			display: flex;
			align-items: flex-start;
			justify-content: space-between;
			gap: 12px;
		}
		.card-heading strong {
			font-size: 0.92rem;
			line-height: 1.4;
		}
		.route-line,
		.card-meta {
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: 8px;
			font-size: 0.78rem;
			color: var(--color-text-muted);
		}
		.card-meta {
			justify-content: space-between;
		}
		.card-expire {
			width: 100%;
		}
		.mobile-empty {
			display: grid;
			justify-items: center;
			gap: 8px;
			padding: 40px 20px;
			border: 1px solid var(--color-border);
			border-radius: var(--radius-lg);
			color: var(--color-text-muted);
			text-align: center;
		}
		.claim-row {
			align-items: stretch;
			flex-direction: column;
		}
		.claim-row .btn {
			width: 100%;
		}
	}
</style>
