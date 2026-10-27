import type { IconElement } from "../iconTypes";

export const loaderIcons: Record<string, IconElement[]> = {
	// Lucide "loader" (spinner) — rendered with a rotation animation by the
	// consuming component (.detail-ref-loading :global(svg) spin keyframe).
	loader: [
		{
			tag: "path",
			attrs: {
				d: "M12 2v4"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m16.2 7.8 2.9 2.9"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M18 12h4"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m16.2 16.2 2.9 2.9"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M12 18v4"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m4.9 19.1 2.9-2.9"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M2 12h4"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m4.9 4.9 2.9 2.9"
			}
		}
	]
};
