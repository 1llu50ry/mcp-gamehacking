<script lang="ts">
	import Icon from "../lib/Icon.svelte";

	export let onExport: (format: "json" | "csv") => void = () => {};
	export let onImport: () => void = () => {};
</script>

<div class="flex gap-1">
	<button class="btn btn-ghost btn-sm" on:click={() => onExport("json")} title="Export JSON">
		<Icon name="download" size={12} />
		JSON
	</button>
	<button class="btn btn-ghost btn-sm" on:click={() => onExport("csv")} title="Export CSV">
		<Icon name="download" size={12} />
		CSV
	</button>
	<div style="width:1px;height:20px;background:var(--color-border);margin:auto 4px;"></div>
	<button class="btn btn-ghost btn-sm" on:click={onImport} title="Bulk Import">
		<Icon name="upload" size={13} strokeWidth={2} />
		Import
	</button>
</div>
