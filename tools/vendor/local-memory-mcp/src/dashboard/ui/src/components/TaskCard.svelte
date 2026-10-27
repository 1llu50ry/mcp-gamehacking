<script lang="ts">
	import type { Task } from "../lib/stores";
	import { formatDate } from "../lib/utils";
	import Icon from "../lib/Icon.svelte";
	import { priorityColors, statusIconMap, statusColors, cleanDesc } from "../lib/taskConfig";

	export let task: Task;
	export let selected: boolean = false;
	export let onToggleSelect: (() => void) | undefined = undefined;

	$: priorityColor = task ? priorityColors[task.priority] : "#94a3b8";
	$: statusIcon = task ? statusIconMap[task.status] : "circle-dot";
	$: statusColor = task ? statusColors[task.status] : "#94a3b8";
	$: descPreview = task ? cleanDesc(task.description ?? undefined) : "";
	$: coordination = task?.coordination;
</script>

<div class="task-card animate-fade-in" class:selected role="button" tabindex="0" on:click on:keydown>
	<!-- Priority top bar -->
	<div class="priority-bar" style="background:{priorityColor};"></div>

	<!-- Header row: status icon + code + phase chip -->
	<div class="card-header">
		<div class="code-row">
			{#if onToggleSelect}
				<input
					type="checkbox"
					class="task-card-checkbox"
					checked={selected}
					on:change|stopPropagation={() => onToggleSelect?.()}
					on:click|stopPropagation
					on:keydown|stopPropagation
					on:dragstart|stopPropagation
					aria-label="Select task {task?.title || task?.task_code || ''}"
				/>
			{/if}
			<span class="status-icon-dot" style="color:{statusColor};">
				<Icon name={statusIcon} size={11} strokeWidth={2.5} />
			</span>
			{#if task}
				<span class="task-code-text">{task.task_code}</span>
			{/if}
		</div>
		{#if task.phase}
			<span class="phase-chip">{task.phase}</span>
		{/if}
		{#if task.owner}
			<span class="owner-badge" title="Owner: {task.owner}">{task.owner}</span>
		{:else}
			<span class="owner-badge owner-unknown" title="owner unknown (repo-only view)">unknown</span>
		{/if}
	</div>

	<!-- Title — always visible, max 2 lines -->
	<div class="task-title">{task?.title || "Untitled Task"}</div>

	<!-- Description preview — max 2 lines, stripped -->
	{#if descPreview}
		<div class="task-desc">{descPreview}</div>
	{/if}

	<!-- Hierarchy Badges -->
	{#if task.parent_code || task.depends_on_code}
		<div class="hierarchy-row">
			{#if task.parent_code}
				<span class="h-badge parent" title="Parent: {task.parent_code}">
					<Icon name="chevron-up" size={9} strokeWidth={2.5} />
					{task.parent_code}
				</span>
			{/if}
			{#if task.depends_on_code}
				<span class="h-badge depends" title="Depends on: {task.depends_on_code}">
					<Icon name="link" size={9} strokeWidth={2.5} />
					{task.depends_on_code}
				</span>
			{/if}
		</div>
	{/if}

	{#if coordination && (coordination.active_claim_count > 0 || coordination.pending_handoff_count > 0)}
		<div class="coordination-row">
			{#if coordination.active_claim_count > 0}
				<span class="coord-badge claim" title="Claimed by {coordination.active_claim_agent || 'agent'}">
					<Icon name="check" size={9} strokeWidth={2.5} />
					{coordination.active_claim_agent || coordination.active_claim_count + " claim"}
				</span>
			{/if}
			{#if coordination.pending_handoff_count > 0}
				<span class="coord-badge handoff" title={coordination.pending_handoff_summary || "Pending handoff"}>
					<Icon name="git-branch" size={9} strokeWidth={2.5} />
					{coordination.pending_handoff_to_agent || "handoff"}{coordination.pending_handoff_count > 1
						? ` +${coordination.pending_handoff_count - 1}`
						: ""}
				</span>
			{/if}
		</div>
	{/if}

	<!-- Footer: agent + time -->
	<div class="card-footer">
		{#if task.agent}
			<div class="agent-row">
				<div class="agent-avatar">
					<Icon name="bot" size={9} strokeWidth={2} />
				</div>
				<span class="agent-name">{task.agent}</span>
			</div>
		{:else}
			<span></span>
		{/if}
		<div class="time-row">
			<Icon name="clock" size={10} strokeWidth={2} />
			<span>{task ? formatDate(task.updated_at) : ""}</span>
		</div>
	</div>

	<!-- Token badge -->
	{#if task.est_tokens && task.est_tokens > 0}
		<div class="token-row">
			<span class="token-badge">
				<Icon name="cpu" size={9} strokeWidth={2} />
				~{task.est_tokens >= 1000 ? (task.est_tokens / 1000).toFixed(1) + "k" : task.est_tokens} tokens
			</span>
		</div>
	{/if}
</div>

<style>
	.priority-bar {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 2px;
		border-radius: 12px 12px 0 0;
		opacity: 0;
		transition: opacity 0.2s ease;
	}

	.task-card:hover .priority-bar {
		opacity: 1;
	}

	/* ── Header ── */
	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		margin-bottom: 7px;
	}

	.code-row {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		flex: 1;
	}

	.task-card-checkbox {
		width: 14px;
		height: 14px;
		cursor: pointer;
		accent-color: var(--color-accent);
		border-radius: 3px;
		margin: 0;
		flex-shrink: 0;
	}

	.status-icon-dot {
		display: inline-flex;
		flex-shrink: 0;
		opacity: 0.85;
	}

	.task-code-text {
		font-size: 0.64rem;
		font-weight: 700;
		color: var(--color-text-muted);
		font-family: "JetBrains Mono", monospace;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 110px;
	}

	/* ── Title ── */
	.task-title {
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--color-text);
		line-height: 1.35;
		margin-bottom: 4px;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	/* ── Description ── */
	.task-desc {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		line-height: 1.4;
		margin-bottom: 12px;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	/* ── Phase chip ── */
	.phase-chip {
		font-size: 0.58rem;
		background: rgba(99, 102, 241, 0.1);
		color: #6366f1;
		padding: 2px 6px;
		border-radius: 9999px;
		font-weight: 700;
		border: 1px solid rgba(99, 102, 241, 0.2);
		letter-spacing: 0.02em;
		white-space: nowrap;
		flex-shrink: 0;
	}

	:global(html.dark) .phase-chip {
		background: rgba(129, 140, 248, 0.15);
		color: #a5b4fc;
		border-color: rgba(129, 140, 248, 0.25);
	}

	.owner-badge {
		font-size: 0.58rem;
		padding: 2px 6px;
		border-radius: 9999px;
		font-weight: 600;
		background: rgba(148, 163, 184, 0.12);
		color: var(--color-text-muted);
		border: 1px solid rgba(148, 163, 184, 0.2);
		font-family: "JetBrains Mono", monospace;
		letter-spacing: 0.02em;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.owner-badge.owner-unknown {
		opacity: 0.6;
		font-style: italic;
	}

	/* ── Hierarchy ── */
	.hierarchy-row {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-bottom: 8px;
	}

	.coordination-row {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-bottom: 8px;
	}

	.h-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 0.58rem;
		padding: 1px 6px;
		border-radius: 4px;
		font-weight: 700;
		font-family: "JetBrains Mono", monospace;
	}

	.h-badge.parent {
		background: rgba(16, 185, 129, 0.1);
		color: #10b981;
		border: 1px solid rgba(16, 185, 129, 0.2);
	}

	.h-badge.depends {
		background: rgba(245, 158, 11, 0.1);
		color: #f59e0b;
		border: 1px solid rgba(245, 158, 11, 0.2);
	}

	.coord-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 0.58rem;
		padding: 1px 6px;
		border-radius: 4px;
		font-weight: 700;
		font-family: "JetBrains Mono", monospace;
	}

	.coord-badge.claim {
		background: rgba(16, 185, 129, 0.1);
		color: #10b981;
		border: 1px solid rgba(16, 185, 129, 0.2);
	}

	.coord-badge.handoff {
		background: rgba(99, 102, 241, 0.1);
		color: #6366f1;
		border: 1px solid rgba(99, 102, 241, 0.2);
	}

	/* ── Footer ── */
	.card-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 8px;
	}

	.agent-row {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.agent-avatar {
		width: 18px;
		height: 18px;
		border-radius: 9999px;
		background: linear-gradient(135deg, #6366f1, #0ea5e9);
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		flex-shrink: 0;
	}

	.agent-name {
		font-size: 0.64rem;
		color: var(--color-text-muted);
		max-width: 80px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.time-row {
		display: flex;
		align-items: center;
		gap: 3px;
		color: var(--color-text-faint);
		font-size: 0.62rem;
	}

	/* ── Token badge ── */
	.token-row {
		margin-top: 6px;
	}

	.token-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 0.6rem;
		background: rgba(56, 189, 248, 0.1);
		color: #0ea5e9;
		border: 1px solid rgba(56, 189, 248, 0.2);
		padding: 2px 7px;
		border-radius: 9999px;
		font-weight: 600;
	}

	:global(html.dark) .token-badge {
		background: rgba(56, 189, 248, 0.12);
		color: #7dd3fc;
		border-color: rgba(56, 189, 248, 0.22);
	}
</style>
