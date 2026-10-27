/**
 * Design system primitives.
 *
 * Every view composes from these. The rule is simple: if you are about to write
 * a page header, a card, a status pill, an empty state, a loading placeholder or
 * a filter row from scratch, you are about to create the twelfth variant of a
 * thing that already exists — import it from here instead.
 *
 * New primitives belong here only when a pattern appears in three or more
 * places. A one-off stays local to its view.
 */
export { default as Badge } from "./Badge.svelte";
export { default as EmptyState } from "./EmptyState.svelte";
export { default as ErrorState } from "./ErrorState.svelte";
export { default as Metric } from "./Metric.svelte";
export { default as PageHeader } from "./PageHeader.svelte";
export { default as SectionHeading } from "./SectionHeading.svelte";
export { default as Skeleton } from "./Skeleton.svelte";
export { default as Surface } from "./Surface.svelte";
export { default as TablePagination } from "./TablePagination.svelte";
export { default as Toolbar } from "./Toolbar.svelte";
