import type { IconElement } from "./iconTypes";
import { navigationIcons } from "./groups/navigation";
import { actionsIcons } from "./groups/actions";
import { statusIcons } from "./groups/status";
import { contentIcons } from "./groups/content";
import { contentExtraIcons } from "./groups/content-extra";
import { loaderIcons } from "./groups/loader";

export type { IconElement } from "./iconTypes";

/**
 * Aggregated lucide-style icon library, keyed by icon name.
 *
 * Data lives in ./groups/* (per-icon-group modules) — this barrel merges them
 * in canonical order and keeps the historical `import { icons } from
 * "./icons/iconData"` contract intact (Icon.svelte). Groups are hand-maintained
 * (NOT generated); add new icons to the matching group file.
 */
export const icons: Record<string, IconElement[]> = {
	...navigationIcons,
	...actionsIcons,
	...statusIcons,
	...contentIcons,
	...contentExtraIcons,
	...loaderIcons
};
