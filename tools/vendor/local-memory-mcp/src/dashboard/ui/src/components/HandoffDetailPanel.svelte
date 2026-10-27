<script lang="ts">
	import type { DetailHandler } from "../lib/composables/useDetail";
	import { formatDate } from "../lib/utils";
	import Icon from "../lib/Icon.svelte";

	export let handler: DetailHandler;
	export let onClose: () => void;
	export let onHandoffCreated: () => void;
	export let onHandoffUpdated: () => void;
	export let repo: string;

	const handoffContextPlaceholder = '{"next_steps":["..."],"blockers":[],"remaining_work":"..."}';
</script>

{#if $handler.handoff && $handler.handoff.id === "__new__"}
	<div class="section-label" style="margin-bottom:12px;">New Handoff</div>
	{#if $handler.handoffError}
		<div class="error-box">{$handler.handoffError}</div>
	{/if}
	<div class="std-form-grid">
		<label>
			<span class="std-field-label">From agent *</span>
			<input class="form-input" placeholder="agent-a" bind:value={$handler.handoffForm.from_agent} />
		</label>
		<label>
			<span class="std-field-label">To agent</span>
			<input class="form-input" placeholder="recipient agent (optional)" bind:value={$handler.handoffForm.to_agent} />
		</label>
		<label>
			<span class="std-field-label">Task code</span>
			<input class="form-input" placeholder="TASK-123" bind:value={$handler.handoffForm.task_code} />
		</label>
	</div>
	<label style="display:block;margin-top:12px;">
		<span class="std-field-label">Summary *</span>
		<textarea
			class="form-textarea"
			style="min-height:80px;resize:vertical;"
			placeholder="What should the next agent know?"
			bind:value={$handler.handoffForm.summary}
		></textarea>
	</label>
	<label style="display:block;margin-top:12px;">
		<span class="std-field-label">Context JSON</span>
		<textarea
			class="form-textarea"
			style="min-height:80px;resize:vertical;font-family:'JetBrains Mono',monospace;font-size:0.82rem;"
			placeholder={handoffContextPlaceholder}
			bind:value={$handler.handoffForm.context}
		></textarea>
	</label>
	<div style="display:flex;gap:8px;margin-top:12px;">
		<button
			class="btn btn-primary"
			disabled={$handler.handoffCreating ||
				!$handler.handoffForm.from_agent.trim() ||
				!$handler.handoffForm.summary.trim()}
			on:click={() => handler.createHandoff(onHandoffCreated, repo)}
		>
			<Icon name="git-branch" size={14} strokeWidth={2} />
			{$handler.handoffCreating ? "Creating..." : "Create Handoff"}
		</button>
		<button class="btn btn-ghost" on:click={onClose} disabled={$handler.handoffCreating}>Cancel</button>
	</div>
{:else if $handler.handoff}
	{#if $handler.handoffError}
		<div class="error-box">{$handler.handoffError}</div>
	{/if}
	<div class="drawer-title" style="margin-bottom:14px;">{$handler.handoff.summary}</div>

	<div style="margin-bottom:16px;display:flex;flex-wrap:wrap;gap:8px;">
		<button
			class="btn action-accept"
			disabled={$handler.handoffUpdating || $handler.handoff.status !== "pending"}
			on:click={() => handler.updateHandoffStatus("accepted", onHandoffUpdated)}
		>
			Accept
		</button>
		<button
			class="btn btn-danger"
			disabled={$handler.handoffUpdating || $handler.handoff.status !== "pending"}
			on:click={() => handler.updateHandoffStatus("rejected", onHandoffUpdated)}
		>
			Reject
		</button>
		<button
			class="btn btn-ghost"
			disabled={$handler.handoffUpdating ||
				$handler.handoff.status === "expired" ||
				$handler.handoff.status === "accepted"}
			on:click={() => handler.updateHandoffStatus("expired", onHandoffUpdated)}
		>
			Mark Expired
		</button>
	</div>

	<div style="margin-bottom:16px;">
		<div class="section-label">Status</div>
		<span
			class="status-chip"
			class:status-pending={$handler.handoff.status === "pending"}
			class:status-accepted={$handler.handoff.status === "accepted"}
			class:status-rejected={$handler.handoff.status === "rejected"}
			class:status-expired={$handler.handoff.status === "expired"}
			style="font-size:0.85rem;padding:4px 10px;display:inline-block;"
		>
			{$handler.handoff.status.toUpperCase()}
		</span>
	</div>

	<div class="meta-grid" style="margin-bottom:16px;">
		{#each [{ label: "From", val: $handler.handoff.from_agent }, { label: "To", val: $handler.handoff.to_agent || "unassigned" }, { label: "Task", val: $handler.handoff.task_code || $handler.handoff.task_id || "—" }, { label: "Created", val: formatDate($handler.handoff.created_at) }, { label: "Updated", val: formatDate($handler.handoff.updated_at) }, { label: "Expires", val: $handler.handoff.expires_at ? formatDate($handler.handoff.expires_at) : "—" }] as m (m.label)}
			<div class="meta-cell">
				<div class="meta-label">{m.label}</div>
				<div class="meta-value">{m.val}</div>
			</div>
		{/each}
	</div>

	{#if $handler.handoff.context && Object.keys($handler.handoff.context).length > 0}
		<div>
			<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;">
				<span>Transfer Context</span>
				<button
					class="btn btn-ghost btn-icon"
					on:click={() => handler.handleCopyHandoffContext($handler.handoff?.context || {})}
					title="Copy to clipboard"
					aria-label="Copy handoff context to clipboard"
				>
					<Icon
						name={$handler.contentCopied ? "check" : "copy"}
						size={12}
						strokeWidth={2}
						className={$handler.contentCopied ? "text-success" : ""}
					/>
				</button>
			</div>
			<pre class="json-pre">{JSON.stringify($handler.handoff.context, null, 2)}</pre>
		</div>
	{/if}
{/if}

<style>
	.action-accept {
		background: var(--color-success);
		border-color: var(--color-success);
		color: white;
	}

	.action-accept:hover {
		filter: brightness(0.92);
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
	.drawer-title {
		font-size: 1rem;
		font-weight: 700;
		color: var(--color-text);
		line-height: 1.3;
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
