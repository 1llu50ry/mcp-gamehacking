<script lang="ts">
</script>

<div class="kg-container">
	<slot />
</div>

<style>
	.kg-container {
		display: flex;
		flex-direction: column;
		height: calc(100vh - 180px);
		border-radius: 24px;
		overflow: hidden;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		box-shadow: var(--glass-shadow);
		backdrop-filter: var(--glass-blur);
		-webkit-backdrop-filter: var(--glass-blur);
	}

	:global(.dark) .kg-container {
		background: var(--panel-dark);
		border-color: var(--panel-dark-border);
		box-shadow: var(--panel-dark-shadow);
	}

	:global(.kg-canvas-wrap) {
		flex: 1;
		overflow: hidden;
		position: relative;
	}

	:global(.kg-canvas-wrap.kg-hidden) {
		opacity: 0;
		pointer-events: none;
		position: absolute;
		inset: 0;
	}

	:global(.kg-canvas-wrap canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
