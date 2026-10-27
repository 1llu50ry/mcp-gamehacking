import type { IconElement } from "../iconTypes";

export const statusIcons: Record<string, IconElement[]> = {
	// Status / Indicators
	"circle-dot": [
		{
			tag: "circle",
			attrs: {
				cx: "12",
				cy: "12",
				r: "10"
			}
		},
		{
			tag: "circle",
			attrs: {
				cx: "12",
				cy: "12",
				r: "1"
			}
		}
	],
	"circle-check": [
		{
			tag: "circle",
			attrs: {
				cx: "12",
				cy: "12",
				r: "10"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m9 12 2 2 4-4"
			}
		}
	],
	"circle-x": [
		{
			tag: "circle",
			attrs: {
				cx: "12",
				cy: "12",
				r: "10"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m15 9-6 6"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m9 9 6 6"
			}
		}
	],
	"circle-pause": [
		{
			tag: "circle",
			attrs: {
				cx: "12",
				cy: "12",
				r: "10"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "10",
				x2: "10",
				y1: "15",
				y2: "9"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "14",
				x2: "14",
				y1: "15",
				y2: "9"
			}
		}
	],
	"circle-pause-alt": [
		{
			tag: "circle",
			attrs: {
				cx: "12",
				cy: "12",
				r: "10"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M10 9v6"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M14 9v6"
			}
		}
	],
	"triangle-alert": [
		{
			tag: "path",
			attrs: {
				d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M12 9v4"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M12 17h.01"
			}
		}
	],
	check: [
		{
			tag: "path",
			attrs: {
				d: "M20 6 9 17l-5-5"
			}
		}
	],
	info: [
		{
			tag: "circle",
			attrs: {
				cx: "12",
				cy: "12",
				r: "10"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M12 16v-4"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M12 8h.01"
			}
		}
	],
	zap: [
		{
			tag: "path",
			attrs: {
				d: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"
			}
		}
	],
	activity: [
		{
			tag: "path",
			attrs: {
				d: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"
			}
		}
	]
};
