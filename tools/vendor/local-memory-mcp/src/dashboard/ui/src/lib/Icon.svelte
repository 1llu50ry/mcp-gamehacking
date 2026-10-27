<script lang="ts">
	import { icons } from "./icons/iconData";
	// Lucide-style icon component — inline SVG, zero runtime overhead
	export let name: string;
	export let size: number = 16;
	export let strokeWidth: number = 1.75;
	export let className: string = "";
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	class={className}
	aria-hidden="true"
>
	{#if icons[name]}
		{#each icons[name] as element, elementIndex (`${element.tag}-${elementIndex}`)}
			<svelte:element this={element.tag} {...element.attrs} />
		{/each}
	{:else}
		<!-- fallback: question mark circle -->
		<circle cx="12" cy="12" r="10" />
		<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
		<path d="M12 17h.01" />
	{/if}
</svg>
