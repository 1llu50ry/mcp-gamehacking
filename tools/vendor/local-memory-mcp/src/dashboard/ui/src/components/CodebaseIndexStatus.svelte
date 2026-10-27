<script lang="ts">
	import type { CodebaseIndexStatus } from "../lib/api";
	import { api } from "../lib/api";
	import IndexStatusBadge from "./IndexStatusBadge.svelte";
	import IndexProgress from "./IndexProgress.svelte";
	import { computeRelativeTime } from "../lib/indexStatusUtils";
	import { formatKindCounts } from "../lib/fileTreeUtils";

	let {
		repo = "",
		languageCount = 0,
		kindCounts = {}
	}: {
		repo: string;
		/** Number of distinct indexed languages (from the ARCHITECTURE summary). */
		languageCount?: number;
		/** Per-kind symbol counts (aggregated from the ARCHITECTURE tree). */
		kindCounts?: Record<string, number>;
	} = $props();

	// --- State ---
	let status = $state<CodebaseIndexStatus | null>(null);
	let loading = $state(false);
	let error = $state("");
	let reindexing = $state(false);

	// --- Derived: indexing progress ---
	let indexingInProgress = $derived(status?.indexing?.in_progress === true);
	let indexingFilesParsed = $derived(status?.indexing?.files_parsed ?? 0);
	let indexingTotalFiles = $derived(status?.indexing?.total_files ?? 0);
	let indexingProgressPercent = $derived(indexingTotalFiles > 0 ? (indexingFilesParsed / indexingTotalFiles) * 100 : 0);

	// --- Fetch status ---
	async function fetchStatus() {
		if (!repo) {
			status = null;
			return;
		}
		loading = true;
		error = "";
		try {
			status = await api.codebaseIndexStatus(repo);
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to fetch index status";
			status = null;
		} finally {
			loading = false;
		}
	}

	// --- Re-index ---
	async function startReindex() {
		if (!repo || reindexing) return;
		reindexing = true;
		error = "";
		try {
			await api.codebaseReindex(repo);
			// Poll for progress after triggering re-index
			await pollIndexingProgress();
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to start indexing";
			reindexing = false;
		}
	}

	// --- Poll indexing progress ---
	async function pollIndexingProgress() {
		const POLL_INTERVAL = 2000;
		const MAX_POLLS = 300; // 10 minutes max
		let polls = 0;

		const tick = async () => {
			if (polls >= MAX_POLLS) {
				reindexing = false;
				return;
			}
			polls++;
			try {
				status = await api.codebaseIndexStatus(repo);
				if (status.indexing?.in_progress) {
					setTimeout(tick, POLL_INTERVAL);
				} else {
					reindexing = false;
				}
			} catch {
				// Silently retry on transient errors
				setTimeout(tick, POLL_INTERVAL);
			}
		};

		await tick();
	}

	// --- Auto-refresh every 60s + initial load ---
	$effect(() => {
		const currentRepo = repo;
		if (!currentRepo) {
			status = null;
			return;
		}

		void fetchStatus();

		const interval = setInterval(() => {
			// Skip auto-refresh if re-index is in progress (polling handles it)
			if (!reindexing) {
				void fetchStatus();
			}
		}, 60_000);

		return () => {
			clearInterval(interval);
		};
	});

	// --- IndexStats strip (TASK-328) ---
	let relativeTime = $derived(computeRelativeTime(status?.last_indexed_at));
	let kindCountsText = $derived(formatKindCounts(kindCounts));
	let stalePercent = $derived(status?.stale === true ? Math.round((status.staleRatio ?? 0) * 100) : null);
</script>

<div class="index-status">
	<IndexStatusBadge {status} {loading} {error} {reindexing} {repo} {fetchStatus} {startReindex} />

	<IndexProgress
		{status}
		{reindexing}
		{indexingInProgress}
		{indexingFilesParsed}
		{indexingTotalFiles}
		{indexingProgressPercent}
	/>

	<!-- Compact IndexStats card (TASK-328 [CG-1] point 12): files, symbols,
	     languages, per-kind symbol counts, mtime/indexedAt + staleness. Only
	     rendered once the index status is known to be ready. -->
	{#if status?.indexed}
		<div class="index-stats" aria-label="Index statistics">
			<div class="index-stats-cell">
				<span class="index-stats-value">{status.file_count}</span>
				<span class="index-stats-label">Files</span>
			</div>
			<div class="index-stats-cell">
				<span class="index-stats-value">{status.symbol_count}</span>
				<span class="index-stats-label">Symbols</span>
			</div>
			<div class="index-stats-cell">
				<span class="index-stats-value">{languageCount}</span>
				<span class="index-stats-label">Languages</span>
			</div>
			{#if kindCountsText}
				<div
					class="index-stats-cell kinds"
					title="Symbols by kind (f=function c=class i=interface t=type e=enum v=variable)"
				>
					<span class="index-stats-kinds">{kindCountsText}</span>
					<span class="index-stats-label">By kind</span>
				</div>
			{/if}
			<div class="index-stats-cell">
				<span class="index-stats-time" title={status.last_indexed_at ?? undefined}>
					{relativeTime ?? "–"}
				</span>
				<span class="index-stats-label">Last indexed</span>
			</div>
			{#if stalePercent !== null}
				<span class="index-stats-stale" title="Files changed on disk since the last index">
					stale · {stalePercent}%
				</span>
			{/if}
		</div>
	{/if}
</div>

<style>
	.index-status {
		margin-bottom: 16px;
	}

	/* ── IndexStats strip (TASK-328) ── */
	.index-stats {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px;
		margin-top: 10px;
		padding: 8px 14px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.02);
	}

	.index-stats-cell {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.index-stats-cell.kinds {
		padding-left: 10px;
		border-left: 1px solid var(--color-border);
	}

	.index-stats-value,
	.index-stats-kinds,
	.index-stats-time {
		font-size: 0.78rem;
		font-weight: 800;
		color: var(--color-text);
		white-space: nowrap;
	}

	.index-stats-kinds {
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--color-primary);
	}

	.index-stats-time {
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--color-text-muted);
	}

	.index-stats-label {
		font-size: 0.56rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		opacity: 0.75;
	}

	.index-stats-stale {
		margin-left: auto;
		font-size: 0.6rem;
		font-weight: 800;
		color: #f59e0b;
		background: rgba(245, 158, 11, 0.1);
		border: 1px solid rgba(245, 158, 11, 0.25);
		padding: 2px 8px;
		border-radius: 999px;
		white-space: nowrap;
	}
</style>
