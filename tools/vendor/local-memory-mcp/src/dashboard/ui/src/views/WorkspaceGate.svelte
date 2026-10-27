<script lang="ts">
	import { availableRepos } from "../lib/stores";
	import { EmptyState, Surface } from "../components/ui";

	/**
	 * WorkspaceGate — what the shell renders when a workspace-scoped view is
	 * requested but no workspace exists.
	 *
	 * The old screen said "No Repository Selected / Select a repository from the
	 * sidebar to get started" for BOTH real cases, which are not the same
	 * problem:
	 *
	 * - repositories exist, none is active → genuinely just pick one. In
	 *   practice this is now near-unreachable: the sidebar disables
	 *   workspace-scoped destinations until a workspace is chosen, and startup
	 *   auto-selects the last-used (or first) repository.
	 * - no repositories exist at all → telling this user to "select a
	 *   repository from the sidebar" is a dead end. There is nothing in the
	 *   sidebar to select. They need to know how one gets created.
	 *
	 * So the empty case explains the actual next action: index a repository
	 * through the MCP tool. That is onboarding, not an error message.
	 */
	let { onOpenReference = () => {} }: { onOpenReference?: () => void } = $props();
</script>

<Surface padding="lg" label="Getting started">
	{#if $availableRepos.length === 0}
		<EmptyState
			icon="folder"
			size="page"
			title="No workspaces yet"
			description="A workspace appears here once an agent writes to this server — index a repository with the codebase-index tool, or store a memory with memory-write."
		>
			{#snippet action()}
				<button class="btn btn-primary" onclick={onOpenReference}>Browse MCP tools</button>
			{/snippet}
		</EmptyState>
	{:else}
		<EmptyState
			icon="folder"
			size="page"
			title="Choose a workspace"
			description="Pick a repository from the switcher at the top of the sidebar to load its data."
		/>
	{/if}
</Surface>
