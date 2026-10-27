<script lang="ts">
	import { createEventDispatcher } from "svelte";
	import Icon from "../lib/Icon.svelte";
	import { getRepoInitials } from "../lib/utils";
	import type { RepoMeta } from "../lib/stores";

	export let item: RepoMeta;
	export let draggable: boolean = false;
	export let pinned: boolean = false;
	export let selected: boolean = false;
	export let onSelect: () => void = () => {};
	export let onPin: (e: MouseEvent) => void = () => {};

	const dispatch = createEventDispatcher<{
		"drag:start": { repo: string; event: DragEvent };
		"drag:over": { repo: string; event: DragEvent };
		drop: { repo: string; event: DragEvent };
		"drag:end": { event: DragEvent };
	}>();

	function handleDragStart(e: DragEvent) {
		dispatch("drag:start", { repo: item.repo, event: e });
	}

	function handleDragOver(e: DragEvent) {
		dispatch("drag:over", { repo: item.repo, event: e });
	}

	function handleDrop(e: DragEvent) {
		dispatch("drop", { repo: item.repo, event: e });
	}

	function handleDragEnd(e: DragEvent) {
		dispatch("drag:end", { event: e });
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Enter" || e.key === " ") {
			onSelect();
		}
	}

	const hasTaskBadges =
		(item.inProgressCount || 0) + (item.pendingCount || 0) + (item.blockedCount || 0) + (item.backlogCount || 0) > 0;
</script>

<div
	class="repo-item"
	class:active={selected}
	role="button"
	tabindex="0"
	{draggable}
	on:click={onSelect}
	on:keydown={handleKeyDown}
	on:dragstart={draggable ? handleDragStart : undefined}
	on:dragover={draggable ? handleDragOver : undefined}
	on:drop={draggable ? handleDrop : undefined}
	on:dragend={draggable ? handleDragEnd : undefined}
	on:dragleave={draggable ? handleDragEnd : undefined}
	title="{item.repo} • {item.memoryCount} memories"
>
	{#if selected}
		<div class="repo-active-indicator"></div>
	{/if}
	<div class="repo-avatar">
		{getRepoInitials(item.repo)}
		{#if pinned}
			<span class="pin-star">★</span>
		{/if}
	</div>
	<div class="min-w-0 flex-1">
		<div class="truncate font-semibold" style="font-size:0.82rem;color:var(--color-text);">{item.repo}</div>
		<div
			class="truncate flex items-center gap-1"
			style="font-size:0.68rem;color:var(--color-text-muted);margin-bottom:2px;"
		>
			<Icon name="database" size={9} strokeWidth={2} />
			{item.memoryCount} memories
		</div>
		{#if hasTaskBadges}
			<div class="task-badges">
				{#if item.inProgressCount}
					<span class="task-badge active"><Icon name="zap" size={8} strokeWidth={2} /> {item.inProgressCount}</span>
				{/if}
				{#if item.pendingCount}
					<span class="task-badge todo"><Icon name="circle-dot" size={8} strokeWidth={2} /> {item.pendingCount}</span>
				{/if}
				{#if item.blockedCount}
					<span class="task-badge blocked"
						><Icon name="triangle-alert" size={8} strokeWidth={2} /> {item.blockedCount}</span
					>
				{/if}
				{#if item.backlogCount}
					<span class="task-badge backlog"><Icon name="archive" size={8} strokeWidth={2} /> {item.backlogCount}</span>
				{/if}
			</div>
		{/if}
	</div>
	<button
		class="pin-btn"
		on:click={onPin}
		title={pinned ? "Unpin" : "Pin"}
		aria-label={pinned ? "Unpin repository" : "Pin repository"}
	>
		<Icon name="pin" size={12} strokeWidth={1.75} />
	</button>
</div>

<style>
	.pin-star {
		position: absolute;
		top: -4px;
		right: -4px;
		font-size: 8px;
		background: #0ea5e9;
		border-radius: 9999px;
		width: 14px;
		height: 14px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		line-height: 1;
		box-shadow: 0 2px 6px rgba(14, 165, 233, 0.4);
	}

	.task-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
		margin-top: 4px;
	}

	.task-badge {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		font-size: 0.6rem;
		font-weight: 700;
		padding: 1px 5px;
		border-radius: 9999px;
		white-space: nowrap;
		border: 1px solid transparent;
		transition: all 0.15s ease;
	}

	.task-badge.active {
		background: rgba(168, 85, 247, 0.12);
		color: #a855f7;
		border-color: rgba(168, 85, 247, 0.25);
	}

	.task-badge.todo {
		background: rgba(14, 165, 233, 0.12);
		color: #0ea5e9;
		border-color: rgba(14, 165, 233, 0.25);
	}

	.task-badge.blocked {
		background: rgba(239, 68, 68, 0.12);
		color: #ef4444;
		border-color: rgba(239, 68, 68, 0.25);
	}

	.task-badge.backlog {
		background: rgba(100, 116, 139, 0.12);
		color: #64748b;
		border-color: rgba(100, 116, 139, 0.25);
	}

	:global(html.dark) .task-badge.active {
		background: rgba(168, 85, 247, 0.18);
		color: #c084fc;
	}

	:global(html.dark) .task-badge.todo {
		background: rgba(56, 189, 248, 0.18);
		color: #7dd3fc;
	}

	:global(html.dark) .task-badge.blocked {
		background: rgba(252, 165, 165, 0.18);
		color: #fca5a5;
	}

	:global(html.dark) .task-badge.backlog {
		background: rgba(148, 163, 184, 0.18);
		color: #94a3b8;
	}

	.pin-btn {
		opacity: 0;
		transition:
			opacity 0.15s ease,
			transform 0.15s ease,
			color 0.15s ease;
		color: var(--color-text-muted);
		padding: 5px;
		flex-shrink: 0;
		background: transparent;
		border: none;
		cursor: pointer;
		border-radius: 6px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.repo-item:hover .pin-btn {
		opacity: 1;
	}

	@media (hover: none), (max-width: 1024px) {
		.pin-btn {
			opacity: 1;
		}
	}

	.pin-btn:hover {
		color: #0ea5e9;
		transform: scale(1.15);
		background: rgba(14, 165, 233, 0.1);
	}
</style>
