<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import type { RepoMeta } from "../lib/stores";

	export let currentRepo: string | null = null;
	export let repoData: RepoMeta | undefined = undefined;
	export let viewLabel = "Dashboard";
	export let viewScope: "global" | "workspace" | "system" = "workspace";
	/** Opens the mobile sidebar menu (wired from the Visible← TopBar row; only shown ≤1024px). */
	export let onToggleMobileMenu: () => void = () => {};
	/** Whether the mobile menu is open — drives aria-expanded on the hamburger. */
	export let mobileMenuOpen = false;
</script>

<div class="flex items-center gap-3">
	<!-- Mobile hamburger (hidden ≥1025px via CSS below; visible + functional ≤1024px) -->
	<button
		class="btn btn-ghost btn-icon"
		id="mobileMenuBtn"
		aria-label="Toggle menu"
		aria-haspopup="true"
		aria-expanded={mobileMenuOpen}
		on:click={onToggleMobileMenu}
	>
		<Icon name="menu" size={18} strokeWidth={2} />
	</button>

	<div class="view-context">
		<div class="view-eyebrow">
			{viewScope === "workspace" ? "Workspace" : viewScope === "global" ? "Global" : "System"}
		</div>
		<div class="view-path">
			{#if viewScope === "workspace"}
				<span class="workspace-name">{currentRepo || "Select repository"}</span>
				<span class="path-separator" aria-hidden="true">/</span>
			{/if}
			<h1 class="view-title">{viewLabel}</h1>
		</div>
		{#if viewScope === "workspace" && currentRepo && repoData}
			<div class="view-meta">{repoData.memoryCount || 0} memories in this workspace</div>
		{:else if viewScope === "global"}
			<div class="view-meta">Across all repositories</div>
		{:else if viewScope === "system"}
			<div class="view-meta">Tools, prompts, and resources</div>
		{/if}
	</div>
</div>

<style>
	.view-context {
		min-width: 0;
	}

	.view-eyebrow {
		font-size: 0.6875rem;
		font-weight: 700;
		line-height: 1;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-faint);
		margin-bottom: 5px;
	}

	.view-path {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		font-size: 0.9375rem;
		color: var(--color-text);
	}

	.view-title {
		font-size: inherit;
		font-weight: 700;
		margin: 0;
		display: inline;
		line-height: inherit;
		color: inherit;
	}

	.workspace-name {
		max-width: 220px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-muted);
	}

	.path-separator {
		color: var(--color-text-faint);
	}

	.view-meta {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-top: 2px;
	}

	/* Hidden by default (desktop) — the inline display:none was removed so the
	   button is a real interactive element; visibility is purely CSS-driven. */
	#mobileMenuBtn {
		display: none;
	}

	@media (max-width: 1024px) {
		#mobileMenuBtn {
			display: flex !important;
		}
	}

	@media (max-width: 760px) {
		.workspace-name {
			max-width: 110px;
		}
		.view-meta {
			display: none;
		}
	}

	@media (max-width: 420px) {
		.workspace-name {
			max-width: 72px;
		}
		.view-path {
			font-size: 0.8125rem;
		}
	}
</style>
