<script lang="ts">
	import { createEventDispatcher } from "svelte";
	import Icon from "$lib/Icon.svelte";
	import { createFocusTrap } from "$lib/focusTrap";
	import type { KgEntityDetail } from "$lib/kg/kgEntityUtils";
	import KGEntityInfo from "./KGEntityInfo.svelte";
	import KGEntityRelations from "./KGEntityRelations.svelte";
	import KGEntityObservations from "./KGEntityObservations.svelte";

	export let show = false;
	export let loading = false;
	export let entity: KgEntityDetail | null = null;
	export let relations: Array<{
		from_entity: string;
		to_entity: string;
		relation_type: string;
	}> = [];
	export let observations: Array<{
		id: string;
		content: string;
		created_at: string;
	}> = [];
	export let error: string = "";

	const dispatch = createEventDispatcher<{
		close: void;
		navigateTo: { name: string };
	}>();

	function handleOverlayClick() {
		dispatch("close");
	}

	function handleClose() {
		dispatch("close");
	}

	function handleNavigate(name: string) {
		dispatch("navigateTo", { name });
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			dispatch("close");
		}
	}

	// ── Focus management (audit F4/F9 / TASK-272) ──────────────────────────
	let detailPanel: HTMLDivElement | undefined;
	let trapFocus: ReturnType<typeof createFocusTrap> | null = null;

	$: if (show && detailPanel) {
		requestAnimationFrame(() => {
			if (show && detailPanel) {
				trapFocus?.deactivate();
				trapFocus = createFocusTrap(detailPanel, { onEscape: handleClose });
				trapFocus.activate();
			}
		});
	} else if (!show) {
		trapFocus?.deactivate();
		trapFocus = null;
	}
</script>

<svelte:window on:keydown={handleKeydown} />

{#if show}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<div class="detail-overlay" on:click={handleOverlayClick} role="button" tabindex="-1" aria-label="Close panel"></div>

	<div class="detail-panel" bind:this={detailPanel} role="complementary" aria-label="Entity details" tabindex="-1">
		<!-- Close button -->
		<button class="close-btn" on:click={handleClose} aria-label="Close detail panel">
			<Icon name="x" size={16} strokeWidth={2} />
		</button>

		{#if loading}
			<div class="detail-loading">
				<div class="spinner"></div>
				<span>Loading entity…</span>
			</div>
		{:else if error}
			<div class="detail-error">
				<Icon name="alert-circle" size={18} strokeWidth={1.75} />
				<span>{error}</span>
			</div>
		{:else if entity}
			<div class="detail-scroll">
				<KGEntityInfo {entity} />

				<!-- Relations -->
				{#if relations.length > 0}
					<KGEntityRelations {relations} onNavigate={handleNavigate} />
				{/if}

				<!-- Observations -->
				{#if observations.length > 0}
					<KGEntityObservations {observations} />
				{/if}

				{#if relations.length === 0 && observations.length === 0}
					<div class="detail-empty">
						<Icon name="inbox" size={20} strokeWidth={1.5} />
						<span>No relations or observations yet.</span>
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.detail-overlay {
		position: absolute;
		inset: 0;
		background: rgba(1, 12, 30, 0.4);
		z-index: 40;
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		animation: fadeIn 0.2s ease-out;
	}

	.detail-panel {
		position: absolute;
		top: 0;
		right: 0;
		width: 340px;
		height: 100%;
		z-index: 41;
		background: var(--glass-bg-ultra);
		backdrop-filter: blur(28px) saturate(1.2);
		-webkit-backdrop-filter: blur(28px) saturate(1.2);
		border-left: 1px solid var(--glass-border);
		box-shadow: -8px 0 32px rgba(0, 0, 0, 0.15);
		display: flex;
		flex-direction: column;
		transform: translateX(100%);
		opacity: 0;
		transition:
			transform 0.28s cubic-bezier(0.16, 1, 0.3, 1),
			opacity 0.22s ease-out;
	}

	:global(.dark) .detail-panel {
		background: var(--panel-dark-ultra);
		border-left-color: var(--panel-dark-border);
		box-shadow: -8px 0 32px rgba(0, 0, 0, 0.45);
	}

	:global(.dark) .detail-overlay {
		background: rgba(1, 12, 30, 0.6);
	}

	/* Animate in when show=true — the panel is always rendered in DOM when show=true
	   because of the {#if show} block. We use a slight delay for the transform. */
	.detail-panel {
		animation: slideIn 0.28s cubic-bezier(0.16, 1, 0.3, 1) forwards;
	}

	@keyframes slideIn {
		from {
			transform: translateX(100%);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.close-btn {
		position: absolute;
		top: 12px;
		right: 12px;
		z-index: 2;
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.close-btn:hover {
		background: rgba(239, 68, 68, 0.12);
		color: #ef4444;
		border-color: rgba(239, 68, 68, 0.3);
	}

	:global(.dark) .close-btn {
		border-color: rgba(148, 163, 184, 0.12);
	}

	/* Loading & Error states */
	.detail-loading,
	.detail-error {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 48px 24px;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.82rem;
	}

	.detail-error {
		color: #ef4444;
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 2.5px solid var(--color-border);
		border-top-color: var(--color-text-muted);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Scrollable content */
	.detail-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 16px 18px 24px;
	}

	.detail-scroll::-webkit-scrollbar {
		width: 5px;
	}

	.detail-scroll::-webkit-scrollbar-track {
		background: transparent;
	}

	.detail-scroll::-webkit-scrollbar-thumb {
		background: var(--color-border);
		border-radius: 3px;
	}

	/* Empty state */
	.detail-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 32px 16px;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.8rem;
	}

	/* Responsive: narrower on small screens */
	@media (max-width: 480px) {
		.detail-panel {
			width: 100%;
		}
	}
</style>
