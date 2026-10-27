<script lang="ts">
	import { onMount } from "svelte";
	import { api } from "../lib/api";
	import DetailDrawer from "./DetailDrawer.svelte";
	import HandoffFilterBar from "./HandoffFilterBar.svelte";
	import HandoffList from "./HandoffList.svelte";
	import { confirmDelete } from "../lib/confirm";
	import Icon from "../lib/Icon.svelte";
	import { ErrorState, Metric, PageHeader, Surface } from "./ui";
	import type { Handoff, TaskClaim } from "../lib/interfaces";

	export let repo = "";

	let handoffs: Handoff[] = [];
	let loading = false;
	let error = "";
	let status = "";
	let agentFilter = "";
	let claims: TaskClaim[] = [];
	let claimsLoading = false;
	let releasingClaimId: string | null = null;

	// Detail drawer
	let selectedHandoff: Handoff | null = null;
	let handoffDrawerOpen = false;
	let liveRegionText = "";

	$: if (repo) {
		void refreshCoordination();
	}

	async function loadClaims() {
		if (!repo) return;
		claimsLoading = true;
		try {
			const result = await api.coordinationClaims({ repo, active_only: true, pageSize: 20 });
			claims = result.claims || [];
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			claimsLoading = false;
		}
	}

	async function loadHandoffs() {
		if (!repo) return;
		loading = true;
		error = "";
		try {
			const params: { repo: string; pageSize: number; status?: string; to_agent?: string } = { repo, pageSize: 50 };
			if (status) params.status = status;
			if (agentFilter.trim()) params.to_agent = agentFilter.trim();
			const result = await api.coordinationHandoffs(params);
			handoffs = result.handoffs || [];
			if (selectedHandoff && !handoffs.some((h) => h.id === selectedHandoff?.id)) {
				selectedHandoff = null;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function refreshCoordination() {
		await Promise.all([loadHandoffs(), loadClaims()]);
	}

	function openCreateDrawer() {
		selectedHandoff = null;
		handoffDrawerOpen = true;
	}

	function openViewDrawer(handoff: Handoff) {
		selectedHandoff = handoff;
		handoffDrawerOpen = true;
	}

	function closeHandoffDrawer() {
		handoffDrawerOpen = false;
		selectedHandoff = null;
	}

	function handleHandoffCreated() {
		closeHandoffDrawer();
		void refreshCoordination();
	}

	function handleHandoffUpdated() {
		closeHandoffDrawer();
		void refreshCoordination();
	}

	async function releaseClaim(claim: TaskClaim) {
		releasingClaimId = claim.id;
		error = "";
		try {
			await api.releaseClaim({ repo, task_id: claim.task_id, agent: claim.agent });
			liveRegionText = `Claim released for ${claim.task_id}`;
			await loadClaims();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			releasingClaimId = null;
		}
	}

	async function handleDeleteRow(handoff: Handoff) {
		if (!(await confirmDelete(`Expire handoff "${handoff.summary}"?`))) return;
		try {
			await api.updateHandoffStatus({ id: handoff.id, status: "expired" });
			liveRegionText = `Handoff "${handoff.summary}" expired`;
			void refreshCoordination();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	onMount(() => {
		void refreshCoordination();
	});
</script>

<PageHeader description="Transfer unfinished work between agents and resolve ownership conflicts.">
	{#snippet actions()}
		<button class="btn btn-primary" onclick={openCreateDrawer}>
			<Icon name="plus" size={16} strokeWidth={2} />
			New handoff
		</button>
	{/snippet}
</PageHeader>

<div class="sr-only" aria-live="polite" aria-atomic="true">{liveRegionText}</div>

<div class="feature-shell">
	<Surface label="Coordination summary">
		<div class="coordination-metrics">
			<Metric label="Pending" value={handoffs.filter((h) => h.status === "pending").length} />
			<Metric label="Resolved" value={handoffs.filter((h) => h.status !== "pending").length} />
			<Metric label="Active claims" value={claims.length} />
			<Metric label="Total" value={handoffs.length} />
		</div>
	</Surface>

	<HandoffFilterBar
		bind:status
		bind:agentFilter
		onStatusChange={loadHandoffs}
		onAgentFilterChange={loadHandoffs}
		onRefresh={refreshCoordination}
	/>

	{#if error}
		<ErrorState
			title="Coordination request failed"
			description="Handoffs and claims could not be loaded or updated. Nothing was changed."
		>
			{#snippet action()}
				<button class="btn btn-secondary btn-sm" onclick={refreshCoordination}>Try again</button>
			{/snippet}
		</ErrorState>
	{/if}

	<HandoffList
		{handoffs}
		{loading}
		{claims}
		{claimsLoading}
		{releasingClaimId}
		onOpenViewDrawer={openViewDrawer}
		onDeleteRow={handleDeleteRow}
		onReleaseClaim={releaseClaim}
	/>
</div>

<DetailDrawer
	drawerMode={selectedHandoff ? "handoff" : "new-handoff"}
	handoff={selectedHandoff}
	open={handoffDrawerOpen}
	onClose={closeHandoffDrawer}
	onHandoffCreated={handleHandoffCreated}
	onHandoffUpdated={handleHandoffUpdated}
	{repo}
/>

<style>
	.feature-shell {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.coordination-metrics {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: var(--space-4);
	}
</style>
