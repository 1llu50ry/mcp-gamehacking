<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import {
		countChildren,
		getFileIcon,
		extLabel,
		extColor,
		formatKindCounts,
		aggregateSymbolCounts,
		isDir
	} from "../lib/fileTreeUtils";

	/** The tree node data */
	export let node: Record<string, unknown>;
	/** Depth level for indentation */
	export let depth: number = 0;
	/** Map of expanded directory paths */
	export let expandedDirs: Record<string, boolean> = {};
	/** Currently active/selected file path */
	export let activeFile: string | null = null;
	/** Callback to toggle directory expansion */
	export let onToggleDir: (path: string) => void = () => {};
	/** Callback to select a file */
	export let onSelectFile: (path: string) => void = () => {};

	/** Keyboard handler for interactive elements */
	function handleKeyDown(e: KeyboardEvent, action: () => void) {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			action();
		}
	}

	$: isDirNode = isDir(node);
	$: dirPath = (node.path as string) || (node.name as string) || "";
	$: dirName = (node.name as string) || dirPath.split("/").filter(Boolean).pop() || dirPath;
	$: fileName = (node.name as string) || ((node.path as string) || "").split("/").filter(Boolean).pop() || "file";
	$: filePath = (node.path as string) || fileName;
	$: fileExt = extLabel(fileName);
	$: indent = 12 + depth * 16;
</script>

{#if isDirNode}
	{@const counts = countChildren(node)}
	{@const dirKindCounts = aggregateSymbolCounts(node)}
	<li role="treeitem" aria-expanded={!!expandedDirs[dirPath]} aria-selected={false}>
		<button
			class="filetree-dir"
			on:click={() => onToggleDir(dirPath)}
			on:keydown={(e) => handleKeyDown(e, () => onToggleDir(dirPath))}
			style="padding-left:{indent}px;"
			aria-label="{expandedDirs[dirPath] ? 'Collapse' : 'Expand'} directory {dirName}"
		>
			<span class="filetree-chevron" class:expanded={!!expandedDirs[dirPath]}>
				<Icon name="chevron-right" size={12} strokeWidth={2} />
			</span>
			<Icon name="folder" size={14} strokeWidth={1.75} />
			<span class="filetree-name">{dirName}</span>
			<span class="filetree-badge">
				{counts.files}
				{counts.files === 1 ? "file" : "files"}
				{#if Object.keys(dirKindCounts).length > 0}
					<span class="filetree-badge-sep">&middot;</span>
					<span class="filetree-kind-badge">{formatKindCounts(dirKindCounts)}</span>
				{/if}
			</span>
		</button>

		{#if expandedDirs[dirPath] && Array.isArray(node.children)}
			<ul class="filetree-list filetree-children" role="group">
				{#each node.children as child (child.path || child.name)}
					<svelte:self node={child} depth={depth + 1} {expandedDirs} {activeFile} {onToggleDir} {onSelectFile} />
				{/each}
			</ul>
		{/if}
	</li>
{:else}
	<li role="treeitem" aria-selected={activeFile === filePath}>
		<button
			class="filetree-file"
			class:active={activeFile === filePath}
			on:click={() => onSelectFile(filePath)}
			on:keydown={(e) => handleKeyDown(e, () => onSelectFile(filePath))}
			style="padding-left:{indent}px;"
			aria-label="Open file {fileName}"
		>
			<Icon name={getFileIcon(fileName)} size={13} strokeWidth={1.75} />
			<span class="filetree-name">{fileName}</span>
			{#if fileExt}
				<span class="filetree-ext" style="color:{extColor(fileName)};">
					{fileExt}
				</span>
			{/if}
			{#if node.symbolCounts && typeof node.symbolCounts === "object"}
				<span class="filetree-kind-badge">{formatKindCounts(node.symbolCounts as Record<string, number>)}</span>
			{/if}
		</button>
	</li>
{/if}

<style>
	.filetree-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.filetree-children {
		border-left: 1px solid rgba(255, 255, 255, 0.06);
		margin-left: 18px;
	}

	:global(html.dark) .filetree-children {
		border-left-color: rgba(255, 255, 255, 0.08);
	}

	.filetree-dir {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		border: none;
		background: transparent;
		color: var(--color-text);
		font-size: var(--text-body);
		font-weight: 600;
		/* 24px tall was below the 36px minimum every other control in the
		   dashboard meets, and directory rows are the primary way to navigate
		   this tree. */
		min-height: 36px;
		padding: var(--space-2) var(--space-3);
		cursor: pointer;
		transition: background 0.12s ease;
		border-radius: 6px;
		margin: 1px 6px;
		text-align: left;
	}

	.filetree-dir:hover {
		background: rgba(255, 255, 255, 0.06);
	}

	:global(html.dark) .filetree-dir:hover {
		background: rgba(255, 255, 255, 0.04);
	}

	.filetree-dir:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: -2px;
	}

	.filetree-chevron {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		transition: transform 0.15s ease;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.filetree-chevron.expanded {
		transform: rotate(90deg);
	}

	.filetree-file {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		font-size: var(--text-body);
		font-weight: 500;
		min-height: 36px;
		padding: var(--space-2) var(--space-3);
		cursor: pointer;
		transition:
			background 0.12s ease,
			color 0.12s ease;
		border-radius: 6px;
		margin: 1px 6px;
		text-align: left;
	}

	.filetree-file:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--color-text);
	}

	:global(html.dark) .filetree-file:hover {
		background: rgba(255, 255, 255, 0.04);
	}

	.filetree-file.active {
		background: rgba(14, 165, 233, 0.1);
		color: var(--color-primary);
		border: 1px solid rgba(14, 165, 233, 0.15);
	}

	.filetree-file:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: -2px;
	}

	.filetree-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
		min-width: 0;
	}

	.filetree-ext {
		font-size: 0.58rem;
		font-weight: 700;
		padding: 1px 5px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.06);
		flex-shrink: 0;
		letter-spacing: 0.02em;
	}

	.filetree-badge {
		font-size: 0.58rem;
		font-weight: 600;
		color: var(--color-text-muted);
		opacity: 0.7;
		margin-left: auto;
		flex-shrink: 0;
		white-space: nowrap;
	}

	.filetree-badge-sep {
		margin: 0 2px;
		opacity: 0.5;
	}

	.filetree-kind-badge {
		font-size: 0.52rem;
		font-weight: 600;
		color: var(--color-text-muted);
		opacity: 0.65;
		background: rgba(255, 255, 255, 0.04);
		padding: 1px 5px;
		border-radius: 3px;
		flex-shrink: 0;
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		letter-spacing: 0.02em;
		white-space: nowrap;
	}

	/* Touch devices need a larger target than the 36px pointer minimum. */
	@media (pointer: coarse) {
		.filetree-dir,
		.filetree-file {
			min-height: 44px;
		}
	}
</style>
