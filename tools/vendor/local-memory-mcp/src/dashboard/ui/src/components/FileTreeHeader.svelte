<script lang="ts">
	import Icon from "../lib/Icon.svelte";

	/** Whether all directories are expanded */
	export let allExpanded: boolean = false;
	/** Callback to toggle all expand/collapse */
	export let onToggleAll: () => void = () => {};
	/** Total number of files */
	export let fileCount: number = 0;
</script>

<div class="filetree-header">
	<div class="filetree-header-left">
		<Icon name="folder-tree" size={13} strokeWidth={1.75} />
		<span class="filetree-header-title">File Tree</span>
		<span class="filetree-header-count">{fileCount} files</span>
	</div>
	<button
		class="filetree-toggle-btn"
		on:click={onToggleAll}
		title={allExpanded ? "Collapse all" : "Expand all"}
		aria-label={allExpanded ? "Collapse all directories" : "Expand all directories"}
	>
		<Icon name={allExpanded ? "chevron-up" : "chevron-down"} size={11} strokeWidth={2.5} />
		<span>{allExpanded ? "Collapse" : "Expand"}</span>
	</button>
</div>

<style>
	.filetree-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		border-bottom: 1px solid var(--color-border);
	}

	.filetree-header-left {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.filetree-header-title {
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--color-text);
	}

	.filetree-header-count {
		font-size: 0.6rem;
		font-weight: 600;
		color: var(--color-text-muted);
		background: rgba(100, 116, 139, 0.1);
		padding: 1px 6px;
		border-radius: 9999px;
	}

	.filetree-toggle-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		/* Was 21px tall with 10.4px text — under the tap-target minimum and
		   below the readable floor used everywhere else in the dashboard. */
		min-height: 36px;
		padding: var(--space-2) var(--space-3);
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text-muted);
		font-size: var(--text-label);
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.filetree-toggle-btn:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--color-text);
		border-color: var(--color-primary);
	}

	@media (pointer: coarse) {
		.filetree-toggle-btn {
			min-height: 44px;
		}
	}
</style>
