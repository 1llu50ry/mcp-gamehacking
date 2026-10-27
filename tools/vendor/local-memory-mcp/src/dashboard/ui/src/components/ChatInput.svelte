<script lang="ts">
	import Icon from "$lib/Icon.svelte";

	export let value: string = "";
	export let disabled: boolean = false;
	export let onInput: (e: Event) => void = () => {};
	export let onSend: () => void = () => {};

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Enter" && !e.shiftKey) {
			onSend();
		}
	}
</script>

<div class="chat-input-row">
	<input
		type="text"
		placeholder="Create a backlog task..."
		{value}
		on:input={onInput}
		on:keydown={handleKeydown}
		{disabled}
	/>
	<button class="chat-send-btn" on:click={onSend} disabled={!value.trim() || disabled}>
		<Icon name="send" size={14} strokeWidth={2} />
	</button>
</div>

<style>
	.chat-input-row {
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--color-surface, #fff);
		border: 1px solid var(--color-border);
		border-radius: 20px;
		padding: 2px 2px 2px 14px;
		transition: border-color 0.15s ease;
	}

	:global(html.dark) .chat-input-row {
		background: rgba(6, 12, 28, 0.7);
		border-color: rgba(148, 163, 184, 0.15);
	}

	.chat-input-row:focus-within {
		border-color: var(--color-primary, #6366f1);
	}

	.chat-input-row input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: var(--color-text);
		font-size: 0.8rem;
		padding: 6px 0;
		font-family: inherit;
	}

	.chat-input-row input::placeholder {
		color: var(--color-text-muted);
		opacity: 0.6;
	}

	.chat-send-btn {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		border: none;
		background: linear-gradient(135deg, #0ea5e9, #6366f1);
		color: white;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: opacity 0.15s ease;
	}

	.chat-send-btn:hover:not(:disabled) {
		opacity: 0.9;
	}

	.chat-send-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
</style>
