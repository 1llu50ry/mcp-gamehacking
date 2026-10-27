<script lang="ts">
	import Icon from "$lib/Icon.svelte";

	export let totalEvents: number = 0;
	export let onClose: () => void = () => {};
</script>

<div class="chat-popup-header">
	<div class="chat-popup-title">
		<div class="chat-popup-avatar">
			<Icon name="message-circle" size={16} strokeWidth={2.2} />
		</div>
		<div>
			<div class="chat-popup-name">Recent Activity</div>
			<div class="chat-popup-status">{totalEvents} events</div>
		</div>
	</div>
	<button class="chat-popup-close" on:click={onClose} title="Close" aria-label="Close">
		<Icon name="x" size={16} strokeWidth={2.5} />
	</button>
</div>

<style>
	.chat-popup-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px;
		background: linear-gradient(135deg, #0ea5e9, #6366f1);
		color: white;
		flex-shrink: 0;
	}

	.chat-popup-title {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.chat-popup-avatar {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.2);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.chat-popup-name {
		font-size: 0.85rem;
		font-weight: 700;
		line-height: 1.2;
	}

	.chat-popup-status {
		font-size: 0.62rem;
		font-weight: 600;
		opacity: 0.8;
	}

	.chat-popup-close {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		border: none;
		background: rgba(255, 255, 255, 0.2);
		color: white;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.2s;
		flex-shrink: 0;
	}

	.chat-popup-close:hover {
		background: rgba(255, 255, 255, 0.35);
	}
</style>
