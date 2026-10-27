<script lang="ts">
	import Icon from "../lib/Icon.svelte";

	interface CodeSymbol {
		name: string;
		kind: "function" | "class" | "interface" | "type" | "enum" | "variable";
		signature?: string;
		exported?: boolean;
		documentation?: string;
		filePath?: string;
		line?: number;
		column?: number;
		references?: string[];
		relatedSymbols?: string[];
	}

	let {
		symbols = [],
		onSymbolSelect = null,
		loading = false
	}: {
		symbols: CodeSymbol[];
		onSymbolSelect: ((symbol: CodeSymbol) => void) | null;
		loading: boolean;
	} = $props();

	let activeSymbol: string | null = $state(null);

	const KIND_ORDER: string[] = ["function", "class", "interface", "type", "enum", "variable"];

	const KIND_LABELS: Record<string, string> = {
		function: "Functions",
		class: "Classes",
		interface: "Interfaces",
		type: "Types",
		enum: "Enums",
		variable: "Variables"
	};

	const KIND_ICONS: Record<string, string> = {
		function: "zap",
		class: "layers",
		interface: "terminal",
		type: "hash",
		enum: "list",
		variable: "database"
	};

	const grouped = $derived.by(() => {
		const groups: Record<string, CodeSymbol[]> = {};
		for (const kind of KIND_ORDER) {
			groups[kind] = [];
		}
		for (const sym of symbols) {
			const k = sym.kind || "variable";
			if (!groups[k]) {
				groups[k] = [];
			}
			groups[k].push(sym);
		}
		return KIND_ORDER.filter((k) => groups[k].length > 0).map((k) => ({
			kind: k,
			label: KIND_LABELS[k] || k,
			icon: KIND_ICONS[k] || "code",
			symbols: groups[k]
		}));
	});

	function selectSymbol(sym: CodeSymbol) {
		activeSymbol = sym.name;
		if (typeof onSymbolSelect === "function") {
			onSymbolSelect(sym);
		}
	}

	function truncateSignature(sig: string | undefined, maxLen = 60): string {
		if (!sig) return "";
		if (sig.length <= maxLen) return sig;
		return sig.slice(0, maxLen) + "...";
	}

	function handleKeyDown(e: KeyboardEvent, sym: CodeSymbol) {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			selectSymbol(sym);
		}
	}
</script>

{#if loading}
	<div class="sym-skeleton" aria-label="Loading symbols">
		{#each Array(6) as _, i (i)}
			<div class="sym-skeleton-row">
				<div class="sym-skeleton-icon skeleton-pulse"></div>
				<div class="sym-skeleton-text skeleton-pulse" style="width:{40 + ((i * 13) % 45)}%;"></div>
				<div class="sym-skeleton-badge skeleton-pulse"></div>
			</div>
		{/each}
	</div>
{:else if symbols.length === 0}
	<div class="sym-empty">
		<div class="sym-empty-icon">
			<Icon name="search" size={20} strokeWidth={1.5} />
		</div>
		<div class="sym-empty-title">No symbols found in this file.</div>
	</div>
{:else}
	<div class="sym-list" role="list" aria-label="File symbols">
		{#each grouped as group (group.kind)}
			<div class="sym-group">
				<div class="sym-group-header">
					<Icon name={group.icon} size={12} strokeWidth={2} />
					<span class="sym-group-label">{group.label}</span>
					<span class="sym-group-count">{group.symbols.length}</span>
				</div>
				<ul class="sym-group-list">
					{#each group.symbols as sym (sym.name)}
						<li role="listitem">
							<button
								class="sym-row"
								class:active={activeSymbol === sym.name}
								onclick={() => selectSymbol(sym)}
								onkeydown={(e) => handleKeyDown(e, sym)}
								aria-label="{sym.exported ? 'Exported ' : ''}{sym.kind} {sym.name}"
							>
								<Icon name={group.icon} size={13} strokeWidth={1.75} className="sym-row-icon" />
								<span class="sym-name">{sym.name}</span>
								{#if sym.signature}
									<span class="sym-sig">{truncateSignature(sym.signature)}</span>
								{/if}
								{#if sym.exported}
									<span class="sym-export-badge">export</span>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>
{/if}

<style>
	/* ── Skeleton Loading ── */
	.sym-skeleton {
		padding: 8px 0;
	}

	.sym-skeleton-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
	}

	.sym-skeleton-icon {
		width: 13px;
		height: 13px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.06);
		flex-shrink: 0;
	}

	.sym-skeleton-text {
		height: 10px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.06);
	}

	.sym-skeleton-badge {
		width: 36px;
		height: 10px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.06);
		margin-left: auto;
	}

	.skeleton-pulse {
		animation: skeleton-pulse 1.8s ease-in-out infinite;
	}

	@keyframes skeleton-pulse {
		0%,
		100% {
			opacity: 0.4;
		}
		50% {
			opacity: 1;
		}
	}

	/* ── Empty State ── */
	.sym-empty {
		text-align: center;
		padding: 32px 16px;
	}

	.sym-empty-icon {
		display: inline-flex;
		width: 44px;
		height: 44px;
		border-radius: 12px;
		background: rgba(14, 165, 233, 0.1);
		color: var(--color-primary);
		border: 1px solid rgba(14, 165, 233, 0.15);
		align-items: center;
		justify-content: center;
		margin-bottom: 10px;
	}

	.sym-empty-title {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--color-text-muted);
	}

	/* ── Symbol List ── */
	.sym-list {
		padding: 4px 0;
	}

	/* ── Group ── */
	.sym-group {
		margin-bottom: 4px;
	}

	.sym-group-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		color: var(--color-text-muted);
		font-size: 0.66rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.sym-group-label {
		flex: 1;
	}

	.sym-group-count {
		font-size: 0.58rem;
		font-weight: 600;
		opacity: 0.6;
		background: rgba(255, 255, 255, 0.04);
		padding: 1px 5px;
		border-radius: 4px;
	}

	.sym-group-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	/* ── Symbol Row ── */
	.sym-row {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.74rem;
		font-weight: 500;
		padding: 5px 12px 5px 20px;
		cursor: pointer;
		transition:
			background 0.12s ease,
			color 0.12s ease;
		border-radius: 6px;
		margin: 1px 6px;
		text-align: left;
	}

	.sym-row:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--color-text);
	}

	:global(html.dark) .sym-row:hover {
		background: rgba(255, 255, 255, 0.04);
	}

	.sym-row.active {
		background: rgba(14, 165, 233, 0.1);
		color: var(--color-primary);
		border: 1px solid rgba(14, 165, 233, 0.15);
	}

	.sym-row:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: -2px;
	}

	/* ── Symbol Name ── */
	.sym-name {
		font-weight: 600;
		white-space: nowrap;
		flex-shrink: 0;
	}

	/* ── Signature ── */
	.sym-sig {
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		font-size: 0.64rem;
		color: var(--color-text-muted);
		opacity: 0.7;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
		min-width: 0;
	}

	/* ── Export Badge ── */
	.sym-export-badge {
		font-size: 0.52rem;
		font-weight: 700;
		color: #22c55e;
		background: rgba(34, 197, 94, 0.1);
		border: 1px solid rgba(34, 197, 94, 0.15);
		padding: 1px 5px;
		border-radius: 4px;
		flex-shrink: 0;
		letter-spacing: 0.02em;
	}
</style>
