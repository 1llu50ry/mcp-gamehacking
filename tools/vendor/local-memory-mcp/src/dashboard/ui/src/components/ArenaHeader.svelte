<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import type { ArenaScene } from "../lib/arena/arenaTypes";

	let {
		loading = false,
		scene = null,
		error = null,
		repoCount = 0
	}: {
		loading?: boolean;
		scene?: ArenaScene | null;
		error?: string | null;
		repoCount?: number;
	} = $props();
</script>

<div class="arena-hdr">
	<div class="arena-hdr-left">
		<div class="arena-icon">
			<Icon name="cpu" size={16} strokeWidth={1.75} />
		</div>
		<div>
			<p class="arena-sub">Live view of agents and tasks across every workspace.</p>
		</div>
	</div>
	<div class="arena-hdr-right">
		{#if loading && !scene}
			<span class="badge loading">
				<span
					class="animate-spin"
					style="display:inline-block;width:10px;height:10px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%"
				></span>
				Loading…
			</span>
		{:else if error}
			<span class="badge error"><Icon name="alert-circle" size={11} /> Error</span>
		{:else if scene}
			<span class="badge live">
				<span class="pulse-dot"></span>
				Live &nbsp;·&nbsp;
				<strong>{scene.agents.size}</strong>&nbsp;{scene.agents.size === 1 ? "agent" : "agents"}
				&nbsp;·&nbsp;
				<strong>{scene.tasks.size}</strong>&nbsp;{scene.tasks.size === 1 ? "task" : "tasks"}
				{#if repoCount > 1}&nbsp;· {repoCount} repos{/if}
			</span>
		{/if}
	</div>
</div>

<style>
	.arena-hdr {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 20px;
		border-bottom: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.03);
	}

	.arena-hdr-left {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.arena-icon {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		box-shadow: 0 4px 12px var(--glow-primary);
		flex-shrink: 0;
	}

	.arena-sub {
		margin: 0;
		font-size: var(--text-secondary);
		color: var(--color-text-muted);
	}

	.arena-hdr-right {
		display: flex;
		align-items: center;
	}

	.badge {
		font-size: 0.7rem;
		font-weight: 700;
		padding: 4px 10px;
		border-radius: 999px;
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.badge.loading {
		color: var(--color-text-muted);
		background: rgba(100, 116, 139, 0.1);
	}
	.badge.error {
		color: #ef4444;
		background: rgba(239, 68, 68, 0.1);
	}
	.badge.live {
		color: #10b981;
		background: rgba(16, 185, 129, 0.1);
		border: 1px solid rgba(16, 185, 129, 0.2);
	}

	.pulse-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #10b981;
		animation: status-blink 1.8s ease-in-out infinite;
		flex-shrink: 0;
	}
</style>
