<script lang="ts">
	interface CodePreviewData {
		signature?: string;
	}

	let {
		symbol = null
	}: {
		symbol: CodePreviewData | null;
	} = $props();
</script>

{#if symbol?.signature}
	<div class="detail-section">
		<div class="detail-section-label">Signature</div>
		<pre class="detail-signature"><code>{symbol.signature}</code></pre>
	</div>
{/if}

<style>
	.detail-section {
		margin-bottom: 16px;
	}

	.detail-section-label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.66rem;
		font-weight: 700;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-bottom: 6px;
	}

	.detail-signature {
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
		font-size: 0.72rem;
		line-height: 1.6;
		color: var(--color-text);
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 10px 12px;
		overflow-x: auto;
		white-space: pre;
		margin: 0;
	}

	.detail-signature code {
		font-family: inherit;
		font-size: inherit;
	}
</style>
