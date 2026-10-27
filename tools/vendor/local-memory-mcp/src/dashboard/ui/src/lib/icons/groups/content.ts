import type { IconElement } from "../iconTypes";

export const contentIcons: Record<string, IconElement[]> = {
	// Content
	memory: [
		{
			tag: "rect",
			attrs: {
				x: "4",
				y: "4",
				width: "16",
				height: "16",
				rx: "3"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M9 12h6"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M9 8h4"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M9 16h2"
			}
		}
	],
	"git-branch": [
		{
			tag: "line",
			attrs: {
				x1: "6",
				x2: "6",
				y1: "3",
				y2: "15"
			}
		},
		{
			tag: "circle",
			attrs: {
				cx: "18",
				cy: "6",
				r: "3"
			}
		},
		{
			tag: "circle",
			attrs: {
				cx: "6",
				cy: "18",
				r: "3"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M18 9a9 9 0 0 1-9 9"
			}
		}
	],
	tag: [
		{
			tag: "path",
			attrs: {
				d: "M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"
			}
		},
		{
			tag: "circle",
			attrs: {
				cx: "7.5",
				cy: "7.5",
				r: ".5",
				fill: "currentColor"
			}
		}
	],
	user: [
		{
			tag: "path",
			attrs: {
				d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"
			}
		},
		{
			tag: "circle",
			attrs: {
				cx: "12",
				cy: "7",
				r: "4"
			}
		}
	],
	bot: [
		{
			tag: "path",
			attrs: {
				d: "M12 8V4H8"
			}
		},
		{
			tag: "rect",
			attrs: {
				width: "16",
				height: "12",
				x: "4",
				y: "8",
				rx: "2"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M2 14h2"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M20 14h2"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M15 13v2"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M9 13v2"
			}
		}
	],
	code: [
		{
			tag: "polyline",
			attrs: {
				points: "16 18 22 12 16 6"
			}
		},
		{
			tag: "polyline",
			attrs: {
				points: "8 6 2 12 8 18"
			}
		}
	],
	terminal: [
		{
			tag: "polyline",
			attrs: {
				points: "4 17 10 11 4 5"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "12",
				x2: "20",
				y1: "19",
				y2: "19"
			}
		}
	],
	"file-text": [
		{
			tag: "path",
			attrs: {
				d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M14 2v4a2 2 0 0 0 2 2h4"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M10 9H8"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M16 13H8"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M16 17H8"
			}
		}
	],
	layers: [
		{
			tag: "path",
			attrs: {
				d: "m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"
			}
		}
	],
	cpu: [
		{
			tag: "rect",
			attrs: {
				x: "4",
				y: "4",
				width: "16",
				height: "16",
				rx: "2"
			}
		},
		{
			tag: "rect",
			attrs: {
				x: "9",
				y: "9",
				width: "6",
				height: "6"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M15 2v2"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M15 20v2"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M2 15h2"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M2 9h2"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M20 15h2"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M20 9h2"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M9 2v2"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M9 20v2"
			}
		}
	],
	clock: [
		{
			tag: "circle",
			attrs: {
				cx: "12",
				cy: "12",
				r: "10"
			}
		},
		{
			tag: "polyline",
			attrs: {
				points: "12 6 12 12 16 14"
			}
		}
	],
	calendar: [
		{
			tag: "rect",
			attrs: {
				width: "18",
				height: "18",
				x: "3",
				y: "4",
				rx: "2",
				ry: "2"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "16",
				x2: "16",
				y1: "2",
				y2: "6"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "8",
				x2: "8",
				y1: "2",
				y2: "6"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "3",
				x2: "21",
				y1: "10",
				y2: "10"
			}
		}
	],
	"arrow-up": [
		{
			tag: "path",
			attrs: {
				d: "m5 12 7-7 7 7"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M12 19V5"
			}
		}
	],
	"arrow-down": [
		{
			tag: "path",
			attrs: {
				d: "M12 5v14"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m19 12-7 7-7-7"
			}
		}
	],
	"arrow-right": [
		{
			tag: "path",
			attrs: {
				d: "M5 12h14"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m12 5 7 7-7 7"
			}
		}
	],
	"trending-up": [
		{
			tag: "polyline",
			attrs: {
				points: "22 7 13.5 15.5 8.5 10.5 2 17"
			}
		},
		{
			tag: "polyline",
			attrs: {
				points: "16 7 22 7 22 13"
			}
		}
	],
	"bar-chart": [
		{
			tag: "line",
			attrs: {
				x1: "12",
				x2: "12",
				y1: "20",
				y2: "10"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "18",
				x2: "18",
				y1: "20",
				y2: "4"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "6",
				x2: "6",
				y1: "20",
				y2: "16"
			}
		}
	],
	list: [
		{
			tag: "line",
			attrs: {
				x1: "8",
				x2: "21",
				y1: "6",
				y2: "6"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "8",
				x2: "21",
				y1: "12",
				y2: "12"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "8",
				x2: "21",
				y1: "18",
				y2: "18"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "3",
				x2: "3.01",
				y1: "6",
				y2: "6"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "3",
				x2: "3.01",
				y1: "12",
				y2: "12"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "3",
				x2: "3.01",
				y1: "18",
				y2: "18"
			}
		}
	]
};
