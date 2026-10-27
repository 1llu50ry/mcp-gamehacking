<script lang="ts">
	import { getArenaLayoutManager } from "../lib/arena/arena-layout/ArenaLayoutManager";

	/**
	 * The five current arena sections — sourced from the shared layout manager
	 * so labels + colors always match the scene. Registry order (the manager's
	 * single source of truth), rendered in the same order as the arena rooms.
	 */
	const sections = getArenaLayoutManager().getDefinitions();
</script>

<div class="arena-footer">
	<div class="legend-row">
		{#each sections as s (s.id)}
			<div class="legend-item"><span class="lg-dot" style="background:{s.color}"></span>{s.label}</div>
		{/each}
	</div>
	<div class="legend-row">
		<div class="legend-item">
			<span class="lg-bubble"></span>Working agent
		</div>
		<div class="legend-item">
			<span class="lg-dash" style="border-color:#f59e0b"></span>Handoff beam
		</div>
		<div class="legend-item">
			<span class="lg-dash"></span>Claim link
		</div>
	</div>
</div>

<style>
	.arena-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 6px;
		padding: 8px 20px;
		border-top: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.02);
	}
	.legend-row {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}
	.legend-item {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 0.68rem;
		color: var(--color-text-muted);
		font-weight: 600;
	}
	.lg-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.lg-dash {
		display: inline-block;
		width: 18px;
		height: 0;
		border-top: 2px dashed rgba(99, 102, 241, 0.55);
		flex-shrink: 0;
	}
	.lg-bubble {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #a855f7;
		flex-shrink: 0;
		animation: status-blink 1.8s ease-in-out infinite;
	}
</style>
