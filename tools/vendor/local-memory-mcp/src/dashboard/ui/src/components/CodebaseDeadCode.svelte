<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { getKindIcon, getKindLabel, buildLocationText, REFERENCE_KIND_ORDER } from "../lib/symbolDetailUtils";
	import type { DeadCodeBlock, EntryPointType, HotspotSymbol, UnreferencedSymbol } from "../lib/api";

	interface Props {
		block?: DeadCodeBlock | null;
		/** Open a candidate/hotspot's file in the codebase detail view. */
		onOpenFile?: ((filePath: string) => void) | null;
	}

	let { block = null, onOpenFile = null }: Props = $props();

	// Entry-point badge labels (TASK-320 spec): bin / manifest / shebang / public API
	const ENTRY_POINT_LABELS: Record<EntryPointType, string> = {
		bin: "bin",
		manifest: "manifest",
		shebang: "shebang",
		"public-api": "public API"
	};

	// Canonical reference-kind order (single source: symbolDetailUtils.REFERENCE_KIND_ORDER)
	const REF_KIND_PLURALS: Record<string, string> = {
		call: "calls",
		instantiation: "instantiations",
		import: "imports",
		extends: "extends",
		implements: "implements"
	};

	const deadCode = $derived(block ?? null);

	const hasCandidates = $derived((deadCode?.unreferenced.length ?? 0) > 0);
	const hasHotspots = $derived((deadCode?.hotspots.length ?? 0) > 0);
	const hasUnreliable = $derived((deadCode?.languageCoverage.unreliable.length ?? 0) > 0);

	/** Subtle footnote surfaced only when unreliable languages are present. */
	const coverageFootnote = $derived.by(() => {
		if (!deadCode) return "";
		const { reliable } = deadCode.languageCoverage;
		if (reliable.length > 0) return `Dead-code data reliable for: ${reliable.join(", ")}`;
		return "No reliable reference data for this index";
	});

	function openFile(filePath: string) {
		if (typeof onOpenFile === "function") {
			onOpenFile(filePath);
		}
	}

	function candidateLocation(sym: UnreferencedSymbol): string {
		return buildLocationText(sym.file_path, sym.line ?? undefined) ?? sym.file_path;
	}

	/** Nonzero per-kind breakdown for a hotspot, in canonical kind order. */
	function kindBreakdown(topKinds: Record<string, number>): Array<{ label: string; count: number }> {
		const out: Array<{ label: string; count: number }> = [];
		for (const kind of REFERENCE_KIND_ORDER) {
			const count = topKinds[kind];
			if (typeof count === "number" && count > 0) {
				out.push({ label: REF_KIND_PLURALS[kind] ?? kind, count });
			}
		}
		return out;
	}

	function refsLabel(count: number): string {
		return `${count} ${count === 1 ? "ref" : "refs"}`;
	}

	function hotspotLocation(hp: HotspotSymbol): string {
		return hp.file_path;
	}
</script>

{#if deadCode && (hasCandidates || deadCode.totals.truncated)}
	<div class="dc-section">
		<div class="dc-section-label">
			<Icon name="trash" size={12} strokeWidth={1.75} />
			<span>Dead code candidates</span>
			{#if hasCandidates}
				<span class="dc-section-count">{deadCode.unreferenced.length}</span>
			{/if}
			{#if deadCode.totals.truncated}
				<span class="dc-capped" title={deadCode.coverageNote}>capped</span>
			{/if}
		</div>

		{#if hasCandidates}
			<ul class="dc-list" role="list" aria-label="Dead code candidates">
				{#each deadCode.unreferenced as sym (sym.file_path + ":" + sym.name)}
					<li role="listitem">
						<button
							class="dc-row"
							title="{sym.kind}: {sym.name} — {candidateLocation(sym)}"
							aria-label="{sym.entryPoint
								? 'Entry-excluded'
								: 'Unreferenced'} {sym.kind} {sym.name} in {candidateLocation(sym)}"
							onclick={() => openFile(sym.file_path)}
						>
							<Icon name={getKindIcon(sym.kind)} size={13} strokeWidth={1.75} className="dc-row-icon" />
							<span class="dc-name">{sym.name}</span>
							<span class="dc-kind">{getKindLabel(sym.kind)}</span>
							<span class="dc-loc">{candidateLocation(sym)}</span>
							{#if sym.entryPoint}
								<span class="dc-entry-badge dc-entry-{sym.entryPoint.type}" title={sym.entryPoint.reason}>
									{ENTRY_POINT_LABELS[sym.entryPoint.type] ?? sym.entryPoint.type}
								</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if hasUnreliable}
			<div class="dc-footnote" title={deadCode.coverageNote}>{coverageFootnote}</div>
		{/if}
	</div>
{/if}

{#if deadCode && hasHotspots}
	<div class="dc-section">
		<div class="dc-section-label">
			<Icon name="trending-up" size={12} strokeWidth={1.75} />
			<span>Hotspots</span>
			<span class="dc-section-count">{deadCode.hotspots.length}</span>
		</div>

		<ul class="dc-list" role="list" aria-label="Hotspots — most referenced symbols">
			{#each deadCode.hotspots as hp (hp.file_path + ":" + hp.name)}
				{@const kinds = kindBreakdown(hp.topKinds)}
				<li role="listitem">
					<button
						class="dc-row"
						title="{hp.kind}: {hp.name} — {hotspotLocation(hp)} ({refsLabel(hp.refCount)})"
						aria-label="Hotspot {hp.kind} {hp.name} in {hotspotLocation(hp)} — {refsLabel(hp.refCount)}"
						onclick={() => openFile(hp.file_path)}
					>
						<Icon name={getKindIcon(hp.kind)} size={13} strokeWidth={1.75} className="dc-row-icon" />
						<span class="dc-name">{hp.name}</span>
						<span class="dc-kind">{getKindLabel(hp.kind)}</span>
						<span class="dc-loc">{hotspotLocation(hp)}</span>
						<span class="dc-refs">{refsLabel(hp.refCount)}</span>
						<span class="dc-chips-wrap">
							{#each kinds.slice(0, 3) as k (k.label)}
								<span class="dc-kind-chip">{k.count} {k.label}</span>
							{/each}
							{#if kinds.length > 3}
								<span
									class="dc-kind-chip dc-kind-chip-more"
									title={kinds
										.slice(3)
										.map((k) => `${k.count} ${k.label}`)
										.join(", ")}
								>
									+{kinds.length - 3}
								</span>
							{/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	/* ── Section (matches the Codebase tab overview-section pattern) ── */
	.dc-section {
		margin-bottom: 20px;
	}

	.dc-section:last-child {
		margin-bottom: 0;
	}

	.dc-section-label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.66rem;
		font-weight: 700;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-bottom: 8px;
	}

	.dc-section-count {
		font-size: 0.56rem;
		font-weight: 600;
		background: rgba(255, 255, 255, 0.06);
		padding: 1px 5px;
		border-radius: 4px;
	}

	.dc-capped {
		font-size: 0.52rem;
		font-weight: 700;
		text-transform: none;
		letter-spacing: 0.02em;
		color: #f59e0b;
		background: rgba(245, 158, 11, 0.1);
		border: 1px solid rgba(245, 158, 11, 0.18);
		padding: 1px 5px;
		border-radius: 999px;
	}

	/* ── Rows (compact, mono, clickable) ── */
	.dc-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.dc-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		row-gap: 4px;
		width: 100%;
		max-width: 100%;
		box-sizing: border-box;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.03);
		color: var(--color-text-muted);
		font-size: 0.7rem;
		font-weight: 500;
		padding: 4px 8px;
		border-radius: 6px;
		cursor: pointer;
		transition:
			background 0.12s ease,
			border-color 0.12s ease;
		text-align: left;
		overflow: hidden;
	}

	.dc-row:hover {
		background: rgba(99, 102, 241, 0.08);
		border-color: rgba(99, 102, 241, 0.22);
	}

	.dc-row:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: -2px;
	}

	.dc-row-icon {
		flex-shrink: 0;
		color: var(--color-text-muted);
		opacity: 0.7;
	}

	.dc-name {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-text);
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 200px;
		flex-shrink: 1;
	}

	.dc-kind {
		font-size: 0.56rem;
		font-weight: 700;
		color: var(--color-primary);
		opacity: 0.85;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 80px;
		flex-shrink: 0;
	}

	.dc-loc {
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		font-size: 0.6rem;
		color: var(--color-text-muted);
		opacity: 0.75;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1 1 120px;
		min-width: 0;
	}

	/* ── Entry-point badge (bin / manifest / shebang / public API) ── */
	.dc-entry-badge {
		font-size: 0.52rem;
		font-weight: 700;
		padding: 1px 5px;
		border-radius: 4px;
		flex-shrink: 0;
		letter-spacing: 0.02em;
	}

	.dc-entry-public-api {
		color: #22c55e;
		background: rgba(34, 197, 94, 0.1);
		border: 1px solid rgba(34, 197, 94, 0.16);
	}

	.dc-entry-bin {
		color: #f59e0b;
		background: rgba(245, 158, 11, 0.1);
		border: 1px solid rgba(245, 158, 11, 0.18);
	}

	.dc-entry-manifest {
		color: #60a5fa;
		background: rgba(96, 165, 250, 0.1);
		border: 1px solid rgba(96, 165, 250, 0.18);
	}

	.dc-entry-shebang {
		color: #c084fc;
		background: rgba(192, 132, 252, 0.1);
		border: 1px solid rgba(192, 132, 252, 0.18);
	}

	/* ── Hotspot refCount badge + per-kind chips ── */
	.dc-refs {
		font-size: 0.56rem;
		font-weight: 800;
		color: var(--color-primary);
		background: rgba(99, 102, 241, 0.12);
		border: 1px solid rgba(99, 102, 241, 0.22);
		padding: 1px 6px;
		border-radius: 999px;
		flex-shrink: 0;
		white-space: nowrap;
	}

	.dc-chips-wrap {
		display: inline-flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px;
		flex-shrink: 0;
	}

	.dc-kind-chip {
		font-size: 0.52rem;
		font-weight: 600;
		color: var(--color-text-muted);
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid var(--color-border);
		padding: 1px 5px;
		border-radius: 4px;
		flex-shrink: 0;
		white-space: nowrap;
	}

	.dc-kind-chip-more {
		opacity: 0.8;
		font-style: italic;
	}

	@media (max-width: 640px) {
		.dc-name {
			max-width: 140px;
		}

		.dc-kind {
			max-width: 60px;
		}
	}

	/* ── Language-coverage footnote (subtle) ── */
	.dc-footnote {
		margin-top: 8px;
		font-size: 0.6rem;
		font-weight: 500;
		color: var(--color-text-muted);
		opacity: 0.7;
		letter-spacing: 0.01em;
	}
</style>
