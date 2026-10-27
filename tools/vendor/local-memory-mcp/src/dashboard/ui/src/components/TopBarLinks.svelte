<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { GITHUB_URL, NPM_URL, DONATION_URL } from "../lib/composables/useTopBar";

	export let countdownSeconds: number = 30;
	export let countdownPct: number = 100;
	export let countdownColor: string = "#0ea5e9";
	export let npmDownloads: number | null = null;
	export let npmLoading: boolean = true;
	export let formatDownloads: (n: number) => string = (n) => String(n);
	export let refreshing: boolean = false;

	export let onManualRefresh: () => void = () => {};
	export let onEcosystem: () => void = () => {};

	$: refreshIconClass = refreshing ? "animate-spin" : "";
	$: countdownTextColor = countdownSeconds <= 5 ? "#ef4444" : "var(--color-text-muted)";
</script>

<!-- Project links are secondary context, not primary product actions. -->
<details class="project-menu">
	<summary class="btn btn-ghost btn-sm">
		<Icon name="more-horizontal" size={16} strokeWidth={2} />
		<span>Project</span>
	</summary>
	<div class="ext-links-group" role="menu">
		<!-- GitHub link -->
		<a
			href={GITHUB_URL}
			target="_blank"
			rel="noopener noreferrer"
			class="ext-link-btn"
			title="View on GitHub"
			aria-label="GitHub repository"
			id="githubLink"
		>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path
					d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
				/>
			</svg>
			<span class="ext-link-label">GitHub</span>
		</a>

		<div class="ext-link-divider"></div>

		<!-- Star button -->
		<a
			href="{GITHUB_URL}/stargazers"
			target="_blank"
			rel="noopener noreferrer"
			class="ext-link-btn ext-link-star"
			title="Star on GitHub"
			aria-label="Star on GitHub"
			id="githubStarBtn"
		>
			<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
			</svg>
			<span class="ext-link-label">Star</span>
		</a>

		<div class="ext-link-divider"></div>

		<!-- npm link + downloads -->
		<a
			href={NPM_URL}
			target="_blank"
			rel="noopener noreferrer"
			class="ext-link-btn ext-link-npm"
			title="View on npm"
			aria-label={npmDownloads !== null ? `npm package: ${formatDownloads(npmDownloads)}/mo` : "npm package"}
			id="npmLink"
		>
			<svg width="18" height="11" viewBox="0 0 18 7" fill="currentColor" aria-hidden="true">
				<path d="M0 0h18v6H9V7H5V6H0V0zm1 5h2V1h1v4h1V1h1v5h4V1h1v4h1V1h1v4h1V1h2v5H1V5z" />
			</svg>
			{#if npmLoading}
				<span class="ext-link-label npm-dl-skeleton"></span>
			{:else if npmDownloads !== null}
				<span class="ext-link-label npm-dl-badge">
					<svg
						width="10"
						height="10"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
					</svg>
					{formatDownloads(npmDownloads)}/mo
				</span>
			{:else}
				<span class="ext-link-label">npm</span>
			{/if}
		</a>

		<div class="ext-link-divider"></div>

		<!-- Donate -->
		<a
			href={DONATION_URL}
			target="_blank"
			rel="noopener noreferrer"
			class="ext-link-btn ext-link-donate"
			title="Support this project"
			aria-label="Donate"
			id="donateLink"
		>
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M17 12a5 5 0 01-5 5m-5-5a5 5 0 015-5" />
				<path d="M12 7v10" />
			</svg>
			<span class="ext-link-label">Donate</span>
		</a>

		<div class="ext-link-divider"></div>

		<!-- Ecosystem -->
		<button
			class="ext-link-btn ext-link-eco"
			on:click={onEcosystem}
			title="View ecosystem tools"
			aria-label="Ecosystem"
			id="ecoLink"
		>
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
			</svg>
			<span class="ext-link-label">Ecosystem</span>
		</button>
	</div>
</details>

<!-- Countdown + Refresh -->
<div class="refresh-group">
	<div class="countdown-bar">
		<div class="countdown-track">
			<div class="countdown-fill" style="width:{countdownPct}%;background:{countdownColor};"></div>
		</div>
		<span class="countdown-label" style="color:{countdownTextColor};">{countdownSeconds}s</span>
	</div>
	<button
		class="btn btn-ghost btn-icon btn-sm"
		class:refreshing
		on:click={onManualRefresh}
		title="Refresh now"
		aria-label="Refresh"
	>
		<span class={refreshIconClass}>
			<Icon name="refresh-cw" size={14} strokeWidth={2.5} />
		</span>
	</button>
</div>

<style>
	.project-menu {
		position: relative;
	}

	.project-menu summary {
		list-style: none;
		cursor: pointer;
	}

	.project-menu summary::-webkit-details-marker {
		display: none;
	}

	.ext-links-group {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		display: grid;
		min-width: 190px;
		padding: 8px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--glass-shadow-elevated);
		z-index: 80;
		overflow: hidden;
	}

	:global(html.dark) .ext-links-group {
		background: var(--color-surface);
		border-color: rgba(148, 163, 184, 0.12);
	}

	.ext-link-btn {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 40px;
		padding: 8px 10px;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-decoration: none;
		transition:
			background 0.15s ease,
			color 0.15s ease;
		white-space: nowrap;
		line-height: 1;
	}

	.ext-link-btn:hover {
		background: rgba(14, 165, 233, 0.08);
		color: var(--color-text);
	}

	:global(html.dark) .ext-link-btn:hover {
		background: rgba(14, 165, 233, 0.12);
	}

	.ext-link-star:hover {
		background: rgba(234, 179, 8, 0.1) !important;
		color: #ca8a04 !important;
	}

	:global(html.dark) .ext-link-star:hover {
		background: rgba(234, 179, 8, 0.12) !important;
		color: #fbbf24 !important;
	}

	.ext-link-npm:hover {
		background: rgba(203, 36, 49, 0.08) !important;
		color: #cb2431 !important;
	}

	:global(html.dark) .ext-link-npm:hover {
		background: rgba(203, 36, 49, 0.12) !important;
		color: #f87171 !important;
	}

	.ext-link-donate:hover {
		background: rgba(249, 115, 22, 0.1) !important;
		color: #ea580c !important;
	}

	:global(html.dark) .ext-link-donate:hover {
		background: rgba(249, 115, 22, 0.15) !important;
		color: #fb923c !important;
	}

	.ext-link-eco:hover {
		background: rgba(14, 165, 233, 0.1) !important;
		color: #0284c7 !important;
	}

	:global(html.dark) .ext-link-eco:hover {
		background: rgba(56, 189, 248, 0.15) !important;
		color: #7dd3fc !important;
	}

	.ext-link-divider {
		display: none;
	}

	.ext-link-label {
		font-size: 0.7rem;
	}

	.ext-links-group :global(.ext-link-label) {
		color: var(--color-text-muted);
	}

	.npm-dl-badge {
		display: flex;
		align-items: center;
		gap: 3px;
		color: inherit;
	}

	.npm-dl-skeleton {
		display: inline-block;
		width: 36px;
		height: 10px;
		border-radius: 4px;
		background: rgba(148, 163, 184, 0.18);
		animation: skeleton-pulse 1.4s ease-in-out infinite;
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

	.refresh-group {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.countdown-bar {
		display: flex;
		align-items: center;
		gap: 6px;
		background: rgba(241, 245, 249, 0.75);
		padding: 5px 10px;
		border-radius: 10px;
		border: 1px solid var(--color-border);
		backdrop-filter: blur(8px);
	}

	:global(html.dark) .countdown-bar {
		background: rgba(15, 23, 42, 0.75);
		border-color: rgba(148, 163, 184, 0.12);
	}

	.countdown-track {
		width: 52px;
		height: 3px;
		background: rgba(148, 163, 184, 0.18);
		border-radius: 9999px;
		overflow: hidden;
	}

	.countdown-fill {
		height: 100%;
		border-radius: 9999px;
		transition:
			width 1s linear,
			background 0.3s;
	}

	.countdown-label {
		font-size: 0.7rem;
		font-weight: 600;
		width: 26px;
		transition: color 0.3s;
	}

	.btn.refreshing {
		color: var(--color-primary);
	}

	@media (max-width: 640px) {
		.project-menu summary span {
			display: none;
		}
	}

	@media (max-width: 760px) {
		.countdown-bar {
			padding: 5px 8px;
		}
		.countdown-track {
			width: 32px;
		}
	}

	@media (max-width: 420px) {
		.countdown-label {
			display: none;
		}
	}

	/* TASK-275 / audit F12: at ≤400px the countdown strip pushes the TopBar
	   actions (refresh, theme) off-screen at 320px. It's informational — the
	   refresh button remains reachable. All actions stay visible ≤320px. */
	@media (max-width: 400px) {
		.countdown-bar {
			display: none;
		}
	}
</style>
