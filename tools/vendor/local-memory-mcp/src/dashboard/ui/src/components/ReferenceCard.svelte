<script lang="ts">
	import Icon from "../lib/Icon.svelte";

	export let type: "tool" | "prompt" | "resource" = "tool";
	export let name: string = "";
	export let description: string | undefined = undefined;
	/** Optional param names to display (tools show inputSchema params, resources show URI) */
	export let params: string[] | undefined = undefined;
	/** If there are more params beyond what's shown, display "+N" */
	export let moreCount: number | undefined = undefined;
	export let onClick: () => void = () => {};
	export let onKeydown: (e: KeyboardEvent) => void = () => {};

	const typeConfig: Record<string, { icon: string; label: string; cardClass: string }> = {
		tool: { icon: "tool", label: "Tool", cardClass: "ref-card-tool" },
		prompt: { icon: "sparkle", label: "Prompt", cardClass: "ref-card-prompt" },
		resource: { icon: "database", label: "Resource", cardClass: "ref-card-resource" }
	};
</script>

<div
	class="ref-card {typeConfig[type].cardClass} animate-fade-in"
	on:click={onClick}
	on:keydown={onKeydown}
	role="button"
	tabindex="0"
>
	<div class="ref-card-top">
		<span class="ref-type-badge ref-type-{type}">
			<Icon name={typeConfig[type].icon} size={10} strokeWidth={2} />
			{typeConfig[type].label}
		</span>
	</div>
	<div class="ref-card-name">{name || "Unknown " + typeConfig[type].label}</div>
	{#if description}
		<div class="ref-card-desc">{description}</div>
	{/if}
	{#if params && params.length > 0}
		<div class="ref-params">
			{#each params as param (param)}
				<code class="ref-param-tag">{param}</code>
			{/each}
			{#if moreCount !== undefined && moreCount > 0}
				<code class="ref-param-tag ref-param-more">+{moreCount}</code>
			{/if}
		</div>
	{/if}
</div>

<style>
	.ref-card {
		padding: 18px 20px;
		border-radius: 16px;
		border: 1px solid rgba(0, 0, 0, 0.06);
		background: #ffffff;
		box-shadow:
			0 4px 6px -1px rgba(0, 0, 0, 0.05),
			0 2px 4px -2px rgba(0, 0, 0, 0.03);
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
		display: flex;
		flex-direction: column;
		gap: 8px;
		cursor: pointer;
		position: relative;
		overflow: hidden;
	}

	.ref-card::before {
		content: "";
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		background: transparent;
		transition: all 0.2s ease;
	}

	.ref-card:hover {
		transform: translateY(-2px);
		box-shadow:
			0 12px 24px -4px rgba(0, 0, 0, 0.08),
			0 8px 12px -6px rgba(0, 0, 0, 0.04);
		border-color: rgba(0, 0, 0, 0.08);
	}

	:global(html.dark) .ref-card {
		background: rgba(10, 18, 38, 0.8);
		border: 1px solid rgba(255, 255, 255, 0.08);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
	}

	:global(html.dark) .ref-card:hover {
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
		border-color: rgba(255, 255, 255, 0.15);
	}

	.ref-card-tool:hover::before {
		background: linear-gradient(90deg, #6366f1, #a855f7);
	}
	.ref-card-prompt:hover::before {
		background: linear-gradient(90deg, #a855f7, #ec4899);
	}
	.ref-card-resource:hover::before {
		background: linear-gradient(90deg, #10b981, #3b82f6);
	}

	.ref-card-top {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.ref-type-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 3px 8px;
		border-radius: 9999px;
		border: 1px solid transparent;
	}

	/* WCAG AA: light-mode badge text darkened to clear 4.5:1 on its own tint. */
	:global(.ref-type-tool) {
		background: rgba(99, 102, 241, 0.1);
		color: #3730a3;
		border-color: rgba(99, 102, 241, 0.2);
	}

	:global(.ref-type-prompt) {
		background: rgba(168, 85, 247, 0.1);
		color: #6b21a8;
		border-color: rgba(168, 85, 247, 0.2);
	}

	:global(html.dark .ref-type-tool) {
		color: #818cf8;
	}
	:global(html.dark .ref-type-prompt) {
		color: #c084fc;
	}

	.ref-card-name {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--color-text);
		word-break: break-word;
	}

	.ref-card-desc {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		line-height: 1.55;
	}

	.ref-params {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 4px;
	}

	.ref-param-tag {
		font-family: "JetBrains Mono", "Fira Code", monospace;
		font-size: 0.72rem;
		background: rgba(14, 165, 233, 0.08);
		/* WCAG AA: #0ea5e9 on this tint measured 2.5:1 — darkened to pass 4.5:1. */
		color: #01607f;
		padding: 2px 6px;
		border-radius: 5px;
		border: 1px solid rgba(14, 165, 233, 0.18);
	}

	.ref-param-more {
		background: rgba(100, 116, 139, 0.1);
		color: var(--color-text-muted);
		border-color: rgba(100, 116, 139, 0.2);
	}

	:global(html.dark) .ref-param-tag {
		background: rgba(14, 165, 233, 0.12);
		color: #38bdf8;
		border-color: rgba(56, 189, 248, 0.2);
	}
</style>
