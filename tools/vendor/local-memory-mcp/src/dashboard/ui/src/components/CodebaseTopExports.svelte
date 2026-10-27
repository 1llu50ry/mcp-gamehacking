<script lang="ts">
	import Icon from "../lib/Icon.svelte";

	interface TopExport {
		name: string;
		kind: string;
		file_path: string;
	}

	let {
		topLevelExports = []
	}: {
		topLevelExports: TopExport[];
	} = $props();
</script>

<!-- ─── Top-Level Exports (Enh 5) ─── -->
{#if topLevelExports.length > 0}
	<div class="overview-section">
		<div class="overview-section-label">
			<Icon name="package" size={12} strokeWidth={1.75} />
			Top-Level Exports
		</div>
		<div class="export-chips">
			{#each topLevelExports as exp (exp.name)}
				<button class="export-chip" title="{exp.kind}: {exp.name} — {exp.file_path}">
					<span class="export-kind">{exp.kind}</span>
					<span class="export-sep">:</span>
					<span class="export-name">{exp.name}</span>
				</button>
			{/each}
		</div>
	</div>
{/if}

<style>
	/* Top-level export chips */
	.export-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.export-chip {
		display: inline-flex;
		align-items: center;
		gap: 0;
		padding: 4px 8px;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.04);
		cursor: pointer;
		transition: all 0.12s ease;
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
	}

	.export-chip:hover {
		background: rgba(99, 102, 241, 0.1);
		border-color: rgba(99, 102, 241, 0.25);
	}

	.export-kind {
		font-size: 0.64rem;
		font-weight: 600;
		color: var(--color-primary);
		opacity: 0.8;
	}

	.export-sep {
		font-size: 0.64rem;
		color: var(--color-text-muted);
		opacity: 0.5;
		margin: 0 1px;
	}

	.export-name {
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--color-text);
	}
</style>
