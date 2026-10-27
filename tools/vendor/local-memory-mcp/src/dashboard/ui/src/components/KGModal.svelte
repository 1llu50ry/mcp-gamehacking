<script lang="ts">
	import { createEventDispatcher } from "svelte";
	import Icon from "$lib/Icon.svelte";
	import { createFocusTrap } from "$lib/focusTrap";
	import type { LayoutNode } from "$lib/kg/KGForceLayout";

	const dispatch = createEventDispatcher<{
		addEntity: { name: string; type: string; description?: string };
		addRelation: { from_entity: string; to_entity: string; relation_type: string };
		delete: void;
		close: void;
	}>();

	export let mode: "addEntity" | "addRelation" | "deleteConfirm" = "addEntity";
	export let show = false;
	export let entityNodes: LayoutNode[] = [];
	export let deleteTarget: { type: "node" | "edge"; name?: string } | null = null;

	// Add Entity form state
	let entityName = "";
	let entityType = "concept";
	let entityDesc = "";

	// Add Relation form state
	let relFrom = "";
	let relTo = "";
	let relType = "";

	function handleOverlayClick() {
		dispatch("close");
	}

	function handleCancel() {
		dispatch("close");
	}

	function handleAddEntity() {
		if (!entityName.trim()) return;
		dispatch("addEntity", {
			name: entityName.trim(),
			type: entityType,
			description: entityDesc.trim() || undefined
		});
		entityName = "";
		entityType = "concept";
		entityDesc = "";
	}

	function handleAddRelation() {
		if (!relFrom || !relTo || !relType.trim()) return;
		dispatch("addRelation", {
			from_entity: relFrom,
			to_entity: relTo,
			relation_type: relType.trim()
		});
		relFrom = "";
		relTo = "";
		relType = "";
	}

	function handleDelete() {
		dispatch("delete");
	}

	// ── Focus management (audit F4/F9 / TASK-272) ──────────────────────────
	// KGModal previously had NO Escape handling at all — the trap routes
	// Escape to close and moves/keeps focus inside while open.
	let modalPanel: HTMLDivElement | undefined;
	let trapFocus: ReturnType<typeof createFocusTrap> | null = null;

	$: if (show && modalPanel) {
		requestAnimationFrame(() => {
			if (show && modalPanel) {
				trapFocus?.deactivate();
				trapFocus = createFocusTrap(modalPanel, { onEscape: () => dispatch("close") });
				trapFocus.activate();
			}
		});
	} else if (!show) {
		trapFocus?.deactivate();
		trapFocus = null;
	}
</script>

{#if show}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<div class="modal-overlay" on:click={handleOverlayClick} role="button" tabindex="0" aria-label="Close"></div>
	<div class="modal-panel animate-fade-in-scale" bind:this={modalPanel} role="dialog" aria-modal="true" tabindex="-1">
		{#if mode === "deleteConfirm"}
			<div class="modal-header">
				<Icon name="trash" size={14} strokeWidth={1.75} />
				<span>Confirm Delete</span>
			</div>
			<div class="modal-body">
				{#if deleteTarget?.type === "node"}
					<p>Are you sure you want to delete entity <strong>{deleteTarget.name}</strong>?</p>
				{:else}
					<p>Are you sure you want to delete this relation?</p>
					<p style="font-size:0.8rem;color:var(--color-text-muted);margin-top:4px;">{deleteTarget?.name}</p>
				{/if}
			</div>
			<div class="modal-footer">
				<button class="btn btn-ghost btn-sm" on:click={handleCancel}>Cancel</button>
				<button
					class="btn btn-sm"
					style="background:var(--color-danger);color:white;border:none;"
					on:click={handleDelete}>Delete</button
				>
			</div>
		{:else if mode === "addEntity"}
			<div class="modal-header">
				<Icon name="plus" size={14} strokeWidth={1.75} />
				<span>Add Entity</span>
			</div>
			<div class="modal-body">
				<div class="form-group">
					<label class="form-label" for="entity-name">Name *</label>
					<input id="entity-name" class="form-input" type="text" bind:value={entityName} placeholder="Entity name" />
				</div>
				<div class="form-group">
					<label class="form-label" for="entity-type">Type</label>
					<select id="entity-type" class="form-select" bind:value={entityType}>
						<option value="person">Person</option>
						<option value="place">Place</option>
						<option value="organization">Organization</option>
						<option value="concept">Concept</option>
						<option value="unknown">Unknown</option>
					</select>
				</div>
				<div class="form-group">
					<label class="form-label" for="entity-desc">Description</label>
					<textarea
						id="entity-desc"
						class="form-textarea"
						bind:value={entityDesc}
						placeholder="Optional description"
						rows="2"
					></textarea>
				</div>
			</div>
			<div class="modal-footer">
				<button class="btn btn-ghost btn-sm" on:click={handleCancel}>Cancel</button>
				<button class="btn btn-primary btn-sm" on:click={handleAddEntity} disabled={!entityName.trim()}>Create</button>
			</div>
		{:else if mode === "addRelation"}
			<div class="modal-header">
				<Icon name="link" size={14} strokeWidth={1.75} />
				<span>Add Relation</span>
			</div>
			<div class="modal-body">
				<div class="form-group">
					<label class="form-label" for="rel-from">From Entity *</label>
					<select id="rel-from" class="form-select" bind:value={relFrom}>
						<option value="">Select entity...</option>
						{#each entityNodes as n, i (`${n.id}-${i}`)}
							<option value={n.name}>{n.name}</option>
						{/each}
					</select>
				</div>
				<div class="form-group">
					<label class="form-label" for="rel-to">To Entity *</label>
					<select id="rel-to" class="form-select" bind:value={relTo}>
						<option value="">Select entity...</option>
						{#each entityNodes as n, i (`${n.id}-${i}`)}
							<option value={n.name}>{n.name}</option>
						{/each}
					</select>
				</div>
				<div class="form-group">
					<label class="form-label" for="rel-type">Relation Type *</label>
					<input
						id="rel-type"
						class="form-input"
						type="text"
						bind:value={relType}
						placeholder="e.g., knows, located_in, works_at"
					/>
				</div>
			</div>
			<div class="modal-footer">
				<button class="btn btn-ghost btn-sm" on:click={handleCancel}>Cancel</button>
				<button
					class="btn btn-primary btn-sm"
					on:click={handleAddRelation}
					disabled={!relFrom || !relTo || !relType.trim()}>Create</button
				>
			</div>
		{/if}
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(1, 12, 30, 0.55);
		z-index: 60;
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
	}

	.modal-panel {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 61;
		background: var(--glass-bg-ultra);
		backdrop-filter: blur(28px) saturate(1.2);
		-webkit-backdrop-filter: blur(28px) saturate(1.2);
		border: 1px solid var(--glass-border);
		border-radius: 16px;
		box-shadow: var(--glass-shadow-elevated);
		width: min(400px, 90vw);
		max-height: 80vh;
		overflow-y: auto;
	}

	:global(.dark) .modal-panel {
		background: var(--panel-dark-ultra);
		border-color: var(--panel-dark-border);
		box-shadow: var(--panel-dark-shadow);
	}

	.modal-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 16px 20px;
		font-weight: 800;
		font-size: 0.9rem;
		color: var(--color-text);
		border-bottom: 1px solid var(--color-border);
	}

	:global(.dark) .modal-header {
		border-color: rgba(148, 163, 184, 0.1);
	}

	.modal-body {
		padding: 16px 20px;
	}

	.modal-footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		padding: 12px 20px;
		border-top: 1px solid var(--color-border);
	}

	:global(.dark) .modal-footer {
		border-color: rgba(148, 163, 184, 0.1);
	}

	.form-group {
		margin-bottom: 12px;
	}

	.form-label {
		display: block;
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		margin-bottom: 4px;
	}
</style>
