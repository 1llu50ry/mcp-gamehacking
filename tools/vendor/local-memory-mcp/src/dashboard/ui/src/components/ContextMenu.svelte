<script lang="ts">
	import { createEventDispatcher, onMount, onDestroy } from "svelte";

	export let visible = false;
	export let x = 0;
	export let y = 0;
	export let entityType: "agent" | "task" | "repository" | null = null;
	export let entityId: string | null = null;

	const dispatch = createEventDispatcher<{
		action: { action: string; entityId: string; entityType: string };
		close: void;
	}>();

	interface MenuItem {
		label: string;
		icon: string;
		action: string;
		variant?: "default" | "danger" | "accent";
		shortcut?: string;
	}

	$: menuItems = buildMenuItems(entityType);

	function buildMenuItems(type: string | null): MenuItem[] {
		switch (type) {
			case "agent":
				return [
					{ label: "Focus Agent", icon: "◎", action: "focus", shortcut: "Enter" },
					{ label: "View Logs", icon: "▸", action: "view-logs" },
					{ label: "Assign Task...", icon: "+", action: "assign-task", variant: "accent" }
				];
			case "task":
				return [
					{ label: "View Details", icon: "▸", action: "view-details", shortcut: "Enter" },
					{ label: "Retry", icon: "↻", action: "retry", variant: "accent" },
					{ label: "Cancel", icon: "✕", action: "cancel", variant: "danger" },
					{ label: "Raise Priority", icon: "▲", action: "raise-priority" },
					{ label: "Copy ID", icon: "⊞", action: "copy-id" }
				];
			case "repository":
				return [
					{ label: "Focus Repository", icon: "◎", action: "focus", shortcut: "Enter" },
					{ label: "View Details", icon: "▸", action: "view-details" }
				];
			default:
				return [];
		}
	}

	function handleAction(action: string): void {
		if (entityId && entityType) {
			dispatch("action", { action, entityId, entityType });
		}
		dispatch("close");
	}

	function handleKeydown(e: KeyboardEvent): void {
		if (e.key === "Escape") {
			dispatch("close");
		}
	}

	function handleClickOutside(e: MouseEvent): void {
		const target = e.target as HTMLElement;
		if (!target.closest(".ctx-menu")) {
			dispatch("close");
		}
	}

	onMount(() => {
		document.addEventListener("click", handleClickOutside, true);
		document.addEventListener("keydown", handleKeydown, true);
	});

	onDestroy(() => {
		document.removeEventListener("click", handleClickOutside, true);
		document.removeEventListener("keydown", handleKeydown, true);
	});
</script>

{#if visible && entityType && entityId}
	<div
		class="ctx-menu glass"
		style="left:{Math.min(x, window.innerWidth - 200)}px;top:{Math.min(y, window.innerHeight - 180)}px"
		role="menu"
		tabindex="-1"
	>
		<div class="ctx-header">
			<span class="ctx-type">{entityType}</span>
			<span class="ctx-id">{entityId.length > 16 ? entityId.slice(0, 16) + "..." : entityId}</span>
		</div>
		<div class="ctx-divider"></div>
		{#each menuItems as item (item.action)}
			<button
				class="ctx-item ctx-{item.variant ?? 'default'}"
				role="menuitem"
				on:click|stopPropagation={() => handleAction(item.action)}
			>
				<span class="ctx-icon">{item.icon}</span>
				<span class="ctx-label">{item.label}</span>
				{#if item.shortcut}
					<span class="ctx-shortcut">{item.shortcut}</span>
				{/if}
			</button>
		{/each}
	</div>
{/if}

<style>
	.ctx-menu {
		position: fixed;
		z-index: 50;
		min-width: 170px;
		padding: 4px 0;
		border-radius: 10px;
		font-size: 0.75rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
		backdrop-filter: blur(16px);
		animation: ctx-appear 0.1s ease-out;
	}
	@keyframes ctx-appear {
		from {
			opacity: 0;
			transform: scale(0.95) translateY(-4px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}
	.ctx-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px 4px;
		font-size: 0.68rem;
		color: var(--color-text-muted);
	}
	.ctx-type {
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text);
	}
	.ctx-id {
		font-family: "JetBrains Mono", monospace;
		font-size: 0.64rem;
		opacity: 0.7;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ctx-divider {
		height: 1px;
		margin: 4px 8px;
		background: var(--color-border);
	}
	.ctx-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 12px;
		border: none;
		background: transparent;
		cursor: pointer;
		font-size: 0.73rem;
		color: var(--color-text);
		text-align: left;
		transition: background 0.1s;
		font-family: inherit;
	}
	.ctx-item:hover {
		background: rgba(148, 163, 184, 0.1);
	}
	.ctx-item:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: -2px;
	}
	.ctx-icon {
		width: 14px;
		text-align: center;
		font-size: 0.7rem;
		opacity: 0.65;
	}
	.ctx-label {
		flex: 1;
	}
	.ctx-shortcut {
		font-size: 0.6rem;
		color: var(--color-text-muted);
		opacity: 0.5;
		font-family: "JetBrains Mono", monospace;
	}
	.ctx-danger {
		color: #ef4444;
	}
	.ctx-danger:hover {
		background: rgba(239, 68, 68, 0.08);
	}
	.ctx-accent {
		color: var(--color-primary, #8b5cf6);
	}
	.ctx-accent:hover {
		background: rgba(139, 92, 246, 0.08);
	}
</style>
