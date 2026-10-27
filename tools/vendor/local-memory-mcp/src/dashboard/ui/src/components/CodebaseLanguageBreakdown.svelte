<script lang="ts">
	import Icon from "../lib/Icon.svelte";

	interface LanguageEntry {
		name: string;
		count: number;
		percentage: number;
		color: string;
	}

	let { languageEntries = [] }: { languageEntries: LanguageEntry[] } = $props();

	const LANG_ICONS: Record<string, string> = {
		TypeScript: "file-text",
		JavaScript: "file-code",
		Svelte: "flame",
		JSON: "braces",
		Markdown: "book-open",
		CSS: "palette",
		HTML: "globe",
		YAML: "settings"
	};
</script>

{#if (languageEntries ?? []).length > 0}
	<div class="overview-section">
		<div class="overview-section-label">
			<Icon name="globe" size={12} strokeWidth={1.75} />
			Languages
		</div>
		<div class="lang-grid">
			{#each languageEntries ?? [] as lang (lang.name)}
				<div class="lang-badge" title="{lang.name}: {lang.count} files ({lang.percentage}%)">
					<span class="lang-icon" style="color:{lang.color}">
						<Icon name={LANG_ICONS[lang.name] || "file"} size={12} strokeWidth={1.75} />
					</span>
					<span class="lang-name">{lang.name}</span>
					<span class="lang-count">{lang.count}</span>
					<div class="lang-bar">
						<div class="lang-bar-fill" style="width:{lang.percentage}%;background:{lang.color}"></div>
					</div>
					<span class="lang-pct">{lang.percentage}%</span>
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.overview-section {
		margin-bottom: 0;
	}

	.overview-section-label {
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

	.lang-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.lang-badge {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border-radius: 8px;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.03);
		transition: background 0.12s ease;
		flex: 1 1 140px;
		min-width: 0;
		max-width: 100%;
		box-sizing: border-box;
	}

	.lang-badge:hover {
		background: rgba(255, 255, 255, 0.06);
	}

	.lang-icon {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	.lang-name {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex-shrink: 1;
	}

	.lang-count {
		font-size: 0.62rem;
		font-weight: 700;
		color: var(--color-text-muted);
		min-width: 16px;
		text-align: right;
		flex-shrink: 0;
	}

	.lang-bar {
		flex: 1 1 auto;
		height: 4px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.06);
		overflow: hidden;
		min-width: 20px;
		max-width: 80px;
		flex-shrink: 1;
	}

	.lang-bar-fill {
		height: 100%;
		border-radius: 999px;
		transition: width 0.4s ease;
		min-width: 2px;
	}

	.lang-pct {
		font-size: 0.58rem;
		font-weight: 600;
		color: var(--color-text-muted);
		min-width: 24px;
		text-align: right;
		flex-shrink: 0;
	}
</style>
