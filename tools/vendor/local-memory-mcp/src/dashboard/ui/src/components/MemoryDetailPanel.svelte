<script lang="ts">
	import type { DetailHandler } from "../lib/composables/useDetail";
	import { formatDate } from "../lib/utils";
	import Icon from "../lib/Icon.svelte";
	import Markdown from "./Markdown.svelte";

	export let handler: DetailHandler;
</script>

{#if $handler.memory}
	<div class="meta-grid" style="margin-bottom:16px;">
		{#each [{ label: "Owner", val: $handler.memory?.owner || $handler.memory?.scope?.owner || "unknown (repo-only view)" }, { label: "Importance", val: $handler.memory?.importance || 0 }, { label: "Hit Count", val: $handler.memory?.hit_count ?? 0 }, { label: "Created", val: formatDate($handler.memory?.created_at) }, { label: "Updated", val: formatDate($handler.memory?.updated_at) }] as m (m.label)}
			<div class="meta-cell">
				<div class="meta-label">{m.label}</div>
				<div class="meta-value">{m.val}</div>
			</div>
		{/each}
	</div>

	{#if $handler.memory.tags?.length}
		<div style="margin-bottom:16px;">
			<div class="section-label">Tags</div>
			<div style="display:flex;flex-wrap:wrap;gap:6px;">
				{#each $handler.memory.tags as tag (tag)}
					<span class="tag-chip">{tag}</span>
				{/each}
			</div>
		</div>
	{/if}

	<div>
		<div class="section-label" style="display:flex; justify-content:space-between; align-items:center;">
			<span>Content</span>
			<button
				class="btn btn-ghost btn-icon"
				on:click={() => handler.handleCopyContent($handler.memory?.content || "")}
				title="Copy to clipboard"
				aria-label="Copy memory content to clipboard"
				style="width:20px; height:20px; padding:0; border:none; background:transparent;"
			>
				<Icon
					name={$handler.contentCopied ? "check" : "copy"}
					size={12}
					strokeWidth={2}
					className={$handler.contentCopied ? "text-success" : ""}
				/>
			</button>
		</div>
		<div class="markdown-body md-card">
			<Markdown content={$handler.memory?.content || ""} />
		</div>
	</div>

	{#if $handler.memory.metadata && Object.keys($handler.memory.metadata).length > 0}
		<div style="margin-top:16px;">
			<div class="section-label">Metadata</div>
			<pre class="json-pre">{JSON.stringify($handler.memory.metadata, null, 2)}</pre>
		</div>
	{/if}
{/if}

<style>
	.meta-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.meta-cell {
		padding: 10px;
		background: rgba(241, 245, 249, 0.8);
		border-radius: 10px;
		border: 1px solid var(--color-border);
	}
	:global(.dark) .meta-cell {
		background: rgba(30, 41, 59, 0.8);
	}
	.meta-label {
		font-size: 0.65rem;
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
	.tag-chip {
		font-size: 0.72rem;
		background: rgba(99, 102, 241, 0.1);
		color: #6366f1;
		border: 1px solid rgba(99, 102, 241, 0.2);
		padding: 2px 10px;
		border-radius: 9999px;
	}
	.md-card {
		background: rgba(248, 250, 252, 0.8);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 16px;
	}
	:global(.dark) .md-card {
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
	:global(.dark) .json-pre {
		background: rgba(15, 23, 42, 0.8);
	}
</style>
