<script lang="ts">
	import Icon from "$lib/Icon.svelte";
	import Markdown from "./Markdown.svelte";

	export let type: "action" | "mcp" = "action";
	export let badgeIcon: string = "";
	export let badgeLabel: string = "";
	export let badgeColor: string = "";
	export let badgeBgAlpha: string = "";
	export let mainText: string = "";
	export let subText: string = "";
	export let responseText: string = "";
	export let isLong: boolean = false;
	export let isExpanded: boolean = false;
	export let onToggleExpand: () => void = () => {};
</script>

{#if type === "action"}
	<div class="popup-bubble-row popup-bubble-right">
		<div class="popup-bubble-wrap">
			<div class="popup-chat-bubble popup-chat-bubble-action">
				<div class="popup-action-badge" style="color:{badgeColor};background:{badgeBgAlpha};">
					<Icon name={badgeIcon} size={8} strokeWidth={2.5} />
					<span>{badgeLabel}</span>
				</div>
				<div class="popup-action-main">{mainText}</div>
				{#if subText}<div class="popup-action-sub">{subText}</div>{/if}
			</div>
		</div>
	</div>
{:else if type === "mcp"}
	<div class="popup-bubble-row popup-bubble-left">
		<div class="popup-bubble-wrap">
			<div class="popup-chat-bubble popup-chat-bubble-mcp">
				<div class="popup-mcp-sender">MCP</div>
				<div
					class="popup-markdown"
					style={!isExpanded && isLong
						? "max-height:80px;overflow:hidden;mask-image:linear-gradient(to bottom,black 60%,transparent 100%);"
						: ""}
				>
					<Markdown content={responseText} />
				</div>
				{#if isLong}
					<button class="popup-read-more" on:click={onToggleExpand}>
						{isExpanded ? "Less" : "More"}
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.popup-bubble-row {
		display: flex;
		width: 100%;
	}

	.popup-bubble-right {
		justify-content: flex-end;
	}

	.popup-bubble-left {
		justify-content: flex-start;
	}

	.popup-bubble-wrap {
		max-width: 85%;
	}

	.popup-chat-bubble {
		padding: 6px 10px 6px;
		border-radius: 10px;
		font-size: 0.78rem;
		line-height: 1.35;
		box-shadow: 0 1px 0.5px rgba(0, 0, 0, 0.1);
		position: relative;
	}

	.popup-chat-bubble-action {
		background: #dcf8c6;
		color: #111b21;
	}

	:global(html.dark) .popup-chat-bubble-action {
		background: #056162;
		color: #e9edef;
	}

	.popup-chat-bubble-mcp {
		background: #ffffff;
		color: #111b21;
	}

	:global(html.dark) .popup-chat-bubble-mcp {
		background: #202c33;
		color: #e9edef;
	}

	.popup-action-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 1px 5px;
		border-radius: 3px;
		font-size: 0.55rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: 3px;
	}

	.popup-action-main {
		font-weight: 600;
		font-size: 0.78rem;
		word-break: break-word;
	}

	.popup-action-sub {
		font-size: 0.65rem;
		opacity: 0.6;
		margin-top: 1px;
	}

	.popup-mcp-sender {
		font-size: 0.62rem;
		font-weight: 800;
		color: #34b7f1;
		margin-bottom: 4px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.popup-markdown {
		font-size: 0.75rem;
		line-height: 1.45;
	}

	:global(.popup-markdown p) {
		margin: 0.3em 0;
	}

	.popup-read-more {
		background: transparent;
		border: none;
		color: #34b7f1;
		font-size: 0.65rem;
		font-weight: 700;
		cursor: pointer;
		padding: 2px 0;
		margin-top: 2px;
		display: block;
	}

	.popup-read-more:hover {
		text-decoration: underline;
	}
</style>
