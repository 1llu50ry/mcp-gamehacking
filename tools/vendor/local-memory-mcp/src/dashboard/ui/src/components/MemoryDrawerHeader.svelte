<script lang="ts">
	import type { Memory } from "../lib/stores";
	import Icon from "../lib/Icon.svelte";

	/** null = create mode */
	export let memory: Memory | null = null;
	export let isCreate = false;
	export let editing = false;
	export let deleting = false;
	export let form: { title: string };
	export let isEditing = false;
	export let onClose: () => void = () => {};
	export let onEdit: () => void = () => {};
	export let onDelete: () => void = () => {};
</script>

<div class="modal-header">
	<div class="modal-header-icon">
		<Icon name="brain" size={14} strokeWidth={2.2} />
	</div>
	<div style="flex:1;min-width:0;">
		{#if isEditing}
			<div class="modal-mode-label">{isCreate ? "New Memory" : "Edit Memory"}</div>
			<input class="form-input modal-title-input" placeholder="Memory title…" bind:value={form.title} />
		{:else if memory}
			<div class="modal-mode-label">View Memory</div>
			<div class="modal-title-text">{memory.title}</div>
		{/if}
	</div>

	<div class="modal-header-actions">
		{#if memory && !editing}
			<button class="btn btn-ghost btn-sm" on:click={onEdit} title="Edit memory">
				<Icon name="edit" size={13} strokeWidth={2} />
				Edit
			</button>
			<button class="btn btn-ghost btn-sm danger-btn" disabled={deleting} on:click={onDelete} title="Delete memory">
				<Icon name="trash" size={13} strokeWidth={2} />
				{deleting ? "Deleting…" : "Delete"}
			</button>
		{/if}
		<button class="modal-close-btn" on:click={onClose} aria-label="Close">
			<Icon name="x" size={14} strokeWidth={2.5} />
		</button>
	</div>
</div>

<style>
	.modal-header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 18px 20px 16px;
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.modal-header-icon {
		width: 34px;
		height: 34px;
		border-radius: 10px;
		background: linear-gradient(135deg, #6366f1, #a855f7);
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		flex-shrink: 0;
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
	}

	.modal-mode-label {
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--color-text-muted);
		margin-bottom: 4px;
	}

	.modal-title-input {
		font-size: 0.92rem;
		font-weight: 700;
		padding: 5px 10px;
		width: 100%;
	}

	.modal-title-text {
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--color-text);
		line-height: 1.3;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.modal-header-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
		margin-left: auto;
	}

	.danger-btn {
		color: #ef4444 !important;
	}

	.modal-close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 8px;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
		flex-shrink: 0;
	}

	.modal-close-btn:hover {
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
	}
</style>
