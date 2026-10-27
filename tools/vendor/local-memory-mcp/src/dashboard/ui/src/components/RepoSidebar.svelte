<script lang="ts">
	import { currentRepo, isRepoSidebarCollapsed, activeTab } from "../lib/stores";
	import { NAV_GROUPS } from "../lib/navigation";
	import { createRepoSidebarHandler } from "../lib/composables/useRepoSidebar";
	import Icon from "../lib/Icon.svelte";
	import WorkspaceSwitcher from "./WorkspaceSwitcher.svelte";

	/**
	 * Sidebar — brand, workspace switcher, navigation. In that order.
	 *
	 * The previous order was brand → navigation → workspace search → a long
	 * scrolling repository list. That inverted the actual dependency: 8 of the
	 * 11 destinations require a workspace, so the user was offered the
	 * destinations first and the prerequisite last. Clicking "Memories" before
	 * choosing a repository landed on a dead-end "No Repository Selected"
	 * screen with no way forward from that screen.
	 *
	 * Two structural fixes:
	 * 1. The workspace switcher moves directly under the brand and collapses to
	 *    a popover, so navigation gets the vertical space instead of a
	 *    permanently-expanded repo list.
	 * 2. Workspace-scoped items are `disabled` while no workspace is selected,
	 *    with the reason stated inline. The dead end is now unreachable rather
	 *    than merely explained after the fact.
	 */
	export let onRepoSelect: (repo: string) => void = () => {};
	export let onTabSelect: (tab: string) => void = () => {};

	const handler = createRepoSidebarHandler(onRepoSelect);

	$: collapsed = $isRepoSidebarCollapsed;
	// `queue` is global by design (server-wide embedding/KG outbox — MEM-1457),
	// so it stays reachable without a workspace alongside dashboard/arena.
	//
	// Declared as a plain function, not `$: fn = (scope) => ...`. A reactive
	// assignment holding a function re-creates the closure on every store tick
	// and re-runs every call site with it, for a pure predicate that does not
	// need to be reactive at all — the `$currentRepo` read inside the template
	// already drives the re-render.
	function needsWorkspace(scope: string, repo: string | null): boolean {
		return scope === "workspace" && !repo;
	}
</script>

<aside class="sidebar glass-strong flex flex-col" class:collapsed aria-label="Dashboard sidebar">
	<div class="sidebar-header">
		{#if !collapsed}
			<div class="brand">
				<span class="brand-mark" aria-hidden="true">
					<Icon name="brain" size={15} strokeWidth={2} />
				</span>
				<span class="brand-text">
					<span class="brand-name">Memory MCP</span>
					<span class="brand-sub">Dashboard</span>
				</span>
			</div>
		{/if}

		<button
			class="btn btn-ghost btn-icon btn-sm collapse-btn"
			on:click={handler.toggleCollapse}
			title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
			aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
		>
			<span class="collapse-chevron" class:flipped={collapsed}>
				<Icon name="chevron-left" size={14} strokeWidth={2} />
			</span>
		</button>
	</div>

	<WorkspaceSwitcher {collapsed} onSelect={handler.selectRepo} onTogglePin={handler.togglePin} />

	<nav class="nav" class:collapsed aria-label="Primary navigation">
		{#each NAV_GROUPS as group (group.id)}
			<div class="nav-group" data-scope={group.id}>
				{#if !collapsed}
					<p class="nav-group-label">{group.label}</p>
				{/if}
				{#each group.items as tab (tab.id)}
					{@const locked = needsWorkspace(tab.scope, $currentRepo)}
					<button
						class="nav-item"
						class:active={$activeTab === tab.id}
						class:collapsed
						disabled={locked}
						on:click={() => onTabSelect(tab.id)}
						title={locked
							? `${tab.label} — select a workspace first`
							: collapsed
								? `${tab.label} — ${tab.description}`
								: tab.description}
						id="nav-{tab.id}"
						aria-current={$activeTab === tab.id ? "page" : undefined}
					>
						<Icon name={tab.icon} size={collapsed ? 18 : 16} strokeWidth={1.75} />
						{#if !collapsed}
							<span class="nav-label">{tab.label}</span>
						{/if}
					</button>
				{/each}

				{#if !collapsed && group.id === "workspace" && !$currentRepo}
					<p class="nav-hint">Select a workspace above to unlock these.</p>
				{/if}
			</div>
		{/each}
	</nav>
</aside>

<style>
	.sidebar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-3);
		min-height: var(--header-height);
	}

	/* Collapsed the rail is 64px, but brand mark (28) + gap (8) + button (36) +
	   padding (24) needs 84px — the toggle overflowed by 20px and was clipped,
	   leaving no way to expand again. The brand is decoration; the toggle is the
	   only control. Drop the mark and let the button own the row. */
	.sidebar.collapsed .sidebar-header {
		justify-content: center;
		padding: var(--space-3) var(--space-2);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	/* A flat mark, not a gradient chip with a coloured drop shadow. The brand is
	   the least important thing on this screen; it should not be the most
	   visually energetic element in the sidebar. */
	.brand-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		flex-shrink: 0;
		border-radius: var(--radius-sm);
		background: var(--color-text);
		color: var(--color-surface);
	}

	.brand-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.brand-name {
		font-size: var(--text-secondary);
		font-weight: var(--weight-semibold);
		color: var(--color-text);
		letter-spacing: -0.01em;
		line-height: 1.25;
	}

	.brand-sub {
		font-size: var(--text-label);
		color: var(--color-text-faint);
		line-height: 1.25;
	}

	.collapse-btn {
		flex-shrink: 0;
	}

	.collapse-chevron {
		display: inline-flex;
		transition: transform 180ms ease-out;
	}

	.collapse-chevron.flipped {
		transform: rotate(180deg);
	}

	.nav {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-2) var(--space-3) var(--space-4);
		overflow-y: auto;
		flex: 1;
	}

	.nav.collapsed {
		padding: var(--space-2);
		gap: var(--space-3);
	}

	.nav-group {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.nav-group-label {
		padding: 0 var(--space-2) var(--space-1);
		font-size: var(--text-label);
		font-weight: var(--weight-medium);
		color: var(--color-text-faint);
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		min-height: 36px;
		padding: var(--space-2);
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-muted);
		font-size: var(--text-body);
		font-weight: var(--weight-medium);
		text-align: left;
		cursor: pointer;
		transition:
			background-color 180ms ease-out,
			color 180ms ease-out;
	}

	.nav-item:hover:not(:disabled) {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	/* The active item carries the accent, not a near-invisible grey wash. The
	   previous `--color-surface-hover` fill sat ~2% off the sidebar background,
	   which made "where am I" unreadable — the same treatment as :hover meant
	   the state had no distinct signal at all. Accent text + accent tint +
	   a leading rail give one coherent indicator that survives both themes. */
	/* Text uses --color-primary-on-soft: #2563eb on its own 10%
	   tint measures 4.48:1, failing AA by a hair. The token resolves per theme
	   (darker on light, lighter on dark) — see base.css. */
	.nav-item.active {
		position: relative;
		background: var(--color-primary-soft);
		color: var(--color-primary-on-soft);
		font-weight: var(--weight-semibold);
	}

	.nav-item.active::before {
		content: "";
		position: absolute;
		left: 0;
		top: 50%;
		transform: translateY(-50%);
		width: 3px;
		height: 18px;
		border-radius: 0 2px 2px 0;
		background: var(--color-primary-on-soft);
	}

	/* Collapsed rail: the label is gone, so the icon alone must read as active.
	   A leading bar on a 40px-wide centred icon looks detached, so the tint and
	   colour carry it instead. */
	.nav-item.active.collapsed::before {
		display: none;
	}

	.nav-item.active:hover:not(:disabled) {
		background: var(--color-primary-soft-strong);
		color: var(--color-primary-on-soft);
	}

	.nav-item:disabled {
		color: var(--color-text-faint);
		cursor: not-allowed;
		opacity: 0.55;
	}

	.nav-item.collapsed {
		justify-content: center;
		padding: var(--space-2) 0;
	}

	.nav-label {
		flex: 1;
		min-width: 0;
	}

	.nav-hint {
		padding: var(--space-2);
		font-size: var(--text-label);
		color: var(--color-text-faint);
		line-height: var(--leading-normal);
	}

	@media (pointer: coarse) {
		.nav-item {
			min-height: 44px;
		}
	}
</style>
