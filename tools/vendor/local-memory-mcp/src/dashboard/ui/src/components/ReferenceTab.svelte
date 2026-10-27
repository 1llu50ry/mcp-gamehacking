<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { PageHeader } from "./ui";
	import type { Readable } from "svelte/store";
	import type { ReferenceItem } from "../lib/stores";
	import type { AppState } from "../lib/composables/useApp";

	import ReferenceCategorySidebar from "./ReferenceCategorySidebar.svelte";
	import ReferenceCard from "./ReferenceCard.svelte";
	import ReferenceEcosystem from "./ReferenceEcosystem.svelte";

	export let handler: {
		openReferenceDrawer: (type: "tool" | "prompt" | "resource", item: ReferenceItem["data"]) => void;
		setReferenceSearch: (search: string) => void;
		setReferenceFilter: (filter: AppState["referenceFilter"]) => void;
	};
	export let appState: Readable<AppState>;
	export let filteredTools: Readable<ReferenceItem[]>;
	export let filteredPrompts: Readable<ReferenceItem[]>;
	export let filteredResources: Readable<ReferenceItem[]>;

	function getCategories(state: AppState): Array<{
		id: AppState["referenceFilter"];
		icon: string;
		label: string;
		count: number;
	}> {
		return [
			{
				id: "all",
				icon: "layers",
				label: "All",
				count:
					(state.capabilities?.tools?.length || 0) +
					(state.capabilities?.prompts?.length || 0) +
					(state.capabilities?.resources?.length || 0) +
					ECOSYSTEM_ITEMS.length
			},
			{ id: "tools", icon: "tool", label: "Tools", count: state.capabilities?.tools?.length || 0 },
			{ id: "prompts", icon: "sparkle", label: "Prompts", count: state.capabilities?.prompts?.length || 0 },
			{ id: "resources", icon: "database", label: "Resources", count: state.capabilities?.resources?.length || 0 },
			{ id: "ecosystem", icon: "zap", label: "Ecosystem", count: ECOSYSTEM_ITEMS.length }
		];
	}

	$: state = $appState;
	$: tools = $filteredTools;
	$: prompts = $filteredPrompts;
	$: resources = $filteredResources;

	const ECOSYSTEM_ITEMS = [
		{
			name: "DocuBook",
			description: "AI-powered documentation generator that turns your codebase into beautiful, searchable docs.",
			url: "https://www.docubook.pro/",
			icon: "book-open"
		}
	];

	function handleCardKeydown(e: KeyboardEvent, type: "tool" | "prompt" | "resource", item: ReferenceItem["data"]) {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			handler.openReferenceDrawer(type, item);
		}
	}
</script>

<div class="animate-fade-in">
	<PageHeader description="Every tool, prompt, and resource this server exposes to agents." />

	<!-- The search row is a toolbar, not a header. It was previously wrapped in
	     a `glass card` alongside the page title, which framed the page heading
	     as if it were a widget. -->
	<div class="ref-toolbar">
		<div class="ref-header">
			<div class="flex items-center gap-2">
				{#if state.capabilities}
					<span class="ref-total-badge"
						>{(state.capabilities.tools?.length || 0) + (state.capabilities.prompts?.length || 0)} items</span
					>
				{/if}
			</div>
			<!-- Quick Search -->
			<div class="ref-search-wrap">
				<span class="ref-search-icon"><Icon name="search" size={12} strokeWidth={2} /></span>
				<input
					class="form-input ref-search-input"
					type="text"
					placeholder="Search tools & prompts…"
					aria-label="Search tools and prompts"
					bind:value={$appState.referenceSearch}
				/>
				{#if state.referenceSearch}
					<button class="ref-clear-btn" on:click={() => handler.setReferenceSearch("")} aria-label="Clear search">
						<Icon name="x" size={11} strokeWidth={2.5} />
					</button>
				{/if}
			</div>
		</div>
	</div>

	<!-- Body: sidebar + main -->
	<div class="ref-body">
		<!-- Category sidebar -->
		<ReferenceCategorySidebar
			categories={getCategories(state)}
			activeFilter={state.referenceFilter}
			onFilterChange={(filter: string) => handler.setReferenceFilter(filter as AppState["referenceFilter"])}
		/>

		<!-- Main content -->
		<div class="ref-main">
			{#if !state.capabilities}
				<div style="padding:40px;text-align:center;">
					<div class="skeleton" style="height:60px;border-radius:12px;margin-bottom:10px;"></div>
					<div class="skeleton" style="height:60px;border-radius:12px;margin-bottom:10px;"></div>
					<div class="skeleton" style="height:60px;border-radius:12px;"></div>
				</div>
			{:else}
				<!-- Tools section -->
				{#if tools.length > 0}
					<div class="ref-section-header">
						<Icon name="tool" size={13} strokeWidth={1.75} />
						<span>Tools</span>
						<span class="ref-section-count">{tools.length}</span>
					</div>
					<div class="ref-grid">
						{#each tools as tool (tool.data.name)}
							<ReferenceCard
								type="tool"
								name={tool?.data?.name || "Unknown Tool"}
								description={tool?.data?.description}
								params={tool?.data?.inputSchema?.properties
									? Object.keys(tool.data.inputSchema.properties).slice(0, 4)
									: undefined}
								moreCount={tool?.data?.inputSchema?.properties
									? Math.max(0, Object.keys(tool.data.inputSchema.properties).length - 4)
									: undefined}
								onClick={() => handler.openReferenceDrawer("tool", tool.data)}
								onKeydown={(e: KeyboardEvent) => handleCardKeydown(e, "tool", tool.data)}
							/>
						{/each}
					</div>
				{/if}

				<!-- Prompts section -->
				{#if prompts.length > 0}
					<div class="ref-section-header" style="margin-top:{tools.length > 0 ? '20px' : '0'}">
						<Icon name="sparkle" size={13} strokeWidth={1.75} />
						<span>Prompts</span>
						<span class="ref-section-count">{prompts.length}</span>
					</div>
					<div class="ref-grid">
						{#each prompts as prompt (prompt.data.name)}
							<ReferenceCard
								type="prompt"
								name={prompt?.data?.name || "Unknown Prompt"}
								description={prompt?.data?.description}
								onClick={() => handler.openReferenceDrawer("prompt", prompt.data)}
								onKeydown={(e: KeyboardEvent) => handleCardKeydown(e, "prompt", prompt.data)}
							/>
						{/each}
					</div>
				{/if}

				<!-- Resources section -->
				{#if resources.length > 0}
					<div class="ref-section-header" style="margin-top:{tools.length > 0 || prompts.length > 0 ? '20px' : '0'}">
						<Icon name="database" size={13} strokeWidth={1.75} />
						<span>Resources</span>
						<span class="ref-section-count">{resources.length}</span>
					</div>
					<div class="ref-grid">
						{#each resources as resource (resource.data.uri || resource.data.name)}
							<ReferenceCard
								type="resource"
								name={resource?.data?.name || "Unknown Resource"}
								description={resource?.data?.description}
								params={resource?.data?.uri ? [resource.data.uri] : undefined}
								onClick={() => handler.openReferenceDrawer("resource", resource.data)}
								onKeydown={(e: KeyboardEvent) => handleCardKeydown(e, "resource", resource.data)}
							/>
						{/each}
					</div>
				{/if}

				{#if tools.length === 0 && prompts.length === 0 && resources.length === 0 && state.referenceFilter !== "ecosystem"}
					<div style="text-align:center;padding:48px 16px;color:var(--color-text-muted);">
						<Icon name="search" size={28} strokeWidth={1.25} />
						<div style="font-size:0.82rem;margin-top:10px;">No results for "{state.referenceSearch}"</div>
					</div>
				{/if}

				<!-- Ecosystem -->
				{#if state.referenceFilter === "all" || state.referenceFilter === "ecosystem"}
					<ReferenceEcosystem items={ECOSYSTEM_ITEMS} />
				{/if}
			{/if}
		</div>
	</div>
</div>

<style>
	.ref-toolbar {
		margin-bottom: var(--space-4);
	}

	.ref-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.ref-total-badge {
		font-size: 0.72rem;
		font-weight: 700;
		background: rgba(14, 165, 233, 0.1);
		color: #01607f;
		padding: 2px 8px;
		border-radius: 9999px;
		border: 1px solid rgba(14, 165, 233, 0.2);
	}

	.ref-search-wrap {
		position: relative;
		flex: 1;
		max-width: 300px;
	}

	.ref-search-icon {
		position: absolute;
		left: 10px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-text-muted);
		display: flex;
		pointer-events: none;
	}

	.ref-search-input {
		padding-left: 32px;
		padding-right: 28px;
		font-size: 0.8rem;
		width: 100%;
	}

	.ref-clear-btn {
		position: absolute;
		right: 8px;
		top: 50%;
		transform: translateY(-50%);
		background: transparent;
		border: none;
		cursor: pointer;
		color: var(--color-text-muted);
		display: flex;
		padding: 2px;
		border-radius: 4px;
		transition: color 0.15s ease;
	}

	.ref-clear-btn:hover {
		color: var(--color-text);
	}

	.ref-body {
		display: grid;
		grid-template-columns: 160px 1fr;
		gap: 16px;
		align-items: start;
	}

	@media (max-width: 700px) {
		.ref-body {
			grid-template-columns: 1fr;
		}
	}

	.ref-main {
		display: flex;
		flex-direction: column;
	}

	.ref-section-header {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--color-text-muted);
		margin-bottom: 10px;
	}

	.ref-section-count {
		font-size: 0.6rem;
		background: rgba(100, 116, 139, 0.1);
		color: var(--color-text-muted);
		padding: 1px 6px;
		border-radius: 9999px;
		font-weight: 700;
	}

	.ref-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 10px;
	}
</style>
