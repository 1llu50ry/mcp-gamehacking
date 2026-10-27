<script lang="ts">
	import Icon from "$lib/Icon.svelte";

	export let relations: Array<{
		from_entity: string;
		to_entity: string;
		relation_type: string;
	}> = [];
	export let onNavigate: (name: string) => void = () => {};

	function handleKeydown(e: KeyboardEvent, name: string) {
		if (e.key === "Enter") onNavigate(name);
	}
</script>

<div class="detail-section">
	<h3 class="section-title">
		<Icon name="link" size={13} strokeWidth={1.75} />
		Relations ({relations.length})
	</h3>
	<ul class="relation-list">
		{#each relations as rel, i (`${rel.from_entity}-${rel.to_entity}-${rel.relation_type}-${i}`)}
			<li class="relation-item">
				<span
					class="relation-entity"
					role="button"
					tabindex="0"
					on:click={() => onNavigate(rel.from_entity)}
					on:keydown={(e) => handleKeydown(e, rel.from_entity)}>{rel.from_entity}</span
				>
				<span class="relation-type-badge">{rel.relation_type}</span>
				<span
					class="relation-entity"
					role="button"
					tabindex="0"
					on:click={() => onNavigate(rel.to_entity)}
					on:keydown={(e) => handleKeydown(e, rel.to_entity)}>{rel.to_entity}</span
				>
			</li>
		{/each}
	</ul>
</div>

<style>
	.detail-section {
		padding: 12px 0;
	}

	.section-title {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0 0 10px;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.relation-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.relation-item {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 7px 10px;
		border-radius: 8px;
		background: rgba(148, 163, 184, 0.06);
		border: 1px solid var(--color-border);
		font-size: 0.78rem;
		color: var(--color-text);
		overflow: hidden;
	}

	:global(.dark) .relation-item {
		background: rgba(148, 163, 184, 0.04);
		border-color: rgba(148, 163, 184, 0.08);
	}

	.relation-entity {
		cursor: pointer;
		color: #60a5fa;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: color 0.15s;
		background: none;
		border: none;
		padding: 0;
	}

	.relation-entity:hover {
		color: #93c5fd;
		text-decoration: underline;
	}

	.relation-entity:focus-visible {
		outline: 2px solid #60a5fa;
		outline-offset: 2px;
		border-radius: 2px;
	}

	.relation-type-badge {
		flex-shrink: 0;
		padding: 1px 6px;
		border-radius: 4px;
		font-size: 0.66rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-text-muted);
		background: rgba(148, 163, 184, 0.1);
		border: 1px solid var(--color-border);
	}
</style>
