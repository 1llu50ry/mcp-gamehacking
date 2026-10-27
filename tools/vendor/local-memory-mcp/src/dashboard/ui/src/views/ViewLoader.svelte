<script lang="ts">
	import { ErrorState, Skeleton, Surface } from "../components/ui";

	/**
	 * ViewLoader — the shared pending/failed presentation for lazily-imported
	 * routes.
	 *
	 * Each of the seven `{#await import(...)}` blocks in the shell previously
	 * inlined its own `<div class="view-loading">Loading X…</div>` and its own
	 * `{error.message}` banner. The message text differed per route, the loading
	 * box was a bare centred string that gave no sense of the incoming layout,
	 * and the error path rendered raw exception text at the user.
	 *
	 * This gives both states one shape: a content-shaped skeleton while the
	 * chunk downloads, and a human error with a recovery action if it fails.
	 */
	let { state = "loading", label = "view" }: { state?: "loading" | "error"; label?: string } = $props();
</script>

{#if state === "loading"}
	<div class="view-loading" role="status" aria-label={`Loading ${label}`}>
		<Skeleton variant="line" width="180px" height="1.375rem" />
		<Surface padding="lg">
			<Skeleton variant="line" lines={3} />
		</Surface>
		<Surface padding="lg">
			<Skeleton variant="block" height="180px" />
		</Surface>
	</div>
{:else}
	<ErrorState
		title={`Couldn't load ${label}`}
		description="The view failed to download. This is usually a stale browser cache after an update."
	>
		{#snippet action()}
			<button class="btn btn-secondary" onclick={() => location.reload()}>Reload</button>
		{/snippet}
	</ErrorState>
{/if}

<style>
	.view-loading {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
</style>
