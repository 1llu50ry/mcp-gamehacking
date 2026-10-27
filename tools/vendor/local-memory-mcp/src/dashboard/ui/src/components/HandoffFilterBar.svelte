<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import Toolbar from "./ui/Toolbar.svelte";

	/**
	 * Filter row for the handoff collection.
	 *
	 * This component previously contained FOUR unrelated responsibilities in one
	 * `<header class="feature-toolbar card">`: the page `<h1>` and description,
	 * the page's primary "New handoff" action, a four-value metrics strip, and
	 * the actual filters — held together by a two-column grid with
	 * `grid-column: 1 / -1` spans and its own 720px breakpoint.
	 *
	 * The page title and primary action now belong to the view's PageHeader, and
	 * the counts render as a summary row in the view. What remains here is the
	 * one job the name promises: narrowing the list.
	 */
	let {
		status = $bindable(""),
		agentFilter = $bindable(""),
		onStatusChange = () => {},
		onAgentFilterChange = () => {},
		onRefresh = () => {}
	}: {
		status?: string;
		agentFilter?: string;
		onStatusChange?: () => void;
		onAgentFilterChange?: () => void;
		onRefresh?: () => void;
	} = $props();
</script>

<Toolbar label="Handoff filters">
	{#snippet search()}
		<input
			class="form-input"
			placeholder="Filter by recipient agent…"
			aria-label="Filter handoffs by recipient agent"
			bind:value={agentFilter}
			oninput={onAgentFilterChange}
		/>
	{/snippet}

	{#snippet filters()}
		<select class="form-select" bind:value={status} onchange={onStatusChange} aria-label="Filter handoffs by status">
			<option value="">All statuses</option>
			<option value="pending">Pending</option>
			<option value="accepted">Accepted</option>
			<option value="rejected">Rejected</option>
			<option value="expired">Expired</option>
		</select>
	{/snippet}

	{#snippet actions()}
		<button class="btn btn-secondary" onclick={onRefresh}>
			<Icon name="refresh-cw" size={16} strokeWidth={2} />
			Refresh
		</button>
	{/snippet}
</Toolbar>
