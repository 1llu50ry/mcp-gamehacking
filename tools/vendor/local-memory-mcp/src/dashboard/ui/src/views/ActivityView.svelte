<script lang="ts">
	import { get } from "svelte/store";
	import { currentRepo, recentActionsTotalItems } from "../lib/stores";
	import { createChatTask } from "../lib/utils";
	import RecentActions from "../components/RecentActions.svelte";
	import Icon from "../lib/Icon.svelte";
	import { PageHeader, Surface } from "../components/ui";

	/**
	 * Activity — the audit timeline for the selected workspace.
	 *
	 * Previously this view welded a chat composer to the bottom of the timeline
	 * inside one fixed-height `glass card`, which read as "reply to this feed".
	 * It does not reply to anything: it creates a backlog task. The composer is
	 * now a separate, clearly-labelled surface with an explicit button label
	 * ("Add task") that names the outcome instead of a bare send arrow.
	 *
	 * The timeline keeps its own scroll container so long histories don't push
	 * the composer off-screen, but the page itself is no longer locked to
	 * `calc(100vh - 180px)`, a magic number that clipped content on short
	 * viewports.
	 */
	let {
		onLoadPage,
		onRefresh
	}: {
		onLoadPage: (page?: number, append?: boolean) => Promise<boolean>;
		onRefresh: () => Promise<boolean>;
	} = $props();

	let chatMessage = $state("");
	let isSending = $state(false);
	let submitError = $state("");

	let liveRegionText = $state("");

	async function submitTask() {
		const message = chatMessage.trim();
		if (!message || isSending) return;
		const repo = get(currentRepo);
		if (!repo) return;

		isSending = true;
		submitError = "";
		try {
			await createChatTask(message, repo);
			chatMessage = "";
			liveRegionText = "Task created successfully";
			await onRefresh();
		} catch (e) {
			// The raw error goes to the console for engineers; the user gets a
			// sentence they can act on.
			console.error("Failed to create task from activity composer:", e);
			submitError = "Couldn't create the task. Try again.";
		} finally {
			isSending = false;
		}
	}
</script>

<PageHeader description="Every tool call and mutation recorded for this workspace, newest first.">
	{#snippet actions()}
		<span class="event-count">{$recentActionsTotalItems} events</span>
	{/snippet}
</PageHeader>

<div class="sr-only" aria-live="polite" aria-atomic="true">{liveRegionText}</div>

<div class="activity-stack">
	<Surface padding="none" label="Audit timeline">
		<div class="timeline-scroll">
			<RecentActions {onLoadPage} />
		</div>
	</Surface>

	<Surface label="Create a task">
		<form
			class="composer"
			onsubmit={(e) => {
				e.preventDefault();
				submitTask();
			}}
			aria-describedby={submitError ? "composer-error" : undefined}
		>
			<label class="composer-label" for="activity-task-input">Capture a follow-up</label>
			<div class="composer-row">
				<input
					id="activity-task-input"
					class="form-input"
					type="text"
					placeholder="e.g. Investigate the failed embedding jobs"
					bind:value={chatMessage}
					disabled={isSending}
					autocomplete="off"
				/>
				<button class="btn btn-primary" type="submit" disabled={!chatMessage.trim() || isSending}>
					<Icon name="plus" size={16} strokeWidth={2} />
					{isSending ? "Adding…" : "Add task"}
				</button>
			</div>
			<p class="composer-hint">Creates a backlog task in {$currentRepo || "this workspace"}.</p>
			{#if submitError}
				<p class="composer-error" id="composer-error" role="alert">{submitError}</p>
			{/if}
		</form>
	</Surface>
</div>

<style>
	.event-count {
		font-size: var(--text-secondary);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.activity-stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.timeline-scroll {
		max-height: 62vh;
		overflow-y: auto;
	}

	.composer {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.composer-label {
		font-size: var(--text-label);
		font-weight: var(--weight-medium);
		color: var(--color-text-muted);
	}

	.composer-row {
		display: flex;
		gap: var(--space-2);
	}

	.composer-row .form-input {
		flex: 1;
		min-width: 0;
	}

	.composer-hint {
		font-size: var(--text-label);
		color: var(--color-text-faint);
	}

	.composer-error {
		font-size: var(--text-secondary);
		color: var(--color-danger);
	}

	@media (max-width: 720px) {
		.composer-row {
			flex-direction: column;
		}
		.composer-row :global(.btn) {
			width: 100%;
			justify-content: center;
		}
	}
</style>
