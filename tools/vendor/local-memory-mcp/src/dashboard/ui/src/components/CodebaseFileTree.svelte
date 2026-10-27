<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { countChildren, isDir } from "../lib/fileTreeUtils";
	import FileTreeNode from "./FileTreeNode.svelte";
	import FileTreeHeader from "./FileTreeHeader.svelte";

	/** Directory/file tree data from codebase index */
	export let architecture: Record<string, unknown>[] | null = null;
	/** Callback when a file is selected */
	export let onFileSelect: ((filePath: string) => void) | null = null;
	/** Loading state */
	export let loading: boolean = false;
	/** Error state message */
	export let error: string | null = null;
	/** Retry callback for error state */
	export let onRetry: (() => void) | null = null;

	// Track which directories are expanded
	let expandedDirs: Record<string, boolean> = {};
	// Currently active/selected file
	let activeFile: string | null = null;

	/** Toggle directory expansion */
	function toggleDir(path: string) {
		expandedDirs[path] = !expandedDirs[path];
		expandedDirs = expandedDirs; // trigger reactivity
	}

	/** Select a file and invoke callback */
	function selectFile(filePath: string) {
		activeFile = filePath;
		if (typeof onFileSelect === "function") {
			onFileSelect(filePath);
		}
	}

	/** Keyboard handler for interactive elements */
	function handleKeyDown(e: KeyboardEvent, action: () => void) {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			action();
		}
	}

	/** Count total files in the entire tree */
	function countTotalFiles(nodes: Record<string, unknown>[]): number {
		return nodes.reduce((sum, node) => sum + countChildren(node).files, 0);
	}

	/** Toggle all directories expanded/collapsed */
	function toggleAll() {
		if (!architecture || !Array.isArray(architecture)) return;
		const allExpanded = areAllExpanded(architecture);
		const newState: Record<string, boolean> = {};
		function visit(nodes: Record<string, unknown>[]) {
			for (const node of nodes) {
				if (isDir(node)) {
					const p = (node.path as string) || (node.name as string) || "";
					newState[p] = !allExpanded;
					if (Array.isArray(node.children)) {
						visit(node.children);
					}
				}
			}
		}
		visit(architecture);
		expandedDirs = newState;
	}

	/** Check if all directories are expanded */
	function areAllExpanded(nodes: Record<string, unknown>[]): boolean {
		for (const node of nodes) {
			if (isDir(node)) {
				const p = (node.path as string) || (node.name as string) || "";
				if (!expandedDirs[p]) return false;
				if (Array.isArray(node.children) && !areAllExpanded(node.children)) return false;
			}
		}
		return true;
	}

	$: totalFiles = architecture && Array.isArray(architecture) ? countTotalFiles(architecture) : 0;
	$: allExpanded = architecture && Array.isArray(architecture) ? areAllExpanded(architecture) : false;
</script>

<!-- ═══════════════════════════════════════════════════════════════════════════ -->
<!-- Loading State -->
<!-- ═══════════════════════════════════════════════════════════════════════════ -->
{#if loading}
	<div class="filetree-skeleton" aria-label="Loading file tree">
		{#each Array(8) as _, i (i)}
			<div class="skeleton-row" style="padding-left:{12 + (i % 3) * 16}px;">
				<div class="skeleton-icon skeleton-pulse"></div>
				<div class="skeleton-text skeleton-pulse" style="width:{50 + ((i * 17) % 40)}%;"></div>
			</div>
		{/each}
	</div>

	<!-- ═══════════════════════════════════════════════════════════════════════════ -->
	<!-- Error State -->
	<!-- ═══════════════════════════════════════════════════════════════════════════ -->
{:else if error}
	<div class="filetree-state">
		<div class="filetree-state-icon error">
			<Icon name="triangle-alert" size={20} strokeWidth={1.5} />
		</div>
		<div class="filetree-state-title">Failed to load file tree</div>
		<div class="filetree-state-text">{error}</div>
		{#if typeof onRetry === "function"}
			<button
				class="filetree-retry-btn"
				on:click={() => onRetry?.()}
				on:keydown={(e) => handleKeyDown(e, () => onRetry?.())}
			>
				<Icon name="refresh-cw" size={12} strokeWidth={2} />
				<span>Retry</span>
			</button>
		{/if}
	</div>

	<!-- ═══════════════════════════════════════════════════════════════════════════ -->
	<!-- Empty State -->
	<!-- ═══════════════════════════════════════════════════════════════════════════ -->
{:else if !architecture || !Array.isArray(architecture) || architecture.length === 0}
	<div class="filetree-state">
		<div class="filetree-state-icon empty">
			<Icon name="folder-open" size={20} strokeWidth={1.5} />
		</div>
		<div class="filetree-state-title">No files indexed</div>
		<div class="filetree-state-text">
			This repository hasn't been indexed yet. Start indexing to browse its file structure.
		</div>
	</div>

	<!-- ═══════════════════════════════════════════════════════════════════════════ -->
	<!-- File Tree -->
	<!-- ═══════════════════════════════════════════════════════════════════════════ -->
{:else}
	<FileTreeHeader {allExpanded} onToggleAll={toggleAll} fileCount={totalFiles} />
	<nav class="filetree" aria-label="File tree">
		<ul class="filetree-list" role="tree">
			{#each architecture as node (node.path || node.name)}
				<FileTreeNode
					{node}
					depth={0}
					bind:expandedDirs
					bind:activeFile
					onToggleDir={toggleDir}
					onSelectFile={selectFile}
				/>
			{/each}
		</ul>
	</nav>
{/if}

<style>
	/* ── Skeleton Loading ── */
	.filetree-skeleton {
		padding: 8px 0;
	}

	.skeleton-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
	}

	.skeleton-icon {
		width: 14px;
		height: 14px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.06);
		flex-shrink: 0;
	}

	.skeleton-text {
		height: 10px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.06);
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

	/* ── State Containers ── */
	.filetree-state {
		text-align: center;
		padding: 24px 16px;
	}

	.filetree-state-icon {
		display: inline-flex;
		width: 44px;
		height: 44px;
		border-radius: 12px;
		align-items: center;
		justify-content: center;
		margin-bottom: 10px;
	}

	.filetree-state-icon.empty {
		background: rgba(14, 165, 233, 0.1);
		color: var(--color-primary);
		border: 1px solid rgba(14, 165, 233, 0.15);
	}

	.filetree-state-icon.error {
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
		border: 1px solid rgba(239, 68, 68, 0.15);
	}

	.filetree-state-title {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 4px;
	}

	.filetree-state-text {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		line-height: 1.5;
		margin-bottom: 10px;
	}

	.filetree-retry-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 6px 14px;
		border-radius: 8px;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.06);
		color: var(--color-text);
		font-size: 0.72rem;
		font-weight: 700;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.filetree-retry-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		border-color: var(--color-primary);
	}

	/* ── Tree Layout ── */
	.filetree {
		padding: 4px 0;
	}

	.filetree-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
</style>
