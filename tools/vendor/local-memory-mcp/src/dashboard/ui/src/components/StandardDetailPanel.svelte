<script lang="ts">
	import type { DetailHandler } from "../lib/composables/useDetail";
	import { formatDate } from "../lib/utils";
	import Icon from "../lib/Icon.svelte";
	import Markdown from "./Markdown.svelte";

	export let handler: DetailHandler;
	export let onClose: () => void;
	export let onStandardUpdated: (standard: import("../lib/stores").CodingStandard) => void;
	export let onStandardDeleted: (id: string) => void;
	export let repo: string | null;
</script>

{#if $handler.standardError}
	<div
		style="border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:8px;padding:10px 12px;font-size:0.82rem;font-weight:700;margin-bottom:12px;"
	>
		{$handler.standardError}
	</div>
{/if}

{#if $handler.standardEditing}
	<div class="section-label" style="margin-bottom:12px;">
		{$handler.standard ? "Edit Standard" : "New Standard"}
	</div>
	<div class="std-form-grid">
		<label>
			<span class="std-field-label">Name *</span>
			<input class="form-input" placeholder="Error handling standard" bind:value={$handler.standardForm.name} />
		</label>
		<label>
			<span class="std-field-label">Context</span>
			<input class="form-input" placeholder="testing, security, routing" bind:value={$handler.standardForm.context} />
		</label>
		<label>
			<span class="std-field-label">Version</span>
			<input class="form-input" placeholder="1.0.0" bind:value={$handler.standardForm.version} />
		</label>
		<label>
			<span class="std-field-label">Language</span>
			<input class="form-input" placeholder="typescript, python" bind:value={$handler.standardForm.language} />
		</label>
		<label>
			<span class="std-field-label">Stack</span>
			<input class="form-input" placeholder="svelte, vite, express" bind:value={$handler.standardForm.stack} />
		</label>
		<label>
			<span class="std-field-label">Tags *</span>
			<input class="form-input" placeholder="frontend, linting" bind:value={$handler.standardForm.tags} />
		</label>
		<label>
			<span class="std-field-label">Parent ID</span>
			<input class="form-input" placeholder="Optional parent UUID" bind:value={$handler.standardForm.parent_id} />
		</label>
		<label>
			<span class="std-field-label">Metadata JSON</span>
			<input
				class="form-input"
				placeholder="JSON metadata (e.g., source:dashboard)"
				bind:value={$handler.standardForm.metadata}
			/>
		</label>
	</div>
	<label style="display:block;margin-top:12px;">
		<span class="std-field-label">Content *</span>
		<textarea
			class="form-textarea"
			style="min-height:120px;resize:vertical;font-family:'JetBrains Mono',monospace;font-size:0.82rem;"
			placeholder="Write the implementation rule in concise Markdown..."
			bind:value={$handler.standardForm.content}
		></textarea>
	</label>
	<div style="display:flex;gap:8px;margin-top:12px;">
		<button
			class="btn btn-primary"
			disabled={$handler.standardSaving || !$handler.standardForm.name.trim() || !$handler.standardForm.content.trim()}
			on:click={() => handler.saveStandard(onStandardUpdated, onClose, repo)}
		>
			<Icon name="check" size={14} strokeWidth={2} />
			{$handler.standardSaving ? "Saving..." : $handler.standard ? "Save Changes" : "Create Standard"}
		</button>
		<button class="btn btn-ghost" on:click={handler.cancelStandardEdit} disabled={$handler.standardSaving}
			>Cancel</button
		>
	</div>
{:else if $handler.standard}
	<div class="detail-header-row">
		<div style="flex:1;min-width:0;">
			<div class="drawer-title">{$handler.standard.title}</div>
			<div class="std-meta-row" style="margin-top:6px;">
				<span class="std-badge std-badge-context">{$handler.standard.context}</span>
				<span class="std-badge std-badge-version">v{$handler.standard.version}</span>
				<span
					class="std-badge"
					class:std-badge-global={$handler.standard.is_global}
					class:std-badge-repo={!$handler.standard.is_global}>{$handler.standard.is_global ? "Global" : "Repo"}</span
				>
				{#if $handler.standard.parent_id}
					<span class="std-badge std-badge-parent">child of {$handler.standard.parent_id}</span>
				{/if}
			</div>
		</div>
		<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
			<button class="btn btn-ghost btn-sm" on:click={handler.startStandardEdit}>
				<Icon name="edit" size={13} strokeWidth={2} />
				Edit
			</button>
			<button
				class="btn btn-ghost btn-sm"
				style="color:#ef4444;"
				disabled={$handler.standardDeleting}
				on:click={() => handler.deleteStandard(onStandardDeleted, onClose)}
			>
				<Icon name="trash" size={13} strokeWidth={2} />
				{$handler.standardDeleting ? "Deleting..." : "Delete"}
			</button>
		</div>
	</div>

	<div class="meta-grid" style="margin-bottom:16px;">
		{#each [{ label: "Language", val: $handler.standard.language || "any" }, { label: "Stack", val: $handler.standard.stack.length ? $handler.standard.stack.join(", ") : "—" }, { label: "Created", val: formatDate($handler.standard.created_at) }, { label: "Updated", val: formatDate($handler.standard.updated_at) }] as m (m.label)}
			<div class="meta-cell">
				<div class="meta-label">{m.label}</div>
				<div class="meta-value">{m.val}</div>
			</div>
		{/each}
	</div>

	{#if $handler.standard.tags?.length}
		<div style="margin-bottom:16px;">
			<div class="section-label">Tags</div>
			<div style="display:flex;flex-wrap:wrap;gap:6px;">
				{#each $handler.standard.tags as tag (tag)}
					<span class="tag-chip">{tag}</span>
				{/each}
			</div>
		</div>
	{/if}

	<div>
		<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;">
			<span>Content</span>
			<button
				class="btn btn-ghost btn-icon"
				on:click={() => handler.handleCopyStandardContent($handler.standard?.content || "")}
				title="Copy to clipboard"
				aria-label="Copy standard content to clipboard"
				style="width:20px;height:20px;padding:0;border:none;background:transparent;"
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
			<Markdown content={$handler.standard?.content || ""} />
		</div>
	</div>

	{#if $handler.standard.metadata && Object.keys($handler.standard.metadata).length > 0}
		<div style="margin-top:16px;">
			<div class="section-label">Metadata</div>
			<pre class="json-pre">{JSON.stringify($handler.standard.metadata, null, 2)}</pre>
		</div>
	{/if}
{/if}

<style>
	.detail-header-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 16px;
	}
	.drawer-title {
		font-size: 1rem;
		font-weight: 700;
		color: var(--color-text);
		line-height: 1.3;
	}
	.std-meta-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.std-badge {
		font-size: 0.65rem;
		font-weight: 700;
		padding: 2px 8px;
		border-radius: 9999px;
		display: inline-block;
	}
	.std-badge-context {
		background: rgba(99, 102, 241, 0.1);
		color: #6366f1;
		border: 1px solid rgba(99, 102, 241, 0.2);
	}
	.std-badge-version {
		background: rgba(14, 165, 233, 0.1);
		color: #0ea5e9;
		border: 1px solid rgba(14, 165, 233, 0.2);
	}
	:global(.dark) .std-badge-global {
		background: rgba(168, 85, 247, 0.1);
		color: #a855f7;
		border: 1px solid rgba(168, 85, 247, 0.2);
	}
	:global(.dark) .std-badge-repo {
		background: rgba(14, 165, 233, 0.1);
		color: #0ea5e9;
		border: 1px solid rgba(14, 165, 233, 0.2);
	}
	.std-badge-global {
		background: rgba(168, 85, 247, 0.1);
		color: #a855f7;
		border: 1px solid rgba(168, 85, 247, 0.2);
	}
	.std-badge-repo {
		background: rgba(14, 165, 233, 0.1);
		color: #0ea5e9;
		border: 1px solid rgba(14, 165, 233, 0.2);
	}
	.std-badge-parent {
		background: rgba(139, 92, 246, 0.08);
		color: #8b5cf6;
		border: 1px solid rgba(139, 92, 246, 0.15);
	}
	.std-form-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.std-field-label {
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--color-text-muted);
		display: block;
		margin-bottom: 4px;
	}
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
