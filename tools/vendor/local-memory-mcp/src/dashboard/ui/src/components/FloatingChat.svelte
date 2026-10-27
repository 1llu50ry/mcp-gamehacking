<script lang="ts">
	import { onMount, afterUpdate, tick } from "svelte";
	import { get } from "svelte/store";
	import Icon from "../lib/Icon.svelte";
	import { currentRepo, recentActions, recentActionsPage, recentActionsTotalItems, activeTab } from "../lib/stores";
	import { createRecentActionsHandler } from "../lib/composables/useRecentActions";
	import { createChatTask } from "../lib/utils";
	import ChatHeader from "./ChatHeader.svelte";
	import ChatMessage from "./ChatMessage.svelte";
	import ChatInput from "./ChatInput.svelte";
	import { loadPage as loadPageUtil } from "../lib/chatUtils";

	export let onRefresh: () => void = () => {};

	let open = false;
	let chatMessage = "";
	let isSending = false;
	let chatContainer: HTMLDivElement | undefined;

	async function loadPage(page: number, append?: boolean) {
		await loadPageUtil(page, append);
	}

	const handler = createRecentActionsHandler(loadPage);
	const { groupedActions, recentActions: actionsStore, recentActionsPage: actionsPage } = handler;

	afterUpdate(() => {
		const p = $actionsPage;
		if (open && p <= 1 && !$handler.isLoadingMore && $actionsStore.length > 0) {
			handler.scrollToBottom(chatContainer, "instant");
		}
	});

	onMount(() => {
		return () => {
			recentActions.set([]);
			recentActionsPage.set(1);
		};
	});

	function toggle() {
		open = !open;
		if (open) {
			loadPage(1);
			tick().then(() => handler.scrollToBottom(chatContainer, "instant"));
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Escape") open = false;
	}

	async function sendChat() {
		const msg = chatMessage.trim();
		if (!msg || isSending) return;
		const repo = get(currentRepo);
		if (!repo) return;
		isSending = true;
		try {
			await createChatTask(msg, repo);
			chatMessage = "";
			await loadPage(1);
			onRefresh();
			tick().then(() => handler.scrollToBottom(chatContainer, "instant"));
		} catch (e) {
			console.error("Failed to create task:", e);
		} finally {
			isSending = false;
		}
	}

	function onChatInput(e: Event) {
		chatMessage = (e.target as HTMLInputElement).value;
	}
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if $currentRepo}
	<!-- TASK-273 / audit F5: the chat FAB (position:fixed, z-index 50) sat on
	     top of the Arena tab's zoom controls (bottom-right of the viewport), so
	     elementFromPoint at the zoom-in button returned the chat-fab and real
	     mouse clicks hit the FAB — the user could not zoom in with the mouse.
	     Resolution: hide the FAB (and its popup, only reachable via the FAB)
	     while the Arena tab is active so pointer events reach the zoom controls;
	     the FAB stays reachable on every other tab. -->
	{#if $activeTab !== "arena"}
		{#if open}
			<div
				class="chat-backdrop"
				on:click={() => (open = false)}
				on:keydown={(e) => e.key === "Enter" && (open = false)}
				role="button"
				tabindex="-1"
				aria-label="Close"
			></div>
			<div class="chat-popup animate-fade-in-scale">
				<ChatHeader totalEvents={$recentActionsTotalItems} onClose={() => (open = false)} />

				<div class="chat-popup-body" bind:this={chatContainer}>
					{#if $handler.isLoadingMore}
						<div class="popup-load-more">
							<Icon name="refresh-cw" size={12} className="animate-spin" />
							<span>Loading older...</span>
						</div>
					{/if}

					{#if $actionsStore.length === 0}
						<div class="popup-empty">
							<Icon name="message-circle" size={36} strokeWidth={1} />
							<div>No activity yet</div>
							<div>Events appear here as they happen.</div>
						</div>
					{:else}
						{#each $groupedActions as group, i (`${group.date}-${i}`)}
							<div class="popup-date-header"><span>{group.date}</span></div>
							{#each group.items as action, i (`${action.id}-${i}`)}
								{@const label = handler.getLabel(action)}
								{@const cfg = handler.getConfig(action.action)}
								<ChatMessage
									type="action"
									badgeIcon={cfg.icon}
									badgeLabel={cfg.label}
									badgeColor={cfg.color}
									badgeBgAlpha={cfg.bgAlpha}
									mainText={label.main}
									subText={label.sub ?? ""}
								/>
								{#if action.response}
									{@const parsed = handler.parseResponse(action.response)}
									{@const isExpanded = $handler.expandedResponses.has(action.id)}
									<ChatMessage
										type="mcp"
										responseText={parsed.text}
										isLong={parsed.isLong}
										{isExpanded}
										onToggleExpand={() => handler.toggleExpand(action.id)}
									/>
								{/if}
							{/each}
						{/each}
					{/if}
				</div>

				<div class="chat-popup-footer">
					<ChatInput value={chatMessage} disabled={isSending} onInput={onChatInput} onSend={sendChat} />
				</div>
			</div>
		{:else}
			<button class="chat-fab" on:click={toggle} title="Open activity chat" aria-label="Open activity chat">
				<Icon name="message-circle" size={22} strokeWidth={2.2} />
			</button>
		{/if}
	{/if}
{/if}

<style>
	.chat-backdrop {
		position: fixed;
		inset: 0;
		z-index: 49;
		background: transparent;
		cursor: default;
	}

	.chat-fab {
		position: fixed;
		bottom: 28px;
		right: 28px;
		z-index: 50;
		width: 52px;
		height: 52px;
		border-radius: 50%;
		border: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		background: linear-gradient(135deg, #0ea5e9, #6366f1);
		box-shadow: 0 4px 20px rgba(14, 165, 233, 0.45);
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease;
		flex-shrink: 0;
	}

	.chat-fab::after {
		content: "";
		position: absolute;
		inset: -4px;
		border-radius: 50%;
		border: 2px solid rgba(14, 165, 233, 0.4);
		animation: fab-pulse 2.4s ease-out infinite;
		pointer-events: none;
	}

	.chat-fab:hover {
		transform: scale(1.08);
		box-shadow: 0 6px 28px rgba(14, 165, 233, 0.6);
	}

	@keyframes fab-pulse {
		0% {
			transform: scale(1);
			opacity: 0.7;
		}
		100% {
			transform: scale(1.45);
			opacity: 0;
		}
	}

	.chat-popup {
		position: fixed;
		bottom: 88px;
		right: 28px;
		z-index: 50;
		width: 380px;
		height: 560px;
		background: var(--color-surface, #fff);
		border-radius: 16px;
		box-shadow:
			0 8px 40px rgba(0, 0, 0, 0.18),
			0 4px 16px rgba(0, 0, 0, 0.1);
		border: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	:global(html.dark) .chat-popup {
		background: #0b141a;
		border-color: rgba(148, 163, 184, 0.12);
		box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
	}

	.chat-popup-body {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-height: 0;
		scroll-behavior: smooth;
	}

	:global(html.dark) .chat-popup-body {
		background-image: radial-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px);
		background-size: 20px 20px;
	}

	.popup-load-more {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 8px;
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--color-text-muted);
		opacity: 0.7;
	}

	.popup-empty {
		text-align: center;
		padding: 60px 16px;
		color: var(--color-text-muted);
	}

	.popup-empty div:first-of-type {
		font-size: 0.9rem;
		font-weight: 600;
		margin-top: 12px;
	}

	.popup-empty div:last-child {
		font-size: 0.75rem;
		opacity: 0.7;
		margin-top: 4px;
	}

	.popup-date-header {
		display: flex;
		justify-content: center;
		margin: 8px 0 4px;
	}

	.popup-date-header span {
		font-size: 0.62rem;
		font-weight: 700;
		color: var(--color-text-muted);
		background: rgba(255, 255, 255, 0.9);
		padding: 3px 10px;
		border-radius: 8px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border: 1px solid rgba(0, 0, 0, 0.05);
	}

	:global(html.dark) .popup-date-header span {
		background: #182229;
		color: #8696a0;
	}

	.chat-popup-footer {
		flex-shrink: 0;
		padding: 8px 12px;
		border-top: 1px solid var(--color-border);
		background: var(--glass-bg);
	}

	:global(html.dark) .chat-popup-footer {
		background: rgba(6, 12, 28, 0.7);
		border-top-color: rgba(148, 163, 184, 0.1);
	}

	@media (max-width: 640px) {
		.chat-fab {
			bottom: max(18px, env(safe-area-inset-bottom));
			right: 14px;
			width: 48px;
			height: 48px;
		}

		.chat-fab::after {
			display: none;
		}

		.chat-popup {
			right: 8px;
			bottom: 72px;
			width: calc(100vw - 16px);
			height: 55vh;
			max-height: 500px;
		}
	}
</style>
