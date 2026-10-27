<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { currentRepo } from "../lib/stores";

	export let onNewMemory: () => void = () => {};
	export let onNewTask: () => void = () => {};

	let open = false;

	function toggle() {
		open = !open;
	}

	function handleNewMemory() {
		open = false;
		onNewMemory();
	}

	function handleNewTask() {
		open = false;
		onNewTask();
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Escape") open = false;
	}
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if $currentRepo}
	<!-- Backdrop -->
	{#if open}
		<div
			class="fab-backdrop"
			role="button"
			tabindex="-1"
			aria-label="Close menu"
			on:click={() => (open = false)}
			on:keydown={(e) => e.key === "Escape" && (open = false)}
		></div>
	{/if}

	<div class="fab-container" class:open>
		<!-- Sub-actions (appear above main FAB) -->
		<div class="fab-actions">
			<!-- New Task -->
			<div class="fab-action-item" style="transition-delay: {open ? '0.05s' : '0s'}">
				<span class="fab-action-label">New Task</span>
				<button
					class="fab-action-btn task"
					on:click={handleNewTask}
					title="Create new task"
					aria-label="Create new task"
				>
					<Icon name="clipboard-list" size={16} strokeWidth={2} />
				</button>
			</div>

			<!-- New Memory -->
			<div class="fab-action-item" style="transition-delay: {open ? '0.1s' : '0s'}">
				<span class="fab-action-label">New Memory</span>
				<button
					class="fab-action-btn memory"
					on:click={handleNewMemory}
					title="Create new memory"
					aria-label="Create new memory"
				>
					<Icon name="brain" size={16} strokeWidth={2} />
				</button>
			</div>
		</div>

		<!-- Main FAB trigger -->
		<button
			class="fab-main"
			on:click={toggle}
			title={open ? "Close" : "Quick create"}
			aria-label={open ? "Close quick create menu" : "Open quick create menu"}
			aria-expanded={open}
		>
			<span class="fab-icon" class:rotated={open}>
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<line x1="12" y1="5" x2="12" y2="19" />
					<line x1="5" y1="12" x2="19" y2="12" />
				</svg>
			</span>
		</button>
	</div>
{/if}

<style>
	.fab-backdrop {
		position: fixed;
		inset: 0;
		z-index: 49;
		background: transparent;
		cursor: default;
	}

	.fab-container {
		position: fixed;
		bottom: 28px;
		right: 28px;
		z-index: 50;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 10px;
	}

	/* ── Sub-actions list ── */
	.fab-actions {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 10px;
		/* hidden by default */
	}

	.fab-action-item {
		display: flex;
		align-items: center;
		gap: 10px;
		opacity: 0;
		transform: translateY(12px) scale(0.92);
		pointer-events: none;
		transition:
			opacity 0.2s ease,
			transform 0.2s ease;
	}

	.fab-container.open .fab-action-item {
		opacity: 1;
		transform: translateY(0) scale(1);
		pointer-events: auto;
	}

	.fab-action-label {
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--color-text);
		background: var(--color-surface, #fff);
		padding: 4px 10px;
		border-radius: 8px;
		border: 1px solid var(--color-border);
		backdrop-filter: blur(8px);
		white-space: nowrap;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
		letter-spacing: 0.01em;
	}

	:global(html.dark) .fab-action-label {
		background: rgba(15, 23, 42, 0.92);
		color: #e2e8f0;
	}

	/* ── Action buttons ── */
	.fab-action-btn {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		border: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease;
		flex-shrink: 0;
	}

	.fab-action-btn.memory {
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
	}

	.fab-action-btn.task {
		background: linear-gradient(135deg, #0ea5e9, #06b6d4);
		box-shadow: 0 4px 14px rgba(14, 165, 233, 0.4);
	}

	.fab-action-btn:hover {
		transform: scale(1.1);
	}

	.fab-action-btn.memory:hover {
		box-shadow: 0 6px 20px rgba(99, 102, 241, 0.55);
	}

	.fab-action-btn.task:hover {
		box-shadow: 0 6px 20px rgba(14, 165, 233, 0.55);
	}

	/* ── Main FAB ── */
	.fab-main {
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
		box-shadow:
			0 4px 20px rgba(14, 165, 233, 0.45),
			0 0 0 0 rgba(14, 165, 233, 0);
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease;
		flex-shrink: 0;
	}

	.fab-main:hover {
		transform: scale(1.08);
		box-shadow:
			0 6px 28px rgba(14, 165, 233, 0.6),
			0 0 0 0 rgba(14, 165, 233, 0);
	}

	.fab-main:active {
		transform: scale(0.96);
	}

	.fab-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.fab-icon.rotated {
		transform: rotate(45deg);
	}

	/* Pulse ring animation when closed */
	.fab-container:not(.open) .fab-main::after {
		content: "";
		position: absolute;
		inset: -4px;
		border-radius: 50%;
		border: 2px solid rgba(14, 165, 233, 0.4);
		animation: fab-pulse 2.4s ease-out infinite;
		pointer-events: none;
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

	/* Responsive: move up on mobile to avoid bottom nav overlap */
	@media (max-width: 640px) {
		.fab-container {
			bottom: max(18px, env(safe-area-inset-bottom));
			right: 14px;
		}

		.fab-main {
			width: 48px;
			height: 48px;
		}

		.fab-container:not(.open) .fab-main::after {
			display: none;
		}
	}
</style>
