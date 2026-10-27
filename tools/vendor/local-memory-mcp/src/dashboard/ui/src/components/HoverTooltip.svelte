<script lang="ts">
	import { arenaStateManager } from "../lib/arena/arenaStateManager";

	export let entityType: "agent" | "task" | "repository" | null = null;
	export let entityId: string | null = null;
	export let position: { x: number; y: number } | null = null;

	const arenaStore = arenaStateManager.getStore();

	$: agentEntity = entityType === "agent" && entityId ? ($arenaStore.agents.get(entityId) ?? null) : null;
	$: taskEntity = entityType === "task" && entityId ? ($arenaStore.tasks.get(entityId) ?? null) : null;
	$: repoEntity = entityType === "repository" && entityId ? ($arenaStore.repositories.get(entityId) ?? null) : null;

	function formatTokens(n: number): string {
		if (n <= 0) return "0";
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
		return String(n);
	}
</script>

{#if position}
	<div
		class="hover-tooltip glass"
		style="left:{Math.min(position.x + 16, window.innerWidth - 260)}px;top:{Math.max(position.y - 12, 8)}px"
	>
		{#if agentEntity}
			{@const a = agentEntity}
			<div class="tt-header">
				<span class="tt-dot" style="background:{a.color}"></span>
				<span class="tt-name">{a.name}</span>
				{#if a.model}
					<span class="tt-badge">{a.model}</span>
				{/if}
			</div>
			<div class="tt-section">
				<div class="tt-row">
					<span class="tt-key">State</span>
					<span class="tt-val tt-state-{a.state}">{a.state.replace(/_/g, " ")}</span>
				</div>
				<div class="tt-row">
					<span class="tt-key">Health</span>
					<span class="tt-val tt-health-{a.health}">{a.health}</span>
				</div>
				{#if a.currentAction && a.currentAction !== "idle"}
					<div class="tt-row">
						<span class="tt-key">Action</span>
						<span class="tt-val">{a.currentAction}</span>
					</div>
				{/if}
				{#if a.currentTool}
					<div class="tt-row">
						<span class="tt-key">Tool</span>
						<span class="tt-val tt-mono">{a.currentTool}</span>
					</div>
				{/if}
			</div>
			{#if a.progress > 0}
				<div class="tt-section">
					<div class="tt-progress-row">
						<span class="tt-key">Progress</span>
						<div class="tt-progress-track">
							<div class="tt-progress-fill" style="width:{(a.progress * 100).toFixed(0)}%"></div>
						</div>
						<span class="tt-progress-pct">{(a.progress * 100).toFixed(0)}%</span>
					</div>
				</div>
			{/if}
			<div class="tt-section tt-telemetry">
				{#if a.confidence > 0}
					<div class="tt-row">
						<span class="tt-key">Confidence</span>
						<span>{(a.confidence * 100).toFixed(0)}%</span>
					</div>
				{/if}
				{#if a.tokenUsage > 0}
					<div class="tt-row">
						<span class="tt-key">Tokens</span>
						<span>{formatTokens(a.tokenUsage)}</span>
					</div>
				{/if}
				{#if a.tokenBurnRate > 0}
					<div class="tt-row">
						<span class="tt-key">Burn Rate</span>
						<span>{a.tokenBurnRate.toFixed(1)}/s</span>
					</div>
				{/if}
				{#if a.cost > 0}
					<div class="tt-row">
						<span class="tt-key">Cost</span>
						<span>${a.cost.toFixed(4)}</span>
					</div>
				{/if}
				{#if a.latency > 0}
					<div class="tt-row">
						<span class="tt-key">Latency</span>
						<span>{a.latency.toFixed(0)}ms</span>
					</div>
				{/if}
				{#if a.contextUsage > 0}
					<div class="tt-row">
						<span class="tt-key">Context</span>
						<span>{(a.contextUsage * 100).toFixed(0)}%</span>
					</div>
				{/if}
				{#if a.toolCalls > 0}
					<div class="tt-row">
						<span class="tt-key">Tool Calls</span>
						<span>{a.toolCalls}</span>
					</div>
				{/if}
				{#if a.memoryOps > 0}
					<div class="tt-row">
						<span class="tt-key">Memory Ops</span>
						<span>{a.memoryOps}</span>
					</div>
				{/if}
				{#if a.queueLength > 0}
					<div class="tt-row">
						<span class="tt-key">Queue</span>
						<span>{a.queueLength} waiting</span>
					</div>
				{/if}
			</div>
			<div class="tt-section">
				<div class="tt-row">
					<span class="tt-key">Tasks</span>
					<span>{a.claimedTaskIds.length}</span>
				</div>
				{#if a.repos.length > 0}
					<div class="tt-row">
						<span class="tt-key">Repos</span>
						<span class="tt-repos">{a.repos.map((r) => r.split("/").pop()).join(", ")}</span>
					</div>
				{/if}
			</div>
		{:else if taskEntity}
			{@const t = taskEntity}
			<div class="tt-header">
				<span
					class="tt-dot"
					style="background:{t.status === 'in_progress'
						? '#a855f7'
						: t.status === 'blocked'
							? '#ef4444'
							: t.status === 'pending'
								? '#0ea5e9'
								: '#64748b'}"
				></span>
				<span class="tt-name tt-mono">{t.taskCode}</span>
				<span class="tt-badge">{t.status.replace(/_/g, " ")}</span>
			</div>
			<div class="tt-title">{t.title}</div>
			<div class="tt-section">
				<div class="tt-row">
					<span class="tt-key">Priority</span>
					<span class="tt-val">P{t.priority}</span>
				</div>
				<div class="tt-row">
					<span class="tt-key">Type</span>
					<span class="tt-val">{t.taskType}</span>
				</div>
				{#if t.claimedByAgentId}
					<div class="tt-row">
						<span class="tt-key">Agent</span>
						<span class="tt-val">{t.claimedByAgentId}</span>
					</div>
				{/if}
				<div class="tt-row">
					<span class="tt-key">Repo</span>
					<span class="tt-repos">{t.repo.split("/").pop()}</span>
				</div>
			</div>
			{#if t.progress > 0}
				<div class="tt-section">
					<div class="tt-progress-row">
						<span class="tt-key">Progress</span>
						<div class="tt-progress-track">
							<div class="tt-progress-fill" style="width:{(t.progress * 100).toFixed(0)}%"></div>
						</div>
						<span class="tt-progress-pct">{(t.progress * 100).toFixed(0)}%</span>
					</div>
				</div>
			{/if}
			<div class="tt-section tt-telemetry">
				{#if t.retryCount > 0}
					<div class="tt-row">
						<span class="tt-key">Retries</span>
						<span>{t.retryCount}/{t.maxRetries}</span>
					</div>
				{/if}
				{#if t.tokenCost > 0}
					<div class="tt-row">
						<span class="tt-key">Tokens</span>
						<span>{formatTokens(t.tokenCost)}</span>
					</div>
				{/if}
				{#if t.blockedReason}
					<div class="tt-row">
						<span class="tt-key">Blocked</span>
						<span class="tt-val tt-blocked">{t.blockedReason}</span>
					</div>
				{/if}
				{#if t.failureReason}
					<div class="tt-row">
						<span class="tt-key">Failure</span>
						<span class="tt-val tt-blocked">{t.failureReason}</span>
					</div>
				{/if}
			</div>
		{:else if repoEntity}
			{@const r = repoEntity}
			<div class="tt-header">
				<span
					class="tt-dot"
					style="background:{r.health === 'healthy' ? '#22c55e' : r.health === 'degraded' ? '#eab308' : '#ef4444'}"
				></span>
				<span class="tt-name">{r.name}</span>
			</div>
			<div class="tt-section">
				<div class="tt-row">
					<span class="tt-key">Health</span>
					<span class="tt-val tt-health-{r.health}">{r.health}</span>
				</div>
				<div class="tt-row">
					<span class="tt-key">Agents</span>
					<span>{r.activeAgents}</span>
				</div>
				<div class="tt-row">
					<span class="tt-key">Tasks</span>
					<span>{r.tasksInProgress} active / {r.tasksPending} pending</span>
				</div>
				{#if r.tasksBlocked > 0}
					<div class="tt-row">
						<span class="tt-key">Blocked</span>
						<span class="tt-val tt-blocked">{r.tasksBlocked}</span>
					</div>
				{/if}
				{#if r.lockedFiles.length > 0}
					<div class="tt-row">
						<span class="tt-key">Locked</span>
						<span>{r.lockedFiles.length} files</span>
					</div>
				{/if}
				<div class="tt-row">
					<span class="tt-key">Utilization</span>
					<span>{r.utilizationPercent.toFixed(0)}%</span>
				</div>
				{#if r.recentFailures > 0}
					<div class="tt-row">
						<span class="tt-key">Failures</span>
						<span class="tt-val tt-blocked">{r.recentFailures}</span>
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.hover-tooltip {
		position: absolute;
		z-index: 30;
		padding: 10px 14px;
		border-radius: 12px;
		font-size: 0.75rem;
		min-width: 180px;
		max-width: 260px;
		pointer-events: none;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.22);
		backdrop-filter: blur(16px);
	}
	.tt-header {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 800;
		font-size: 0.82rem;
		color: var(--color-text);
		margin-bottom: 6px;
	}
	.tt-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.tt-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tt-title {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		margin-bottom: 6px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tt-badge {
		font-size: 0.6rem;
		color: var(--color-text-muted);
		background: rgba(100, 116, 139, 0.12);
		padding: 1px 6px;
		border-radius: 4px;
		font-weight: 600;
		margin-left: auto;
		flex-shrink: 0;
	}
	.tt-section {
		padding: 3px 0;
	}
	.tt-section + .tt-section {
		border-top: 1px solid rgba(148, 163, 184, 0.12);
	}
	.tt-telemetry {
		border-top: 1px solid rgba(148, 163, 184, 0.12);
	}
	.tt-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		padding: 1px 0;
		color: var(--color-text-muted);
		font-size: 0.72rem;
	}
	.tt-key {
		font-weight: 700;
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		opacity: 0.6;
		flex-shrink: 0;
	}
	.tt-val {
		font-weight: 600;
		text-align: right;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tt-mono {
		font-family: "JetBrains Mono", monospace;
		font-size: 0.68rem;
		max-width: 130px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tt-repos {
		font-size: 0.68rem;
		text-align: right;
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* Agent states */
	.tt-state-processing {
		color: #a855f7;
		font-weight: 700;
	}
	.tt-state-idle {
		color: #64748b;
	}
	.tt-state-claiming {
		color: #0ea5e9;
		font-weight: 700;
	}
	.tt-state-handoff_out {
		color: #f59e0b;
		font-weight: 700;
	}
	.tt-state-handoff_in {
		color: #10b981;
		font-weight: 700;
	}
	.tt-state-burnout {
		color: #ef4444;
		font-weight: 700;
	}
	.tt-state-blocked {
		color: #ef4444;
		font-weight: 700;
	}
	/* Health */
	.tt-health-healthy {
		color: #22c55e;
		font-weight: 700;
		text-transform: uppercase;
		font-size: 0.65rem;
	}
	.tt-health-degraded {
		color: #eab308;
		font-weight: 700;
		text-transform: uppercase;
		font-size: 0.65rem;
	}
	.tt-health-critical {
		color: #ef4444;
		font-weight: 700;
		text-transform: uppercase;
		font-size: 0.65rem;
	}
	.tt-health-offline {
		color: #9ca3af;
		font-weight: 700;
		text-transform: uppercase;
		font-size: 0.65rem;
	}
	.tt-blocked {
		color: #ef4444;
		font-weight: 700;
	}
	/* Progress bar */
	.tt-progress-row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 1px 0;
		color: var(--color-text-muted);
		font-size: 0.72rem;
	}
	.tt-progress-track {
		flex: 1;
		height: 4px;
		background: rgba(148, 163, 184, 0.2);
		border-radius: 9999px;
		overflow: hidden;
	}
	.tt-progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #3b82f6, #22c55e);
		border-radius: 9999px;
		transition: width 0.3s ease;
	}
	.tt-progress-pct {
		font-size: 0.65rem;
		font-weight: 700;
		min-width: 28px;
		text-align: right;
	}
</style>
