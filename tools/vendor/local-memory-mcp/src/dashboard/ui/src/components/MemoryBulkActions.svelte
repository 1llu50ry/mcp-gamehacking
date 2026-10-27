<script lang="ts">
	let {
		count = 0,
		onCancel = () => {},
		onArchive = () => {},
		onDelete = () => {}
	}: {
		count: number;
		onCancel?: () => void;
		onArchive?: () => void;
		onDelete?: () => void;
	} = $props();
</script>

<!-- Bulk Action Toolbar -->
{#if count > 0}
	<div class="bulk-actions-bar">
		<span><b>{count}</b> selected</span>
		<div style="width:12px;"></div>
		<button class="btn btn-sm" style="background:rgba(120,120,120,0.2);color:inherit;" onclick={onCancel}>Cancel</button
		>
		<button class="btn btn-sm" style="background:#52525b;color:white;border:none;" onclick={onArchive}>Archive</button>
		<button class="btn btn-sm btn-accent" style="background:#ef4444;color:white;border:none;" onclick={onDelete}
			>Delete</button
		>
	</div>
{/if}

<style>
	.bulk-actions-bar {
		position: fixed;
		bottom: 32px;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(30, 41, 59, 0.95);
		backdrop-filter: blur(12px);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 9999px;
		padding: 10px 16px;
		display: flex;
		align-items: center;
		gap: 8px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
		z-index: 1000;
		color: white;
		font-size: 0.85rem;
		animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
	}

	:global(html:not(.dark)) .bulk-actions-bar {
		background: rgba(255, 255, 255, 0.95);
		color: var(--color-text);
		border-color: var(--color-border);
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translate(-50%, 20px) scale(0.95);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 0) scale(1);
		}
	}
</style>
