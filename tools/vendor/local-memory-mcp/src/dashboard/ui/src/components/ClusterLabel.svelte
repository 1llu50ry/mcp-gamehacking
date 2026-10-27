<script lang="ts">
	import Icon from "$lib/Icon.svelte";

	export let repoCount: number = 0;
	export let collapsed: boolean = true;
	export let onToggle: () => void = () => {};
</script>

<button class="cluster-header" on:click={onToggle}>
	<div class="header-left">
		<Icon name="folder" size={13} strokeWidth={1.75} />
		<span class="header-title">Repositories</span>
		<span class="repo-count">{repoCount}</span>
	</div>
	<Icon name={collapsed ? "chevron-up" : "chevron-down"} size={11} />
</button>

<style>
	.cluster-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 44px;
		padding: 10px 20px;
		background: rgba(255, 255, 255, 0.02);
		border: none;
		border-bottom: 1px solid var(--color-border);
		cursor: pointer;
		color: var(--color-text);
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		width: 100%;
		text-align: left;
		transition: background 0.2s ease;
	}

	.cluster-header:hover {
		background: rgba(255, 255, 255, 0.04);
		color: var(--color-primary);
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.header-title {
		color: var(--color-text-muted);
	}

	.cluster-header:hover .header-title {
		color: var(--color-text);
	}

	.repo-count {
		background: rgba(148, 163, 184, 0.12);
		/* WCAG AA (STD-002 / TASK-054): ensure >= 4.5:1 text contrast across themes.
		   Light theme uses --stat-sky (#0369a1 ~5.6:1), dark theme uses --stat-sky (#38bdf8 >= 4.5:1). */
		color: var(--stat-sky, #0369a1);
		font-size: 0.65rem;
		padding: 1px 6px;
		border-radius: 999px;
		font-weight: 800;
	}
</style>
