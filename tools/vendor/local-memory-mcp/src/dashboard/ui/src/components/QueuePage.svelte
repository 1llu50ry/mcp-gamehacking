<script lang="ts">
	import { ErrorState, PageHeader } from "./ui";
	import { api, type QueueJob, type QueueStatus } from "../lib/api";
	import { confirmAction, confirmDelete } from "../lib/confirm";
	import QueueStatusCards from "./QueueStatusCards.svelte";
	import QueueJobsTable from "./QueueJobsTable.svelte";

	/**
	 * Queue tab (TASK-297) — header + layout + orchestration for the status
	 * summary and the failed-job admin table (split into QueueStatusCards and
	 * QueueJobsTable — TASK-362).
	 *
	 * Wire contract: `status` values are the LITERAL QueueJobStatus enum
	 * values (`pending|claimed|done|poison`). The failed-job table is scoped to
	 * `status=poison` (TASK-363) — the terminal failed state — so per-row
	 * Re-run/Clear never hit live pending rows (which would 409). The code
	 * enum is never renamed; only the rendered label maps poison → "Failed".
	 *
	 * Reads (status + jobs) are pure reads; every mutation (retry/clear/
	 * retry-all) runs server-side inside `db.withWrite` and the page refreshes
	 * after each action.
	 */

	let { repo = "" }: { repo: string } = $props();

	// ── State ─────────────────────────────────────────────────────────────────
	let status = $state<QueueStatus | null>(null);
	let jobs = $state<QueueJob[]>([]);
	let loading = $state(false);
	let error = $state("");
	let busy = $state<{ id: string; action: "retry" | "clear" } | null>(null);
	let retryingAll = $state(false);

	// Pagination (backend clamps pageSize to [1,100]; 50 keeps the admin view
	// compact while still rendering a meaningful window).
	const PAGE_SIZE = 50;
	let page = $state(1);
	let totalItems = $state(0);
	let totalPages = $state(0);

	// ARIA live region (STD-002 / TASK-400): scoped sr-only announcements for
	// async queue updates (loads, re-run, clear, retry-all).
	let liveAnnounce = $state("");

	// ── Data loading ──────────────────────────────────────────────────────────
	// NIT fix: reset to the first page when the scope changes (repo switch OR
	// repo→global) so a stale page (e.g. "Page 3 of 2") can never render an
	// empty table for a smaller scope. `prevRepo` is a plain (non-reactive)
	// local initialized to `null` so the FIRST run always fires — including
	// global mode (repo="") — while the guard still prevents re-fetching on
	// unrelated re-runs (e.g. `page` tracking) and double-fetching on change.
	let prevRepo: string | null = null;
	$effect(() => {
		if (repo !== prevRepo) {
			prevRepo = repo;
			page = 1;
			void loadAll();
		}
	});

	async function loadAll() {
		await Promise.all([loadStatus(), loadJobs()]);
	}

	async function loadStatus() {
		try {
			status = await api.queueStatus();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function loadJobs() {
		loading = true;
		error = "";
		try {
			// F1: scope the table to terminal `poison` rows (TASK-363) — without
			// the filter the backend default (pending,poison) would surface live
			// PENDING rows under "Failed jobs" whose Re-run/Clear 409.
			// TASK-418: `repo` is optional — when empty the client omits ?repo=
			// and the backend serves the GLOBAL queue (server-wide outbox,
			// MEM-1457), so global mode renders real jobs instead of an empty table.
			const result = await api.queueJobs({ repo, page, pageSize: PAGE_SIZE, status: "poison" });
			jobs = result.jobs || [];
			totalItems = result.pagination?.totalItems ?? jobs.length;
			totalPages = result.pagination?.totalPages ?? 1;
			liveAnnounce = `Loaded ${totalItems} failed queue jobs`;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function goToPage(next: number) {
		if (next < 1 || next > totalPages || next === page) return;
		page = next;
		void loadJobs();
	}

	// ── Admin actions ─────────────────────────────────────────────────────────
	async function handleRetry(job: QueueJob) {
		if (!(await confirmAction("Re-run queue job?", "Re-queue this job so the worker processes it again?"))) return;
		busy = { id: job.id, action: "retry" };
		error = "";
		try {
			await api.queueRetryJob(job.id, repo);
			liveAnnounce = "Queue job re-queued";
			await loadAll();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = null;
		}
	}

	async function handleClear(job: QueueJob) {
		if (!(await confirmDelete(`Delete failed queue job for "${job.entity_id}"? This removes the job row permanently.`)))
			return;
		busy = { id: job.id, action: "clear" };
		error = "";
		try {
			await api.queueClearJob(job.id, repo);
			liveAnnounce = "Queue job cleared";
			await loadAll();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = null;
		}
	}

	async function handleRetryAll() {
		const scope = repo ? ` for "${repo}"` : "";
		if (!(await confirmAction("Re-run all failed jobs?", `Re-queue every failed (poison) job${scope}?`))) return;
		retryingAll = true;
		error = "";
		try {
			const result = await api.queueRetryAll(repo);
			if (result.retried > 0) {
				liveAnnounce = `Re-queued ${result.retried} failed jobs`;
				await loadAll();
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			retryingAll = false;
		}
	}
</script>

<!-- The page title is a real h1 at page-title size, not an 11px uppercase
     `.section-label` styled div. Scope is stated in the description rather than
     as a floating pill, because "which queue am I looking at" is the single
     most consequential fact on this page. -->
<PageHeader
	description={repo
		? "Embedding and knowledge-extraction jobs for this workspace."
		: "Server-wide embedding and knowledge-extraction outbox, across every workspace."}
/>

<div class="feature-shell">
	<!-- ARIA live region (STD-002 / TASK-400): scoped, never the whole shell -->
	<div class="sr-only" aria-live="polite" aria-atomic="true">{liveAnnounce}</div>

	<!-- ════ Status summary (global counts from /api/queue/status) ════ -->
	<QueueStatusCards {status} />

	<!-- Global-mode explanation (TASK-411): with no repo filter the queue is
		server-wide by design — the embedding/KG outbox spans all repos. The
		banner makes that scope explicit so users don't misread it as a
		cross-repo scan. Rendered only in global view (no repo selected). -->
	{#if !repo}
		<p class="notice-banner" role="note">Global queue — jobs from all repos (embedding/KG outbox)</p>
	{/if}

	{#if error}
		<ErrorState
			title="Queue request failed"
			description="Job status could not be read. Queued work is unaffected and will still be processed."
		>
			{#snippet action()}
				<button class="btn btn-secondary btn-sm" onclick={() => void loadAll()}>Try again</button>
			{/snippet}
		</ErrorState>
	{/if}

	<!-- ════ Failed (poison) jobs table ════ -->
	<QueueJobsTable
		{jobs}
		{loading}
		{page}
		{totalItems}
		{totalPages}
		{busy}
		{retryingAll}
		onRetry={(job) => void handleRetry(job)}
		onClear={(job) => void handleClear(job)}
		onRetryAll={() => void handleRetryAll()}
		onRefresh={() => void loadAll()}
		onPageChange={goToPage}
	/>
</div>

<style>
	.feature-shell {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	/* Matches the StandardsPanel notice treatment so both panels read the same. */
	.notice-banner {
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-left: 3px solid var(--color-primary);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: var(--text-secondary);
	}
</style>
