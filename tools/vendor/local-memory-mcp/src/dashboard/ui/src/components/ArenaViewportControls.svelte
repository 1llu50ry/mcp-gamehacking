<script lang="ts">
	let {
		zoomPercent,
		onzoomIn,
		onzoomOut,
		onresetView
	}: {
		zoomPercent: number;
		onzoomIn?: () => void;
		onzoomOut?: () => void;
		onresetView?: () => void;
	} = $props();
</script>

<div class="zoom-controls">
	<button class="zoom-btn" onclick={onzoomIn} title="Zoom in" aria-label="Zoom in">+</button>
	<button class="zoom-pct" onclick={onresetView} title="Reset view" aria-label="Reset view">{zoomPercent}%</button>
	<button class="zoom-btn" onclick={onzoomOut} title="Zoom out" aria-label="Zoom out">−</button>
</div>

<style>
	.zoom-controls {
		position: absolute;
		bottom: 12px;
		right: 12px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		z-index: 15;
		user-select: none;
	}
	.zoom-btn {
		width: 36px;
		height: 36px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-surface, rgba(30, 41, 59, 0.85));
		color: var(--color-text, #e2e8f0);
		font-size: 1rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		backdrop-filter: blur(8px);
		transition:
			background 0.15s,
			border-color 0.15s;
		padding: 0;
		line-height: 1;
	}
	.zoom-btn:hover {
		background: var(--color-border, rgba(148, 163, 184, 0.2));
		border-color: var(--color-primary, #8b5cf6);
	}
	.zoom-pct {
		width: 48px;
		height: 36px;
		border: 1px solid var(--color-border);
		border-radius: 4px;
		background: var(--color-surface, rgba(30, 41, 59, 0.7));
		color: var(--color-text-muted, #94a3b8);
		font-size: 0.6rem;
		font-weight: 700;
		font-family: "JetBrains Mono", monospace;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		backdrop-filter: blur(8px);
		transition: background 0.15s;
		padding: 0;
	}
	.zoom-pct:hover {
		background: var(--color-border, rgba(148, 163, 184, 0.2));
		color: var(--color-text, #e2e8f0);
	}
	:global(.reduced-transparency) .zoom-btn,
	:global(.reduced-transparency) .zoom-pct {
		backdrop-filter: none;
		background: var(--color-surface, #1e293b);
	}

	/* Local width/height here overrode the global coarse-pointer rule, so the
	   arena zoom controls stayed 36px on touch devices. */
	@media (pointer: coarse) {
		.zoom-btn {
			width: 44px;
			height: 44px;
		}
		.zoom-pct {
			height: 44px;
		}
	}
</style>
