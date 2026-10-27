<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import type { TraceReference, TraceParent, CodebaseSymbolRow } from "../lib/api";
	import { getKindIcon, KIND_LABELS, buildLocationText, refKindLabel } from "../lib/symbolDetailUtils";

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
		traceParent = null,
		traceChildren = [],
		heritageRefs = [],
		onSymbolSelect = null,
		onOpenFile = null
	}: {
		traceParent: TraceParent | null;
		traceChildren: CodebaseSymbolRow[];
		heritageRefs: TraceReference[];
		/** Navigate to another symbol (parent / child) — mirrors CodebaseSymbolList. */
		onSymbolSelect?: ((symbol: CodeSymbol) => void) | null;
		/** Open a file (e.g. a derived-heritage site) in the file tree. */
		onOpenFile?: ((filePath: string) => void) | null;
	} = $props();

	let hasHierarchy = $derived(!!traceParent || traceChildren.length > 0 || heritageRefs.length > 0);

	/** Label for a hierarchy row's symbol kind; unknown kinds show their raw value. */
	function symbolKindLabel(kind: string): string {
		return KIND_LABELS[kind] ?? kind;
	}

	/** Build a selectable CodeSymbol from a TRACE row — symbol kinds are wider
	 *  than the CodeSymbol union at runtime (method/property/…), so the kind is
	 *  cast and falls back to a raw label in the header. */
	function toCodeSymbol(name: string, kind: string, filePath?: string | null, line?: number | null): CodeSymbol {
		return { name, kind: kind as CodeSymbol["kind"], filePath: filePath ?? undefined, line: line ?? undefined };
	}

	function navigateToParent() {
		if (!traceParent || typeof onSymbolSelect !== "function") return;
		onSymbolSelect(toCodeSymbol(traceParent.name, traceParent.kind, traceParent.filePath, traceParent.line));
	}

	function navigateToChild(child: CodebaseSymbolRow) {
		if (typeof onSymbolSelect !== "function") return;
		onSymbolSelect(toCodeSymbol(child.name, child.kind, child.file_path, child.start_line));
	}

	function openHeritageSite(ref: TraceReference) {
		if (typeof onOpenFile === "function") onOpenFile(ref.filePath);
	}
</script>

<!-- ─── Hierarchy (TASK-300: parent + children; Phase 1.1 heritage sites) ─── -->
{#if hasHierarchy}
	<div class="detail-section">
		<div class="detail-section-label">Hierarchy</div>
		{#if traceParent}
			<div class="hierarchy-subgroup">
				<div class="hierarchy-subgroup-label">Parent</div>
				<button
					class="hierarchy-row"
					onclick={navigateToParent}
					aria-label="Navigate to parent symbol {traceParent.name}"
				>
					<span class="hierarchy-row-icon"
						><Icon name={getKindIcon(traceParent.kind)} size={13} strokeWidth={1.75} /></span
					>
					<span class="hierarchy-row-name">{traceParent.name}</span>
					<span class="hierarchy-row-kind">{symbolKindLabel(traceParent.kind)}</span>
					<span class="hierarchy-row-loc">
						{buildLocationText(traceParent.filePath, traceParent.line ?? undefined)}
					</span>
				</button>
			</div>
		{/if}
		{#if traceChildren.length > 0}
			<div class="hierarchy-subgroup">
				<div class="hierarchy-subgroup-label">
					Children
					<span class="detail-section-count">{traceChildren.length}</span>
				</div>
				{#each traceChildren as child (child.id)}
					<button
						class="hierarchy-row"
						onclick={() => navigateToChild(child)}
						aria-label="Navigate to {child.kind} {child.name}"
					>
						<span class="hierarchy-row-icon"><Icon name={getKindIcon(child.kind)} size={13} strokeWidth={1.75} /></span>
						<span class="hierarchy-row-name">{child.name}</span>
						<span class="hierarchy-row-kind">{symbolKindLabel(child.kind)}</span>
						{#if child.start_line != null}
							<span class="hierarchy-row-loc">:{child.start_line}</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
		{#if heritageRefs.length > 0}
			<div class="hierarchy-subgroup">
				<div class="hierarchy-subgroup-label">
					Inherited by
					<span class="detail-section-count">{heritageRefs.length}</span>
				</div>
				<div class="hierarchy-hint">Types that extend or implement this symbol at their heritage site.</div>
				{#each heritageRefs as ref (`${ref.kind}:${ref.filePath}:${ref.startLine}`)}
					<button
						class="hierarchy-row"
						onclick={() => openHeritageSite(ref)}
						aria-label="Open {ref.filePath}:{ref.startLine}"
					>
						<span class="hierarchy-row-icon"
							><Icon name={getKindIcon(ref.kind ?? "code")} size={12} strokeWidth={2} /></span
						>
						<span class="hierarchy-row-name">{refKindLabel(ref.kind)}</span>
						<span class="hierarchy-row-loc">{buildLocationText(ref.filePath, ref.startLine)}</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	/* ── Shared section primitives (dup of parent's scoped copies — Svelte
	   scoping requires them here for the child's own DOM) ── */
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

	.hierarchy-subgroup {
		margin-bottom: 8px;
	}

	.hierarchy-subgroup-label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.64rem;
		font-weight: 700;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 4px;
	}

	.hierarchy-hint {
		font-size: 0.64rem;
		color: var(--color-text-muted);
		opacity: 0.7;
		margin-bottom: 3px;
	}

	.hierarchy-row {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.7rem;
		font-weight: 500;
		padding: 4px 8px;
		border-radius: 6px;
		cursor: pointer;
		text-align: left;
		transition:
			background 0.1s ease,
			color 0.1s ease;
	}

	.hierarchy-row:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--color-text);
	}

	.hierarchy-row:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: -2px;
	}

	.hierarchy-row-icon {
		color: var(--color-primary);
		opacity: 0.85;
		flex-shrink: 0;
		display: inline-flex;
	}

	.hierarchy-row-name {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex-shrink: 0;
		max-width: 45%;
	}

	.hierarchy-row-kind {
		font-size: 0.58rem;
		font-weight: 600;
		color: var(--color-text-muted);
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid var(--color-border);
		padding: 0 5px;
		border-radius: 4px;
		flex-shrink: 0;
	}

	.hierarchy-row-loc {
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		font-size: 0.62rem;
		opacity: 0.75;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
		min-width: 0;
		text-align: right;
	}
</style>
