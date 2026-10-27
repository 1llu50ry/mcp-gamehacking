<script lang="ts">
	import { getStatusLabel, getPriorityLabel } from "../lib/utils";
	import Icon from "../lib/Icon.svelte";
	import { createFocusTrap } from "../lib/focusTrap";
	import type { Task } from "../lib/stores";

	export let open = false;
	export let newTask: Partial<Task>;
	export let onClose: () => void = () => {};
	export let onSave: () => void = () => {};

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Escape") onClose();
	}

	// ── Focus management (audit F4/F9 / TASK-272) ──────────────────────────
	let modalPanel: HTMLDivElement | undefined;
	let trapFocus: ReturnType<typeof createFocusTrap> | null = null;

	$: if (open && modalPanel) {
		requestAnimationFrame(() => {
			if (open && modalPanel) {
				trapFocus?.deactivate();
				trapFocus = createFocusTrap(modalPanel, { onEscape: onClose });
				trapFocus.activate();
			}
		});
	} else if (!open) {
		trapFocus?.deactivate();
		trapFocus = null;
	}
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if open}
	<!-- Backdrop -->
	<div
		class="modal-backdrop"
		role="button"
		tabindex="-1"
		aria-label="Close modal"
		on:click={onClose}
		on:keydown={(e) => e.key === "Escape" && onClose()}
	></div>

	<!-- Modal panel -->
	<div
		class="modal-panel animate-fade-in"
		bind:this={modalPanel}
		role="dialog"
		aria-modal="true"
		aria-labelledby="modal-title"
		tabindex="-1"
	>
		<!-- Header -->
		<div class="modal-header">
			<div class="modal-header-icon">
				<Icon name="clipboard-list" size={14} strokeWidth={2.2} />
			</div>
			<div>
				<div id="modal-title" class="modal-title">New Task</div>
				<div class="modal-subtitle">Add a task to the current repository</div>
			</div>
			<button class="modal-close-btn" on:click={onClose} aria-label="Close">
				<Icon name="x" size={14} strokeWidth={2.5} />
			</button>
		</div>

		<!-- Form body -->
		<div class="modal-body">
			<!-- Row: Task Code + Phase -->
			<div class="field-grid-2">
				<div class="field-group">
					<label class="field-label" for="new_task_code">Task Code <span class="required">*</span></label>
					<input id="new_task_code" class="form-input" bind:value={newTask.task_code} placeholder="TASK-001" />
				</div>
				<div class="field-group">
					<label class="field-label" for="new_task_phase">Phase</label>
					<input id="new_task_phase" class="form-input" bind:value={newTask.phase} placeholder="Implementation" />
				</div>
			</div>

			<!-- Title -->
			<div class="field-group">
				<label class="field-label" for="new_task_title">
					Title <span class="required">*</span>
					<span class="field-hint">{(newTask.title ?? "").length}/80</span>
				</label>
				<input
					id="new_task_title"
					class="form-input"
					bind:value={newTask.title}
					placeholder="Short, descriptive task title"
					maxlength="80"
				/>
			</div>

			<!-- Description -->
			<div class="field-group">
				<label class="field-label" for="new_task_description">Description</label>
				<textarea
					id="new_task_description"
					class="form-textarea modal-textarea"
					bind:value={newTask.description}
					placeholder="What needs to be done? Include context, acceptance criteria, etc."
					rows="4"
				></textarea>
			</div>

			<!-- Status + Priority -->
			<div class="field-grid-2">
				<div class="field-group">
					<label class="field-label" for="new_task_status">Status</label>
					<select id="new_task_status" class="form-select" bind:value={newTask.status}>
						{#each ["backlog", "pending", "in_progress"] as s (s)}
							<option value={s}>{getStatusLabel(s)}</option>
						{/each}
					</select>
				</div>
				<div class="field-group">
					<label class="field-label" for="new_task_priority">Priority</label>
					<select id="new_task_priority" class="form-select" bind:value={newTask.priority}>
						{#each [1, 2, 3, 4, 5] as p (p)}
							<option value={p}>{getPriorityLabel(p)}</option>
						{/each}
					</select>
				</div>
			</div>
		</div>

		<!-- Footer -->
		<div class="modal-footer">
			<button class="btn btn-ghost" on:click={onClose}>Cancel</button>
			<button class="btn btn-primary modal-save-btn" on:click={onSave} disabled={!newTask.task_code || !newTask.title}>
				<Icon name="plus" size={13} strokeWidth={2.5} />
				Create Task
			</button>
		</div>
	</div>
{/if}

<style>
	/* ── Backdrop ── */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 58;
		background: rgba(1, 12, 30, 0.45);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
	}

	/* ── Panel ── */
	.modal-panel {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 59;
		width: 520px;
		max-width: 95vw;
		max-height: 92vh;
		overflow-y: auto;
		border-radius: 20px;
		background: var(--color-surface, #fff);
		border: 1px solid var(--color-border);
		box-shadow:
			0 32px 96px rgba(1, 12, 30, 0.2),
			0 8px 32px rgba(1, 12, 30, 0.12),
			inset 0 1px 0 rgba(255, 255, 255, 0.7);
		display: flex;
		flex-direction: column;
	}

	:global(html.dark) .modal-panel {
		background: #070f1f;
		border-color: rgba(148, 163, 184, 0.12);
		box-shadow:
			0 32px 96px rgba(0, 0, 0, 0.6),
			0 8px 32px rgba(0, 0, 0, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.04);
	}

	/* ── Header ── */
	.modal-header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 18px 20px 16px;
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.modal-header-icon {
		width: 34px;
		height: 34px;
		border-radius: 10px;
		background: linear-gradient(135deg, #0ea5e9, #6366f1);
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		flex-shrink: 0;
		box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3);
	}

	.modal-title {
		font-size: 0.9rem;
		font-weight: 800;
		color: var(--color-text);
		letter-spacing: -0.01em;
	}

	.modal-subtitle {
		font-size: 0.68rem;
		color: var(--color-text-muted);
		margin-top: 1px;
	}

	.modal-close-btn {
		margin-left: auto;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 8px;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
		flex-shrink: 0;
	}

	.modal-close-btn:hover {
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
	}

	/* ── Body ── */
	.modal-body {
		padding: 18px 20px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		flex: 1;
	}

	/* ── Fields ── */
	.field-grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}

	.field-group {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.field-label {
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.required {
		color: #ef4444;
		font-size: 0.7rem;
	}

	.field-hint {
		margin-left: auto;
		font-size: 0.62rem;
		font-weight: 500;
		color: var(--color-text-faint);
		text-transform: none;
		letter-spacing: 0;
	}

	.modal-textarea {
		resize: vertical;
		min-height: 96px;
		font-size: 0.82rem;
		line-height: 1.55;
	}

	/* ── Footer ── */
	.modal-footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		padding: 14px 20px;
		border-top: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.modal-save-btn:disabled {
		opacity: 0.45;
		pointer-events: none;
	}
</style>
