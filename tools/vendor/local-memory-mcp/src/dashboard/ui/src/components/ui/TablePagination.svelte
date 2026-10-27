<script lang="ts">
	/**
	 * TablePagination — shared pagination primitive for dashboard data tables.
	 *
	 * Unifies pagination controls across paginated views (MemoryList, StandardsList, QueueJobsTable).
	 * Supports:
	 * - 5-page sliding window centered on current page
	 * - First («) / Prev (‹) / Next (›) / Last (») navigation
	 * - Disabled boundary states & loading states
	 * - Semantic a11y labels & aria-current="page"
	 * - Optional item count display ("(N items)" / "(N jobs)")
	 * - Callbacks: onPageChange (canonical) or onGoToPage (alias)
	 */
	let {
		page = 1,
		totalPages = undefined,
		total = undefined,
		pageSize = undefined,
		totalItems = undefined,
		itemLabel = "items",
		loading = false,
		onPageChange,
		onGoToPage
	}: {
		page: number;
		totalPages?: number;
		total?: number;
		pageSize?: number;
		totalItems?: number;
		itemLabel?: string;
		loading?: boolean;
		onPageChange?: ((page: number) => void) | null;
		onGoToPage?: ((page: number) => void) | null;
	} = $props();

	// Derived total pages supporting either direct totalPages or computed from total/pageSize
	let computedTotalPages = $derived.by(() => {
		if (typeof totalPages === "number" && totalPages > 0) return totalPages;
		const items = totalItems ?? total;
		if (typeof items === "number" && typeof pageSize === "number" && pageSize > 0) {
			return Math.max(1, Math.ceil(items / pageSize));
		}
		return 1;
	});

	// Window of up to 5 page buttons centered on the current page
	let pageButtons = $derived.by(() => {
		const count = computedTotalPages;
		return Array.from({ length: Math.min(5, count) }, (_, i) => {
			const start = Math.max(1, Math.min(page - 2, count - 4));
			return start + i;
		});
	});

	let displayTotalItems = $derived(totalItems ?? total);

	/**
	 * Dispatches page change event to whichever callback is provided.
	 *
	 * @param targetPage Target page number to navigate to.
	 */
	function handlePageChange(targetPage: number) {
		if (loading) return;
		if (targetPage < 1 || targetPage > computedTotalPages || targetPage === page) return;
		onPageChange?.(targetPage);
		onGoToPage?.(targetPage);
	}
</script>

{#if computedTotalPages > 1}
	<nav class="table-pagination" aria-label="Table pagination">
		<span class="table-pagination-info">
			Page {page} of {computedTotalPages}
			{#if typeof displayTotalItems === "number"}
				({displayTotalItems} {itemLabel})
			{/if}
		</span>
		<div class="table-pagination-controls">
			<button
				type="button"
				class="btn btn-ghost btn-sm table-pagination-btn"
				onclick={() => handlePageChange(1)}
				disabled={page <= 1 || loading}
				aria-label="First page"
			>
				«
			</button>
			<button
				type="button"
				class="btn btn-ghost btn-sm table-pagination-btn"
				onclick={() => handlePageChange(page - 1)}
				disabled={page <= 1 || loading}
				aria-label="Previous page"
			>
				‹
			</button>
			{#each pageButtons as p (p)}
				<button
					type="button"
					class="btn btn-sm table-pagination-btn"
					class:btn-primary={p === page}
					class:btn-ghost={p !== page}
					disabled={loading}
					aria-label="Page {p}"
					aria-current={p === page ? "page" : undefined}
					onclick={() => handlePageChange(p)}
				>
					{p}
				</button>
			{/each}
			<button
				type="button"
				class="btn btn-ghost btn-sm table-pagination-btn"
				onclick={() => handlePageChange(page + 1)}
				disabled={page >= computedTotalPages || loading}
				aria-label="Next page"
			>
				›
			</button>
			<button
				type="button"
				class="btn btn-ghost btn-sm table-pagination-btn"
				onclick={() => handlePageChange(computedTotalPages)}
				disabled={page >= computedTotalPages || loading}
				aria-label="Last page"
			>
				»
			</button>
		</div>
	</nav>
{/if}
