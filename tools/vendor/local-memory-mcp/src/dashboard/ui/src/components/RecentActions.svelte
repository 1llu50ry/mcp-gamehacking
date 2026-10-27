<script lang="ts">
	import { onMount, afterUpdate, tick } from "svelte";
	import { createRecentActionsHandler } from "../lib/composables/useRecentActions";
	import Icon from "../lib/Icon.svelte";
	import Markdown from "./Markdown.svelte";

	export let onLoadPage: (page: number, append?: boolean) => Promise<unknown> = async () => {};

	const handler = createRecentActionsHandler(onLoadPage);
	const { groupedActions, recentActions, recentActionsPage } = handler;
	const handlerState = handler;

	let chatContainer: HTMLDivElement | undefined = undefined;
	let handleChatScroll: ((e: Event) => void) | undefined = undefined;

	afterUpdate(() => {
		// Only auto-scroll to bottom on INITIAL load (first page)
		if ($recentActionsPage <= 1 && !$handlerState.isLoadingMore && $recentActions.length > 0) {
			handler.scrollToBottom(chatContainer, "instant");
		}
	});

	onMount(() => {
		tick().then(() => {
			handler.scrollToBottom(chatContainer, "instant");
			if (chatContainer) {
				handleChatScroll = (e) => handler.handleScroll(e, chatContainer);
				chatContainer.addEventListener("scroll", handleChatScroll);
			}
		});

		return () => {
			if (chatContainer && handleChatScroll) {
				chatContainer.removeEventListener("scroll", handleChatScroll);
			}
		};
	});
</script>

<div class="chat-container-viewport" bind:this={chatContainer}>
	<div class="chat-container">
		{#if $handlerState.isLoadingMore}
			<div class="load-more-spinner">
				<Icon name="refresh-cw" size={14} className="animate-spin" />
				<span>Loading older history...</span>
			</div>
		{/if}

		{#if $recentActions.length === 0}
			<div style="text-align:center;padding:80px 20px;color:var(--color-text-muted);">
				<Icon name="activity" size={48} strokeWidth={1} />
				<div style="font-size:1rem;margin-top:16px;font-weight:600;">No activity found</div>
				<div style="font-size:0.875rem;opacity:0.7;">Events will appear here as they happen.</div>
			</div>
		{:else}
			{#each $groupedActions as group, i (`${group.date}-${i}`)}
				<div class="date-header">
					<span>{group.date}</span>
				</div>

				{#each group.items as action, i (`${action.id}-${i}`)}
					{@const label = handler.getLabel(action)}
					{@const cfg = handler.getConfig(action.action)}

					<!-- Action Row (Right/Agent) -->
					<div class="bubble-row bubble-row-right animate-slide-in-right">
						<div class="bubble-wrap">
							<div
								class="chat-bubble chat-bubble-action"
								style="--bubble-bg-light: #dcf8c6; --bubble-bg-dark: #056162;"
							>
								<div class="action-badge" style="color:{cfg.color};background:{cfg.bgAlpha};">
									<Icon name={cfg.icon} size={10} strokeWidth={2.5} />
									<span>{cfg.label}</span>
								</div>
								<div class="action-main">{label.main}</div>
								{#if label.sub}<div class="action-sub">{label.sub}</div>{/if}
								<div class="bubble-meta">
									<span class="bubble-time">{handler.formatTime(action.created_at)}</span>
									<span class="bubble-status"><Icon name="check" size={12} strokeWidth={2} /></span>
								</div>
							</div>
							<!-- Tail -->
							<div class="tail tail-right"></div>
						</div>
						<!-- Avatar -->
						<div class="chat-avatar agent-avatar">
							<Icon name="bot" size={14} strokeWidth={2} />
						</div>
					</div>

					{#if action.response}
						{@const parsed = handler.parseResponse(action.response)}
						{@const isExpanded = $handlerState.expandedResponses.has(action.id)}
						<!-- Response Row (Left/MCP) -->
						<div class="bubble-row bubble-row-left animate-slide-in-left">
							<!-- Avatar -->
							<div class="chat-avatar mcp-avatar">
								<Icon name="cpu" size={14} strokeWidth={2} />
							</div>
							<div class="bubble-wrap">
								<!-- Tail -->
								<div class="tail tail-left"></div>
								<div class="chat-bubble chat-bubble-mcp" style="--bubble-bg-light: #ffffff; --bubble-bg-dark: #202c33;">
									<div class="mcp-sender">MCP Node</div>
									<div
										class="markdown-body"
										style="font-size:0.82rem; {!isExpanded && parsed.isLong
											? 'max-height: 200px; overflow: hidden; mask-image: linear-gradient(to bottom, black 70%, transparent 100%);'
											: ''}"
									>
										<Markdown content={parsed.text} />
									</div>

									{#if parsed.isLong}
										<button class="read-more-btn" on:click={() => handler.toggleExpand(action.id)}>
											{isExpanded ? "Show less" : "Read more"}
										</button>
									{/if}

									<div class="bubble-meta">
										<span class="bubble-time">{handler.formatTime(action.created_at)}</span>
									</div>
								</div>
							</div>
						</div>
					{/if}
				{/each}
			{/each}
		{/if}
	</div>
</div>

<style>
	.chat-container-viewport {
		flex: 1;
		overflow-y: auto;
		padding: 24px 32px;
		background: rgba(0, 0, 0, 0.02);
		scroll-behavior: smooth;
		display: flex;
		flex-direction: column;
	}

	/* WhatsApp-like wallpaper pattern (subtle) */
	:global(html.dark) .chat-container-viewport {
		background-image: radial-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px);
		background-size: 20px 20px;
		background-color: #0b141a;
	}

	.chat-container {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding-bottom: 20px;
		min-height: min-content;
	}

	/* Date Header */
	.date-header {
		display: flex;
		justify-content: center;
		margin: 24px 0 12px;
		position: sticky;
		top: -12px;
		z-index: 10;
	}

	.date-header span {
		background: rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(8px);
		color: #54656f;
		font-size: 0.7rem;
		font-weight: 700;
		padding: 6px 14px;
		border-radius: 10px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		border: 1px solid rgba(0, 0, 0, 0.05);
	}

	:global(html.dark) .date-header span {
		background: #182229;
		color: #8696a0;
	}

	/* Bubble Rows */
	.bubble-row {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		margin-bottom: 4px;
		width: 100%;
	}

	.bubble-row-right {
		justify-content: flex-end;
	}

	.bubble-row-left {
		justify-content: flex-start;
	}

	.bubble-wrap {
		position: relative;
		max-width: 80%;
	}

	/* Bubbles */
	.chat-bubble {
		padding: 8px 10px 18px;
		border-radius: 12px;
		box-shadow: 0 1px 0.5px rgba(0, 0, 0, 0.13);
		position: relative;
		font-size: 0.875rem;
		line-height: 1.4;
		transition: transform 0.2s ease;
	}

	.chat-bubble-action {
		background: var(--bubble-bg-light);
		color: #111b21;
		border-top-right-radius: 0;
	}

	.chat-bubble-mcp {
		background: var(--bubble-bg-light);
		color: #111b21;
		border-top-left-radius: 0;
	}

	:global(html.dark) .chat-bubble-action {
		background: var(--bubble-bg-dark);
		color: #e9edef;
	}

	:global(html.dark) .chat-bubble-mcp {
		background: var(--bubble-bg-dark);
		color: #e9edef;
	}

	/* Tails */
	.tail {
		position: absolute;
		top: 0;
		width: 12px;
		height: 12px;
	}

	.tail-right {
		right: -8px;
		background: radial-gradient(circle at 100% 0, transparent 8px, #dcf8c6 8px);
	}

	.tail-left {
		left: -8px;
		background: radial-gradient(circle at 0% 0, transparent 8px, #ffffff 8px);
	}

	:global(html.dark) .chat-bubble-action {
		--bubble-bg-dark: #056162;
	}

	:global(html.dark) .tail-right {
		background: radial-gradient(circle at 100% 0, transparent 8px, #056162 8px);
	}

	:global(html.dark) .tail-left {
		background: radial-gradient(circle at 0% 0, transparent 8px, #202c33 8px);
	}

	/* Avatars */
	.chat-avatar {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	}

	.agent-avatar {
		background: linear-gradient(135deg, #0ea5e9, #6366f1);
		color: white;
	}

	.mcp-avatar {
		background: #f0f2f5;
		color: #54656f;
	}

	:global(html.dark) .mcp-avatar {
		background: #182229;
		color: #8696a0;
	}

	/* Content Styling */
	.action-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 6px;
		border-radius: 4px;
		font-size: 0.62rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 4px;
	}

	.action-main {
		font-weight: 600;
		color: inherit;
		word-break: break-word;
	}

	.action-sub {
		font-size: 0.75rem;
		opacity: 0.7;
		margin-top: 2px;
	}

	.mcp-sender {
		font-size: 0.72rem;
		font-weight: 800;
		color: #34b7f1;
		margin-bottom: 6px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.read-more-btn {
		background: transparent;
		border: none;
		color: #34b7f1;
		font-size: 0.75rem;
		font-weight: 700;
		cursor: pointer;
		padding: 4px 0;
		margin-top: 4px;
		display: block;
		width: 100%;
		text-align: left;
	}

	.read-more-btn:hover {
		text-decoration: underline;
	}

	/* Meta (Time & Status) */
	.bubble-meta {
		position: absolute;
		bottom: 4px;
		right: 7px;
		display: flex;
		align-items: center;
		gap: 3px;
		pointer-events: none;
	}

	.bubble-time {
		font-size: 0.65rem;
		color: #667781;
	}

	:global(html.dark) .bubble-time {
		color: rgba(255, 255, 255, 0.5);
	}

	.bubble-status {
		display: flex;
		color: #53bdeb; /* WhatsApp Blue Read Ticks */
	}

	.load-more-spinner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 12px;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
		opacity: 0.8;
	}

	/* Animations */
	@keyframes slideInRight {
		from {
			opacity: 0;
			transform: translateX(20px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	@keyframes slideInLeft {
		from {
			opacity: 0;
			transform: translateX(-20px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	.animate-slide-in-right {
		animation: slideInRight 0.3s ease-out forwards;
	}
	.animate-slide-in-left {
		animation: slideInLeft 0.3s ease-out forwards;
	}
</style>
