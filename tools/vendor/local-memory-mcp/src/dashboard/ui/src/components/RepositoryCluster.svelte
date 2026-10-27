<script lang="ts">
	import type { VisualRepository } from "../lib/arena/arenaTypes";
	import ClusterLabel from "./ClusterLabel.svelte";
	import ClusterNode from "./ClusterNode.svelte";

	export let repositories: Map<string, VisualRepository> = new Map();
	export let collapsed: boolean = true;

	let expandedRepo: string | null = null;

	$: repoList = Array.from(repositories.values());

	function toggleRepo(repoId: string) {
		expandedRepo = expandedRepo === repoId ? null : repoId;
	}

	function toggleCollapse() {
		collapsed = !collapsed;
	}
</script>

{#if repoList.length > 0}
	<div class="repo-cluster glass" class:collapsed>
		<ClusterLabel repoCount={repoList.length} {collapsed} onToggle={toggleCollapse} />

		{#if !collapsed}
			<div class="cluster-body">
				<div class="repo-strip">
					{#each repoList as repo (repo.id)}
						<ClusterNode {repo} expanded={expandedRepo === repo.id} onToggle={() => toggleRepo(repo.id)} />
					{/each}
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.repo-cluster {
		width: 100%;
		border-top: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.01);
		display: flex;
		flex-direction: column;
		user-select: none;
	}

	.repo-cluster.collapsed {
		border-bottom: none;
	}

	.cluster-body {
		padding: 14px 20px;
		background: rgba(0, 0, 0, 0.05);
		overflow-x: auto;
	}

	.repo-strip {
		display: flex;
		flex-direction: column;
		gap: 10px;
		width: 100%;
	}

	/* Responsive horizontal layout for large viewports */
	@media (min-width: 768px) {
		.repo-strip {
			flex-direction: row;
			flex-wrap: wrap;
		}
	}
</style>
