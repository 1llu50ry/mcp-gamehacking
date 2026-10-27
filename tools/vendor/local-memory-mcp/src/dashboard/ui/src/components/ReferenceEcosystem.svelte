<script lang="ts">
	import Icon from "../lib/Icon.svelte";

	export let items: Array<{
		name: string;
		description: string;
		url: string;
		icon: string;
	}> = [];
</script>

<div class="eco-section">
	<div class="ref-section-header">
		<Icon name="zap" size={13} strokeWidth={1.75} />
		<span>Ecosystem</span>
	</div>
	<div class="eco-grid">
		{#each items as item (item.name)}
			<a href={item.url} target="_blank" rel="noopener noreferrer" class="eco-card animate-fade-in">
				<div class="eco-card-icon">
					<Icon name={item.icon} size={18} strokeWidth={1.5} />
				</div>
				<div class="eco-card-body">
					<div class="eco-card-name">{item.name}</div>
					<div class="eco-card-desc">{item.description}</div>
				</div>
				<div class="eco-card-link">
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
						<polyline points="15 3 21 3 21 9" />
						<line x1="10" y1="14" x2="21" y2="3" />
					</svg>
				</div>
			</a>
		{/each}
	</div>
</div>

<style>
	.eco-section {
		margin-top: 28px;
		padding-top: 20px;
		border-top: 1px solid var(--color-border);
	}

	:global(html.dark) .eco-section {
		border-top-color: rgba(148, 163, 184, 0.1);
	}

	.ref-section-header {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--color-text-muted);
		margin-bottom: 10px;
	}

	.eco-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 10px;
	}

	.eco-card {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 16px;
		border-radius: 14px;
		border: 1px solid var(--color-border);
		background: var(--glass-bg);
		text-decoration: none;
		color: inherit;
		transition: all 0.2s ease;
		backdrop-filter: var(--glass-blur);
	}

	:global(html.dark) .eco-card {
		background: var(--panel-dark);
		border-color: var(--panel-dark-border);
	}

	.eco-card:hover {
		transform: translateY(-2px);
		border-color: rgba(14, 165, 233, 0.25);
		box-shadow:
			0 8px 24px rgba(14, 165, 233, 0.08),
			var(--glass-shadow-elevated);
	}

	:global(html.dark) .eco-card:hover {
		border-color: rgba(56, 189, 248, 0.25);
		box-shadow:
			0 8px 24px rgba(14, 165, 233, 0.12),
			var(--panel-dark-shadow);
	}

	.eco-card-icon {
		width: 38px;
		height: 38px;
		border-radius: 10px;
		background: linear-gradient(135deg, rgba(14, 165, 233, 0.12), rgba(99, 102, 241, 0.12));
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-primary);
		flex-shrink: 0;
	}

	.eco-card-body {
		flex: 1;
		min-width: 0;
	}

	.eco-card-name {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--color-text);
	}

	.eco-card-desc {
		font-size: 0.68rem;
		color: var(--color-text-muted);
		line-height: 1.45;
		margin-top: 2px;
	}

	.eco-card-link {
		color: var(--color-text-muted);
		opacity: 0.5;
		transition:
			opacity 0.2s,
			color 0.2s;
		flex-shrink: 0;
	}

	.eco-card:hover .eco-card-link {
		opacity: 1;
		color: var(--color-primary);
	}
</style>
