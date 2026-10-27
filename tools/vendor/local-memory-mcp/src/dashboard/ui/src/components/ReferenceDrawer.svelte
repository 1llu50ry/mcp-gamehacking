<script lang="ts">
	import { onDestroy } from "svelte";
	import { currentRepo } from "../lib/stores";
	import type { ReferenceItem } from "../lib/stores";
	import Icon from "../lib/Icon.svelte";
	import Markdown from "./Markdown.svelte";
	import { createReferenceHandler } from "../lib/composables/useReference";
	import { createFocusTrap } from "../lib/focusTrap";

	export let item: ReferenceItem | null = null;
	export let open = false;
	export let onClose: () => void = () => {};

	const handler = createReferenceHandler();
	const typeLabel = handler.typeLabel;

	$: if (open) {
		handler.setItem(item, $currentRepo);
	} else {
		handler.reset();
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Escape") onClose();
	}

	// ── Focus management (audit F4/F9 / TASK-272) ──────────────────────────
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

{#if open && $handler.item}
	<div
		class="drawer-overlay"
		on:click={(e) => handler.handleOverlayClick(e, onClose)}
		on:keydown={handleKeyDown}
		role="button"
		tabindex="0"
		aria-label="Close drawer"
		style="z-index: 100;"
	></div>

	<div
		class="drawer-panel animate-fade-in"
		bind:this={drawerPanel}
		on:click={handler.handlePanelClick}
		on:keydown={handleKeyDown}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		style="z-index: 101;"
	>
		<div class="drawer-header">
			<div style="flex:1; min-width:0; padding-right:16px;">
				<span class="type-chip" style="margin-bottom:8px;display:inline-flex;">{$typeLabel}</span>
				<div class="drawer-title">{$handler.item.data.name}</div>
			</div>
			<button class="btn btn-ghost btn-icon" on:click={onClose} aria-label="Close" style="flex-shrink:0;">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
					<path d="M18 6 6 18M6 6l12 12" />
				</svg>
			</button>
		</div>

		<div class="drawer-body">
			{#if $handler.item.data.description}
				<div class="drawer-section">
					<div class="section-label">Description</div>
					<div class="markdown-body md-card">
						<Markdown content={$handler.item.data.description} />
					</div>
				</div>
			{/if}

			{#if $handler.item.type === "tool"}
				<div class="drawer-section">
					{#if $handler.item.data.inputSchema?.properties && Object.keys($handler.item.data.inputSchema.properties).length > 0}
						<div class="section-label">Playground (Input Parameters)</div>
						{#each Object.entries($handler.item.data.inputSchema.properties) as [key, param] (key)}
							<div
								style="border: 1px solid var(--color-border); border-radius: 4px; padding: 8px 10px; margin-bottom: 6px; background: rgba(0,0,0,0.01);"
							>
								<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 4px;">
									<span style="color: var(--color-text); font-family: monospace; font-size: 0.8rem; font-weight: 600;"
										>{key}</span
									>
									<div style="display:flex; gap: 8px; align-items: center;">
										<span style="font-size: 0.7rem; color: var(--color-text-muted);">{param.type}</span>
										{#if $handler.item.data.inputSchema.required?.includes(key)}
											<span
												style="font-size: 0.6rem; color: #ef4444; font-weight: bold; background: rgba(239, 68, 68, 0.1); padding: 2px 4px; border-radius: 4px;"
												>REQ</span
											>
										{/if}
									</div>
								</div>
								{#if param.description}
									<div
										style="font-size: 0.75rem; color: var(--color-text-muted); margin-bottom: 6px; line-height: 1.2;"
									>
										{param.description}
									</div>
								{/if}
								<input
									type="text"
									class="form-input"
									style="font-size:0.8rem; padding: 4px 8px; border-radius: 4px; min-height: 28px;"
									placeholder={`Value for ${key}`}
									value={$handler.toolArgs[key] || ""}
									on:input={(e) => handler.setToolArg(key, e.currentTarget.value)}
								/>
							</div>
						{/each}
					{:else}
						<div class="section-label">Playground</div>
						<div style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 8px;">
							No arguments required.
						</div>
					{/if}

					<!-- Submit button -->
					<div style="margin-top: 8px;">
						<button
							class="btn btn-accent"
							style="width:100%"
							on:click={() => handler.runTool()}
							disabled={$handler.toolRunning}
						>
							{$handler.toolRunning ? "Running..." : "Submit"}
						</button>
					</div>

					<!-- Tool result -->
					{#if $handler.toolError}
						<div
							style="margin-top: 12px; border: 1px solid #fecaca; background: #fef2f2; color: #ef4444; padding: 12px; border-radius: 8px; font-size: 0.85rem;"
						>
							<strong>Error:</strong>
							{$handler.toolError}
						</div>
					{/if}

					{#if $handler.toolResult}
						<div style="margin-top: 12px;" class="drawer-section">
							<div class="section-label" style="display:flex; justify-content:space-between; align-items:center;">
								<span>Response</span>
								<button
									class="btn btn-ghost btn-icon"
									on:click={() => handler.copyToClipboardWrapper($handler.toolResult || "")}
									title="Copy to clipboard"
									aria-label="Copy tool result to clipboard"
									style="width:24px; height:24px; padding:0; border:none; background:transparent;"
								>
									<Icon
										name={$handler.copied ? "check" : "copy"}
										size={14}
										strokeWidth={2}
										className={$handler.copied ? "text-success" : ""}
									/>
								</button>
							</div>
							<div class="md-card markdown-body" style="padding: 1px 16px;">
								<Markdown content={"```json\n" + $handler.toolResult + "\n```"} />
							</div>
						</div>
					{/if}
				</div>
			{/if}

			{#if $handler.item.type === "prompt" && $handler.item.data.arguments}
				<div class="drawer-section">
					<div class="section-label">Arguments</div>
					{#each $handler.item.data.arguments as arg (arg.name)}
						<div
							style="border: 1px solid var(--color-border); border-radius: 8px; padding: 12px; margin-bottom: 8px; background: rgba(0,0,0,0.02);"
						>
							<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 4px;">
								<strong style="color: var(--color-text); font-family: monospace;">{arg.name}</strong>
								{#if arg.required}
									<span style="font-size: 0.7rem; color: #ef4444; font-weight: bold;">REQUIRED</span>
								{/if}
							</div>
							{#if arg.description}
								<div style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 6px;">
									{arg.description}
								</div>
							{/if}
						</div>
					{/each}
					{#if $handler.item.data.arguments.length === 0}
						<div style="font-size: 0.85rem; color: var(--color-text-muted); font-style: italic;">No arguments.</div>
					{/if}
				</div>
			{/if}

			{#if $handler.item.type === "prompt" && $handler.item.data.messages && $handler.item.data.messages.length > 0}
				<div class="drawer-section">
					<div class="section-label">Template</div>
					{#each $handler.item.data.messages as msg, msgIndex (`${msg.role}-${msgIndex}`)}
						<div class="md-card" style="margin-bottom: 8px;">
							<div
								style="font-size: 0.7rem; font-weight: bold; text-transform: uppercase; color: var(--color-text-muted); margin-bottom: 8px;"
							>
								Role: {msg.role}
							</div>
							<div class="markdown-body">
								<Markdown content={typeof msg.content === "string" ? msg.content : msg.content.text} />
							</div>
						</div>
					{/each}
				</div>
			{/if}

			{#if $handler.item.type === "resource"}
				<div class="drawer-section">
					<div class="section-label">Details</div>
					{#if $handler.item?.data?.uri}
						<div style="font-size: 0.85rem; margin-bottom: 8px;">
							<span style="color: var(--color-text-muted);">URI:</span>
							<code
								style="font-size: 0.8rem; background: var(--color-bg); padding: 2px 4px; border-radius: 4px; border: 1px solid var(--color-border);"
								>{$handler.item.data.uri}</code
							>
						</div>
					{/if}
					{#if $handler.item.data.mimeType}
						<div style="font-size: 0.85rem;">
							<span style="color: var(--color-text-muted);">MIME Type:</span> <span>{$handler.item.data.mimeType}</span>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.drawer-header {
		padding: 20px;
		border-bottom: 1px solid var(--color-border);
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		flex-shrink: 0;
	}

	.drawer-title {
		font-size: 1rem;
		font-weight: 700;
		color: var(--color-text);
		line-height: 1.3;
		word-break: break-all;
	}

	.type-chip {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 3px 8px;
		border-radius: 20px;
		background: rgba(14, 165, 233, 0.1);
		color: #0ea5e9;
	}

	.drawer-body {
		padding: 20px 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		overflow-y: auto;
	}

	.drawer-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.md-card {
		background: rgba(248, 250, 252, 0.8);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 16px;
	}

	:global(.dark) .md-card {
		background: rgba(15, 23, 42, 0.8);
	}
</style>
