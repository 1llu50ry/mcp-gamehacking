<script lang="ts">
	import type { Memory } from "$lib/stores";
	import { formatDate } from "$lib/utils";
	import Markdown from "./Markdown.svelte";
	import { TYPE_LABELS } from "$lib/memoryConfig";
	import type { MetaField } from "$lib/memoryDrawerUtils";

	export let memory: Memory | null = null;
	export let metaFields: MetaField[] = [];
	export let showMetadata = false;
</script>

{#if memory}
	<!-- Type chip -->
	<div style="margin-bottom:14px;">
		<span class="type-chip type-{memory.type}">{TYPE_LABELS[memory.type] || memory.type}</span>
	</div>

	<!-- Meta grid -->
	<div class="meta-grid">
		{#each metaFields as m (m.label)}
			<div class="meta-cell">
				<div class="meta-label">{m.label}</div>
				<div class="meta-value">
					{typeof m.val === "string" && (m.label === "Created" || m.label === "Updated") ? formatDate(m.val) : m.val}
				</div>
			</div>
		{/each}
	</div>

	<!-- Tags -->
	{#if memory.tags?.length}
		<div class="section-block">
			<div class="field-label">Tags</div>
			<div class="tags-row">
				{#each memory.tags as tag (tag)}
					<span class="tag-chip">{tag}</span>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Content -->
	<div class="section-block">
		<div class="field-label">Content</div>
		<div class="markdown-body md-card">
			<Markdown content={memory.content} />
		</div>
	</div>

	<!-- Metadata JSON -->
	{#if showMetadata}
		<div class="section-block">
			<div class="field-label">Metadata</div>
			<pre class="json-pre">{JSON.stringify(memory.metadata, null, 2)}</pre>
		</div>
	{/if}
{/if}

<style>
	/* ── View mode ── */
	.meta-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}

	.meta-cell {
		padding: 10px 12px;
		background: rgba(241, 245, 249, 0.8);
		border-radius: 10px;
		border: 1px solid var(--color-border);
	}

	:global(html.dark) .meta-cell {
		background: rgba(30, 41, 59, 0.8);
	}

	.meta-label {
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		margin-bottom: 2px;
	}

	.meta-value {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.field-label {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
	}

	.section-block {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.tags-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.tag-chip {
		font-size: 0.72rem;
		background: rgba(99, 102, 241, 0.1);
		color: #6366f1;
		border: 1px solid rgba(99, 102, 241, 0.2);
		padding: 2px 10px;
		border-radius: 9999px;
	}

	:global(html.dark) .tag-chip {
		background: rgba(99, 102, 241, 0.18);
		color: #a5b4fc;
		border-color: rgba(99, 102, 241, 0.3);
	}

	.md-card {
		background: rgba(248, 250, 252, 0.8);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 16px;
	}

	:global(html.dark) .md-card {
		background: rgba(15, 23, 42, 0.8);
	}

	.json-pre {
		font-size: 0.75rem;
		background: rgba(248, 250, 252, 0.8);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 12px;
		overflow-x: auto;
		color: var(--color-text);
		font-family: "JetBrains Mono", monospace;
	}

	:global(html.dark) .json-pre {
		background: rgba(15, 23, 42, 0.8);
	}
</style>
