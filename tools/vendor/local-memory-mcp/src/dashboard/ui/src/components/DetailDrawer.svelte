<script lang="ts">
	import { onDestroy } from "svelte";
	import type { Memory, Task, CodingStandard, Handoff } from "../lib/stores";
	import { getStatusColor, getStatusLabel } from "../lib/utils";
	import { createDetailHandler } from "../lib/composables/useDetail";
	import { createFocusTrap } from "../lib/focusTrap";
	import MemoryDetailPanel from "./MemoryDetailPanel.svelte";
	import TaskDetailPanel from "./TaskDetailPanel.svelte";
	import HandoffDetailPanel from "./HandoffDetailPanel.svelte";
	import StandardDetailPanel from "./StandardDetailPanel.svelte";
	import Icon from "../lib/Icon.svelte";

	export let memory: Memory | null = null;
	export let task: Task | null = null;
	export let standard: CodingStandard | null = null;
	export let handoff: Handoff | null = null;
	export let open = false;
	export let onClose: () => void = () => {};
	export let onTaskUpdated: (task: Task) => void = () => {};
	export let onTaskDeleted: (id: string) => void = () => {};
	export let onStandardUpdated: (standard: CodingStandard) => void = () => {};
	export let onStandardDeleted: (id: string) => void = () => {};
	export let onHandoffUpdated: () => void = () => {};
	export let onHandoffCreated: () => void = () => {};
	export let repo: string | null = null;

	export let drawerMode: "memory" | "task" | "handoff" | "standard" | "new-handoff" = "memory";

	const handler = createDetailHandler();
	const handlerMode = handler.mode;

	$: if (open) {
		if (drawerMode === "memory" && memory) {
			handler.setMemory(memory);
		} else if (drawerMode === "task" && task) {
			handler.setTask(task);
		} else if (drawerMode === "standard") {
			handler.setStandard(standard);
		} else if (drawerMode === "handoff" && handoff) {
			handler.setHandoff(handoff);
		} else if (drawerMode === "new-handoff") {
			handler.initNewHandoff(repo || "");
		}
	} else {
		handler.reset();
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Escape") onClose();
	}

	$: dialogLabel =
		$handlerMode === "memory"
			? `Memory details: ${$handler.memory?.title || "Untitled memory"}`
			: $handlerMode === "task"
				? `Task details: ${$handler.task?.title || "Untitled task"}`
				: $handlerMode === "standard"
					? `${standard ? "Standard details" : "New standard"}`
					: $handlerMode === "new-handoff"
						? "New handoff"
						: `Handoff details: ${handoff?.summary || "Untitled handoff"}`;

	// ── Focus management (audit F4/F9 / TASK-272) ──────────────────────────
	// Move focus into the drawer on open, wrap Tab inside it while open, and
	// restore focus to the trigger on close. This also fixes Escape closing
	// the Handoff drawer: focus now actually lands inside it, so its own
	// Escape handler (the trusted task-drawer pattern) fires. Deferred with
	// requestAnimationFrame so the {#if open} DOM exists before activating.
	let drawerPanel: HTMLDivElement | undefined;
	let trapFocus: ReturnType<typeof createFocusTrap> | null = null;

	$: if (open && drawerPanel) {
		requestAnimationFrame(() => {
			if (open && drawerPanel) {
				trapFocus?.deactivate();
				trapFocus = createFocusTrap(drawerPanel, { onEscape: onClose });
				trapFocus.activate();
			}
		});
	} else if (!open) {
		trapFocus?.deactivate();
		trapFocus = null;
	}

	// TASK-399 belt-and-braces: never let the trap's keydown listener survive
	// component destruction (idempotent — deactivate() early-returns when not
	// active). Together with the else-branch above, Tab can never stay frozen
	// on one element after the drawer closes.
	onDestroy(() => {
		trapFocus?.deactivate();
		trapFocus = null;
	});
</script>

{#if open && $handlerMode}
	<div
		class="drawer-overlay"
		on:click={onClose}
		on:keydown={handleKeyDown}
		role="button"
		tabindex="0"
		aria-label="Close drawer"
	></div>

	<div
		class="drawer-panel animate-fade-in"
		bind:this={drawerPanel}
		on:click|stopPropagation
		on:keydown={handleKeyDown}
		role="dialog"
		aria-modal="true"
		aria-label={dialogLabel}
		tabindex="-1"
	>
		<div class="drawer-header">
			{#if $handlerMode === "memory" && $handler.memory}
				<div>
					<span class="type-chip type-{$handler.memory.type}" style="margin-bottom:8px;display:inline-flex;"
						>{$handler.memory.type}</span
					>
					<div class="drawer-title">{$handler.memory.title || "Untitled Memory"}</div>
				</div>
			{:else if $handlerMode === "task" && $handler.task}
				<div style="flex:1;min-width:0;">
					<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
						<span class="status-chip {getStatusColor($handler.task.status || 'pending')}"
							>{getStatusLabel($handler.task.status || "")}</span
						>
						<span style="font-size:0.7rem;font-weight:700;color:var(--color-text-muted);"
							>{$handler.task.task_code || "NEW-TASK"}</span
						>
					</div>
					{#if $handler.editingTitle}
						<div style="display:flex;gap:6px;align-items:center;">
							<input
								class="form-input"
								bind:value={$handler.editTitle}
								style="font-size:0.95rem;font-weight:700;flex:1;"
								on:keydown={(e) => handler.handleTitleKeydown(e, onTaskUpdated)}
							/>
							<button
								class="btn btn-accent"
								style="padding:4px 10px;font-size:0.75rem;"
								on:click={() => handler.saveTitle(onTaskUpdated)}>Save</button
							>
							<button
								class="btn btn-ghost"
								style="padding:4px 10px;font-size:0.75rem;"
								on:click={() => handler.toggleEditTitle(false)}>✕</button
							>
						</div>
					{:else}
						<button
							class="drawer-title editable-title"
							on:click={() => handler.toggleEditTitle(true)}
							title="Click to edit title"
							style="text-align:left;background:none;border:none;padding:0;width:100%;cursor:pointer;"
						>
							{$handler.task?.title ?? ""}
							<span class="edit-hint">✏️</span>
						</button>
					{/if}
				</div>
			{/if}

			<button class="btn btn-ghost btn-icon" on:click={onClose} aria-label="Close" style="flex-shrink:0;">
				<Icon name="x" size={24} />
			</button>
		</div>

		<div class="drawer-body">
			{#if $handlerMode === "memory" && $handler.memory}
				<MemoryDetailPanel {handler} />
			{/if}

			{#if $handlerMode === "task" && $handler.task}
				<TaskDetailPanel {handler} {onClose} {onTaskUpdated} {onTaskDeleted} />
			{/if}

			{#if $handlerMode === "handoff"}
				<HandoffDetailPanel {handler} {onClose} {onHandoffCreated} {onHandoffUpdated} repo={repo || ""} />
			{/if}

			{#if $handlerMode === "standard"}
				<StandardDetailPanel {handler} {onClose} {onStandardUpdated} {onStandardDeleted} {repo} />
			{/if}
		</div>
	</div>
{/if}

<style>
	.drawer-header {
		padding: 24px;
		border-bottom: 1px solid var(--color-border);
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		flex-shrink: 0;
	}
	.drawer-title {
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--color-text);
		line-height: 1.3;
	}
	.editable-title {
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 6px;
		border-radius: 6px;
		padding: 2px 4px;
		margin: -2px -4px;
		transition: background 0.15s;
	}
	.editable-title:hover {
		background: rgba(99, 102, 241, 0.07);
	}
	.edit-hint {
		font-size: 0.7rem;
		opacity: 0;
		transition: opacity 0.15s;
	}
	.editable-title:hover .edit-hint {
		opacity: 1;
	}
	.drawer-body {
		padding: 24px;
		flex: 1;
		overflow-y: auto;
	}

	@media (max-width: 640px) {
		.drawer-panel {
			top: auto;
			width: 100%;
			max-width: none;
			height: min(92dvh, 900px);
			border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		}

		.drawer-header,
		.drawer-body {
			padding: 20px;
		}
	}
</style>
