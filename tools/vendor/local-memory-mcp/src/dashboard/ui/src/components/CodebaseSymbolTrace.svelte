<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import type { TraceReference, TraceParent, CodebaseSymbolRow } from "../lib/api";
	import {
		getKindIcon,
		refKindLabel,
		refKindKey,
		groupRefsByFile,
		groupRefsByKind,
		otherRefKindLabels
	} from "../lib/symbolDetailUtils";
	import CodebaseSymbolHierarchy from "./CodebaseSymbolHierarchy.svelte";
	import CodebaseSymbolKindChips from "./CodebaseSymbolKindChips.svelte";

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
		traceRefs = [],
		references = [],
		traceLoading = false,
		traceError = "",
		traceParent = null,
		traceChildren = [],
		activeKindFilter = $bindable("all"),
		onSymbolSelect = null,
		onOpenFile = null
	}: {
		traceRefs: TraceReference[];
		references: string[];
		traceLoading: boolean;
		traceError: string;
		traceParent: TraceParent | null;
		traceChildren: CodebaseSymbolRow[];
		/** Reference-kind filter (Phase 1.1). Owned by CodebaseSymbolDetail so it
		 *  can be reset to "all" on every symbol transition; bound here so the
		 *  chip row can update it. */
		activeKindFilter?: string;
		/** Navigate to another symbol (parent / child) — mirrors CodebaseSymbolList. */
		onSymbolSelect?: ((symbol: CodeSymbol) => void) | null;
		/** Open a file (e.g. a derived-heritage site) in the file tree. */
		onOpenFile?: ((filePath: string) => void) | null;
	} = $props();

	// Trace-backed + legacy references combined count (section header display).
	let totalRefs = $derived(traceRefs.length + references.length);

	// Distinct raw kinds inside the "other" bucket (graceful unknown-kind rendering).
	let otherRawKinds = $derived(otherRefKindLabels(traceRefs));

	let filteredRefs = $derived(
		activeKindFilter === "all" ? traceRefs : traceRefs.filter((r) => refKindKey(r.kind) === activeKindFilter)
	);

	// Kind → refs, stable order (call → … → other), empty groups dropped.
	let refKindGroups = $derived(groupRefsByKind(filteredRefs));

	// Heritage edges (extends/implements) inside this symbol's references are
	// the declarations of types that derive from / implement the traced symbol.
	let heritageRefs = $derived(traceRefs.filter((r) => r.kind === "extends" || r.kind === "implements"));
</script>

<CodebaseSymbolHierarchy {traceParent} {traceChildren} {heritageRefs} {onSymbolSelect} {onOpenFile} />

<!-- ─── References (Enh 6: Trace-backed; Phase 1.1: kind groups + filter) ─── -->
<div class="detail-section">
	<div class="detail-section-label">
		References
		{#if traceLoading}
			<span class="detail-section-count" style="opacity:0.5">...</span>
		{:else if totalRefs > 0}
			<span class="detail-section-count"
				>{activeKindFilter === "all" ? totalRefs : `${filteredRefs.length}/${totalRefs}`}</span
			>
		{/if}
	</div>
	{#if traceLoading}
		<div class="detail-ref-loading">
			<Icon name="loader" size={12} strokeWidth={2} />
			<span>Loading references...</span>
		</div>
	{:else if traceError}
		<div class="detail-no-refs" style="color:rgba(239,68,68,0.7);">{traceError}</div>
	{:else if traceRefs.length === 0 && references.length === 0}
		<div class="detail-no-refs">No references found.</div>
	{:else}
		<CodebaseSymbolKindChips {traceRefs} bind:activeKindFilter />

		<!-- Trace-backed references: grouped by edge kind, then by file -->
		{#if traceRefs.length > 0}
			{#each [...refKindGroups.entries()] as [kindKey, kindRefs] (kindKey)}
				<div class="detail-ref-kind-group">
					<div class="detail-ref-kind-header">
						<Icon name={getKindIcon(kindKey)} size={12} strokeWidth={2} />
						<span class="detail-ref-kind-label">{refKindLabel(kindKey)}</span>
						{#if kindKey === "other" && otherRawKinds.length > 0}
							<span class="detail-ref-kind-raw" title="Raw kinds: {otherRawKinds.join(', ')}"
								>{otherRawKinds.join(", ")}</span
							>
						{/if}
						<span class="detail-ref-file-count">{kindRefs.length}</span>
					</div>
					{#each [...groupRefsByFile(kindRefs).entries()] as [filePath, fileRefs] (filePath)}
						<div class="detail-ref-file-group">
							<div class="detail-ref-file-header">
								<Icon name="file-text" size={11} strokeWidth={2} />
								<span class="detail-ref-file-path">{filePath}</span>
								<span class="detail-ref-file-count">{fileRefs.length}</span>
							</div>
							{#each fileRefs as ref (`${ref.filePath}:${ref.startLine}`)}
								<div class="detail-ref-item">
									<span class="detail-ref-line">:{ref.startLine}</span>
									{#if ref.context}
										<span class="detail-ref-context">{ref.context}</span>
									{/if}
									{#if ref.targetFile}
										<span class="detail-ref-target" title="Defined in {ref.targetFile}">{ref.targetFile}</span>
									{/if}
								</div>
							{/each}
						</div>
					{/each}
				</div>
			{/each}
		{/if}
		<!-- Legacy prop-based references -->
		{#if references.length > 0}
			<ul class="detail-ref-list">
				{#each references as ref (ref)}
					<li class="detail-ref-item">
						<Icon name="link" size={11} strokeWidth={2} />
						<span class="detail-ref-path">{ref}</span>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>

<style>
	/* ── Sections (scoped to trace blocks; shared primitives with the parent) ── */
	.detail-section {
		margin-bottom: 16px;
	}

	.detail-section-label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.66rem;
		font-weight: 700;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-bottom: 6px;
	}

	.detail-section-count {
		font-size: 0.56rem;
		font-weight: 600;
		background: rgba(255, 255, 255, 0.06);
		padding: 1px 5px;
		border-radius: 4px;
	}

	/* ── References ── */
	.detail-ref-loading {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.72rem;
		color: var(--color-text-muted);
		padding: 4px 0;
	}

	.detail-ref-loading :global(svg) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.detail-no-refs {
		font-size: 0.74rem;
		color: var(--color-text-muted);
		font-style: italic;
		padding: 4px 0;
		opacity: 0.6;
	}

	.detail-ref-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.detail-ref-file-group {
		margin-bottom: 8px;
	}

	.detail-ref-file-header {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 3px 6px;
		font-size: 0.68rem;
		font-weight: 700;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-border);
		margin-bottom: 2px;
	}

	.detail-ref-file-path {
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
		min-width: 0;
	}

	.detail-ref-file-count {
		font-size: 0.56rem;
		font-weight: 600;
		background: rgba(255, 255, 255, 0.06);
		padding: 1px 5px;
		border-radius: 4px;
		flex-shrink: 0;
	}

	.detail-ref-item {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 3px 8px 3px 20px;
		font-size: 0.68rem;
		color: var(--color-text-muted);
		border-radius: 4px;
		transition: background 0.1s ease;
	}

	.detail-ref-item:hover {
		background: rgba(255, 255, 255, 0.04);
	}

	.detail-ref-line {
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		color: var(--color-primary);
		font-weight: 600;
		opacity: 0.8;
		flex-shrink: 0;
	}

	.detail-ref-context {
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.detail-ref-path {
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ── Reference kind groups (Phase 1.1) ── */
	.detail-ref-kind-group {
		margin-bottom: 8px;
	}

	.detail-ref-kind-header {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 4px 6px;
		font-size: 0.66rem;
		font-weight: 700;
		color: var(--color-primary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-left: 2px solid rgba(14, 165, 233, 0.35);
		margin: 6px 0 2px;
	}

	.detail-ref-kind-label {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.detail-ref-kind-raw {
		font-size: 0.56rem;
		font-weight: 600;
		color: var(--color-text-muted);
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid var(--color-border);
		padding: 1px 5px;
		border-radius: 4px;
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		white-space: nowrap;
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ── Reference secondary info: target file (v23) ── */
	.detail-ref-target {
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		font-size: 0.6rem;
		color: var(--color-text-muted);
		opacity: 0.75;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		padding: 0 4px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 160px;
		margin-left: auto;
		flex-shrink: 0;
	}
</style>
