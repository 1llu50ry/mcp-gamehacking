<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { api, type FileContentResult } from "../lib/api";
	import { copyToClipboard } from "../lib/utils";

	let {
		repo = "",
		filePath = "",
		language = null
	}: {
		repo: string;
		filePath: string;
		/** Optional pre-known language (e.g. from the file-tree symbolCounts); the
		 *  response language is authoritative when present. */
		language?: string | null;
	} = $props();

	// --- State (4-state: loading / error / empty / success) ---
	let result = $state<FileContentResult | null>(null);
	let loading = $state(false);
	let error = $state("");
	let copied = $state(false);
	let fetchSeq = 0;

	// --- Fetch content when the file changes ---
	$effect(() => {
		if (!repo || !filePath) {
			result = null;
			return;
		}
		void fetchContent();
	});

	async function fetchContent() {
		if (!repo || !filePath) {
			result = null;
			return;
		}
		const seq = ++fetchSeq;
		loading = true;
		error = "";
		result = null; // never show stale content for the previous file
		try {
			const res = await api.codebaseFileContent(repo, filePath);
			if (seq !== fetchSeq) return;
			result = res;
		} catch (err) {
			if (seq !== fetchSeq) return;
			result = null;
			error = err instanceof Error ? err.message : "Failed to load file content";
		} finally {
			if (seq === fetchSeq) loading = false;
		}
	}

	// --- Line rendering (trailing empty element from a final newline dropped) ---
	let contentLines = $derived.by<string[]>(() => {
		if (!result) return [];
		const lines = result.content.split("\n");
		return lines.length > 0 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
	});

	let displayLanguage = $derived(result?.language ?? language ?? null);

	let linesShown = $derived(contentLines.length);

	/** Compact byte formatter ("1.2 KB", "845 B"). */
	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		const units = ["KB", "MB", "GB"];
		let value = bytes;
		let unit = -1;
		do {
			value /= 1024;
			unit++;
		} while (value >= 1024 && unit < units.length - 1);
		return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
	}

	async function handleCopy() {
		if (!result?.content) return;
		const ok = await copyToClipboard(result.content);
		if (ok) {
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 1500);
		}
	}
</script>

<div class="fv-panel" aria-label="File content viewer">
	{#if loading && !result}
		<!-- Loading skeleton -->
		<div class="fv-skeleton" aria-label="Loading file content">
			{#each Array(10) as _, i (i)}
				<div class="fv-skeleton-line" style="width:{60 + ((i * 17) % 38)}%;"></div>
			{/each}
		</div>
	{:else if error}
		<!-- Error state -->
		<div class="fv-state">
			<div class="fv-state-icon">
				<Icon name="triangle-alert" size={18} strokeWidth={1.75} />
			</div>
			<div class="fv-state-title">Failed to load file content</div>
			<div class="fv-state-text">{error}</div>
			<button class="fv-retry-btn" onclick={() => void fetchContent()}>
				<Icon name="refresh-cw" size={12} strokeWidth={2} />
				<span>Retry</span>
			</button>
		</div>
	{:else if !result}
		<!-- No file selected -->
		<div class="fv-state">
			<div class="fv-state-icon">
				<Icon name="file-text" size={18} strokeWidth={1.75} />
			</div>
			<div class="fv-state-title">Select a file to view its contents.</div>
		</div>
	{:else}
		<!-- Header: path + language + meta + copy -->
		<div class="fv-header">
			<span class="fv-header-icon"><Icon name="file-text" size={13} strokeWidth={1.75} /></span>
			<span class="fv-path" title={result.file_path}>{result.file_path}</span>
			{#if displayLanguage}
				<span class="fv-lang">{displayLanguage}</span>
			{/if}
			<span class="fv-meta">
				{result.lines} lines · {formatBytes(result.size_bytes)}
			</span>
			{#if result.truncated}
				<span class="fv-truncated" title="Only part of the file is shown — indexed/viewed content is capped.">
					truncated
				</span>
			{/if}
			<button
				class="fv-copy-btn"
				onclick={() => void handleCopy()}
				disabled={loading || !result.content}
				aria-label="Copy file content"
				title="Copy file content"
			>
				<Icon name={copied ? "check" : "copy"} size={12} strokeWidth={2} />
				<span>{copied ? "Copied" : "Copy"}</span>
			</button>
		</div>

		{#if result.truncated}
			<div class="fv-trunc-note">
				Showing first {linesShown} of {result.lines} lines — file truncated.
			</div>
		{/if}

		{#if contentLines.length === 0}
			<!-- Empty file -->
			<div class="fv-state compact">
				<div class="fv-state-title">Empty file — nothing to display.</div>
			</div>
		{:else}
			<!-- Code: line numbers + content, tab-size 4 -->
			<pre class="fv-code" aria-label="File content with line numbers">
				{#each contentLines as line, idx (idx)}
					<div class="fv-row">
						<span class="fv-ln">{idx + 1}</span>
						<span class="fv-line-text">{line}</span>
					</div>
				{/each}
			</pre>
		{/if}
	{/if}
</div>

<style>
	.fv-panel {
		margin-bottom: 12px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.02);
		overflow: hidden;
	}

	/* ── Skeleton ── */
	.fv-skeleton {
		padding: 12px 16px;
	}

	.fv-skeleton-line {
		height: 10px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.05);
		margin-bottom: 8px;
		animation: fv-pulse 1.6s ease-in-out infinite;
	}

	@keyframes fv-pulse {
		0%,
		100% {
			opacity: 0.4;
		}
		50% {
			opacity: 1;
		}
	}

	/* ── State (error / empty / no-file) ── */
	.fv-state {
		text-align: center;
		padding: 24px 16px;
	}

	.fv-state.compact {
		padding: 14px 16px;
	}

	.fv-state-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border-radius: 9px;
		background: rgba(239, 68, 68, 0.08);
		color: #ef4444;
		border: 1px solid rgba(239, 68, 68, 0.15);
		margin-bottom: 8px;
	}

	.fv-state-title {
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--color-text-muted);
		margin-bottom: 4px;
	}

	.fv-state-text {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		opacity: 0.8;
		margin-bottom: 10px;
	}

	.fv-retry-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 12px;
		border-radius: 7px;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.05);
		color: var(--color-text);
		font-size: 0.68rem;
		font-weight: 700;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.fv-retry-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		border-color: var(--color-primary);
	}

	/* ── Header ── */
	.fv-header {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.03);
		flex-wrap: wrap;
	}

	.fv-header-icon {
		color: var(--color-primary);
		opacity: 0.85;
		flex-shrink: 0;
	}

	.fv-path {
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.fv-lang {
		font-size: 0.6rem;
		font-weight: 700;
		color: var(--color-primary);
		background: rgba(99, 102, 241, 0.1);
		border: 1px solid rgba(99, 102, 241, 0.2);
		padding: 1px 6px;
		border-radius: 999px;
		flex-shrink: 0;
		text-transform: capitalize;
	}

	.fv-meta {
		font-size: 0.62rem;
		font-weight: 600;
		color: var(--color-text-muted);
		opacity: 0.85;
		flex-shrink: 0;
	}

	.fv-truncated {
		font-size: 0.56rem;
		font-weight: 800;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #f59e0b;
		background: rgba(245, 158, 11, 0.1);
		border: 1px solid rgba(245, 158, 11, 0.25);
		padding: 1px 6px;
		border-radius: 999px;
		flex-shrink: 0;
	}

	.fv-copy-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-left: auto;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.05);
		color: var(--color-text-muted);
		font-size: 0.62rem;
		font-weight: 700;
		padding: 3px 8px;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.12s ease;
		flex-shrink: 0;
	}

	.fv-copy-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.1);
		color: var(--color-text);
		border-color: var(--color-primary);
	}

	.fv-copy-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.fv-copy-btn:focus-visible,
	.fv-retry-btn:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
	}

	/* ── Truncation note ── */
	.fv-trunc-note {
		padding: 6px 12px;
		font-size: 0.64rem;
		font-weight: 600;
		color: #f59e0b;
		background: rgba(245, 158, 11, 0.06);
		border-bottom: 1px solid rgba(245, 158, 11, 0.15);
	}

	/* ── Code block ── */
	.fv-code {
		margin: 0;
		padding: 8px 0;
		max-height: 420px;
		overflow: auto;
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		font-size: 0.7rem;
		line-height: 1.55;
		tab-size: 4;
		-moz-tab-size: 4;
		white-space: pre;
	}

	.fv-row {
		display: flex;
		align-items: baseline;
		width: 100%;
		padding: 0 12px 0 0;
	}

	.fv-row:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	.fv-ln {
		flex-shrink: 0;
		width: 44px;
		padding-right: 12px;
		text-align: right;
		font-size: 0.62rem;
		color: var(--color-text-muted);
		opacity: 0.55;
		user-select: none;
	}

	.fv-line-text {
		flex: 1;
		min-width: 0;
		color: var(--color-text);
		opacity: 0.92;
		white-space: pre;
	}
</style>
