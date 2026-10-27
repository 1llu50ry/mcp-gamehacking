<script lang="ts">
	import { availableRepos, currentRepo, orderedRepos, repoSearchQuery } from "../lib/stores";
	import { getRepoInitials } from "../lib/utils";
	import Icon from "../lib/Icon.svelte";
	import { EmptyState } from "./ui";

	/**
	 * WorkspaceSwitcher — a popover picker for the active repository.
	 *
	 * Structural change, not a restyle. Previously the repository list was a
	 * permanently-expanded pane occupying roughly half the sidebar height, with
	 * its own search box, pinned/all group headings and drag-to-reorder — for a
	 * value the user changes once or twice a session. It pushed navigation into
	 * a cramped strip and, on short viewports, below the fold.
	 *
	 * Now it is a single always-visible trigger showing the CURRENT workspace
	 * (the thing you actually need to know at all times), and the full list is
	 * one click away. Same store, same selection handler, same pinning data —
	 * only the disclosure changed.
	 */
	export let onSelect: (repo: string) => void = () => {};
	export let onTogglePin: (repo: string, e: Event) => void = () => {};
	export let collapsed = false;

	let open = false;
	let triggerEl: HTMLButtonElement;
	let panelEl: HTMLDivElement;

	function toggle() {
		open = !open;
		if (open) {
			// Focus the filter as soon as the panel exists so a keyboard user can
			// type straight away instead of tabbing through the list.
			queueMicrotask(() => panelEl?.querySelector("input")?.focus());
		}
	}

	function close() {
		open = false;
		triggerEl?.focus();
	}

	function choose(repo: string) {
		onSelect(repo);
		open = false;
	}

	function onWindowKeydown(e: KeyboardEvent) {
		if (e.key === "Escape" && open) close();
	}

	function onWindowClick(e: MouseEvent) {
		if (!open) return;
		const target = e.target as Node;
		if (panelEl?.contains(target) || triggerEl?.contains(target)) return;
		open = false;
	}

	$: allRepos = [...$orderedRepos.pinned, ...$orderedRepos.unpinned];
	$: pinnedNames = new Set($orderedRepos.pinned.map((item) => item.repo));
</script>

<svelte:window on:keydown={onWindowKeydown} on:click={onWindowClick} />

<div class="switcher" class:collapsed>
	<button
		class="switcher-trigger"
		class:collapsed
		bind:this={triggerEl}
		on:click|stopPropagation={toggle}
		aria-expanded={open}
		aria-haspopup="listbox"
		title={collapsed ? $currentRepo || "Select a workspace" : undefined}
	>
		<span class="switcher-avatar" aria-hidden="true">
			{$currentRepo ? getRepoInitials($currentRepo) : "—"}
		</span>
		{#if !collapsed}
			<span class="switcher-text">
				<span class="switcher-label">Workspace</span>
				<span class="switcher-value">{$currentRepo || "Select a workspace"}</span>
			</span>
			<span class="switcher-chevron" aria-hidden="true">
				<Icon name="chevron-down" size={14} strokeWidth={2} />
			</span>
		{/if}
	</button>

	{#if open}
		<div class="switcher-panel" bind:this={panelEl} role="dialog" aria-label="Choose a workspace">
			<div class="switcher-search">
				<span class="switcher-search-icon" aria-hidden="true">
					<Icon name="search" size={14} strokeWidth={2} />
				</span>
				<input
					class="form-input"
					type="text"
					placeholder="Filter workspaces…"
					aria-label="Filter workspaces"
					bind:value={$repoSearchQuery}
					autocomplete="off"
				/>
			</div>

			{#if allRepos.length > 0}
				<ul class="switcher-list" role="listbox" aria-label="Workspaces">
					{#each allRepos as item (item.repo)}
						<li>
							<div class="switcher-row" class:selected={$currentRepo === item.repo}>
								<button
									class="switcher-option"
									role="option"
									aria-selected={$currentRepo === item.repo}
									on:click={() => choose(item.repo)}
								>
									<span class="switcher-option-avatar" aria-hidden="true">{getRepoInitials(item.repo)}</span>
									<span class="switcher-option-name">{item.repo}</span>
									{#if $currentRepo === item.repo}
										<span class="switcher-check" aria-hidden="true">
											<Icon name="check" size={14} strokeWidth={2.5} />
										</span>
									{/if}
								</button>
								<button
									class="switcher-pin"
									class:pinned={pinnedNames.has(item.repo)}
									on:click={(e) => onTogglePin(item.repo, e)}
									aria-label={pinnedNames.has(item.repo) ? `Unpin ${item.repo}` : `Pin ${item.repo}`}
									title={pinnedNames.has(item.repo) ? "Unpin" : "Pin to top"}
								>
									<Icon name="star" size={13} strokeWidth={2} />
								</button>
							</div>
						</li>
					{/each}
				</ul>
			{:else if $availableRepos.length === 0}
				<EmptyState
					icon="folder"
					title="No workspaces yet"
					description="Index a repository with the codebase-index tool and it will appear here."
				/>
			{:else}
				<EmptyState icon="search" title="No matches" description="No workspace name matches that filter." />
			{/if}
		</div>
	{/if}
</div>

<style>
	.switcher {
		position: relative;
		padding: var(--space-3);
	}

	.switcher.collapsed {
		padding: var(--space-2);
	}

	.switcher-trigger {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		min-height: 44px;
		padding: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		cursor: pointer;
		text-align: left;
		transition:
			background-color 180ms ease-out,
			border-color 180ms ease-out;
	}

	.switcher-trigger:hover {
		background: var(--color-surface-hover);
		border-color: var(--color-border-strong);
	}

	.switcher-trigger.collapsed {
		justify-content: center;
		padding: var(--space-2) 0;
	}

	.switcher-avatar,
	.switcher-option-avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		flex-shrink: 0;
		border-radius: var(--radius-sm);
		background: var(--color-surface-hover);
		color: var(--color-text-muted);
		font-size: var(--text-label);
		font-weight: var(--weight-semibold);
	}

	.switcher-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}

	.switcher-label {
		font-size: var(--text-label);
		color: var(--color-text-faint);
		line-height: 1.2;
	}

	.switcher-value {
		font-size: var(--text-secondary);
		font-weight: var(--weight-medium);
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.switcher-chevron {
		color: var(--color-text-muted);
		flex-shrink: 0;
		display: inline-flex;
	}

	.switcher-panel {
		position: absolute;
		z-index: var(--z-overlay);
		top: calc(100% - var(--space-1));
		left: var(--space-3);
		right: var(--space-3);
		max-height: 60vh;
		overflow-y: auto;
		padding: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		box-shadow: var(--shadow-md);
	}

	.switcher-search {
		position: relative;
		margin-bottom: var(--space-2);
	}

	.switcher-search-icon {
		position: absolute;
		left: var(--space-3);
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-text-muted);
		display: flex;
		pointer-events: none;
	}

	.switcher-search :global(.form-input) {
		width: 100%;
		padding-left: var(--space-7);
	}

	.switcher-list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.switcher-row {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		border-radius: var(--radius-sm);
	}

	.switcher-row:hover,
	.switcher-row.selected {
		background: var(--color-surface-hover);
	}

	.switcher-option {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: 1;
		min-width: 0;
		min-height: 40px;
		padding: var(--space-2);
		border: none;
		background: transparent;
		cursor: pointer;
		text-align: left;
		border-radius: var(--radius-sm);
	}

	.switcher-option-name {
		flex: 1;
		min-width: 0;
		font-size: var(--text-secondary);
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.switcher-check {
		display: inline-flex;
		color: var(--color-primary);
		flex-shrink: 0;
	}

	.switcher-pin {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		min-height: 40px;
		border: none;
		background: transparent;
		color: var(--color-text-faint);
		cursor: pointer;
		border-radius: var(--radius-sm);
		flex-shrink: 0;
	}

	.switcher-pin:hover {
		color: var(--color-text);
	}

	.switcher-pin.pinned {
		color: var(--color-warning);
	}

	@media (pointer: coarse) {
		.switcher-option,
		.switcher-pin {
			min-height: 44px;
		}
	}
</style>
