import type { IconElement } from "../iconTypes";

export const actionsIcons: Record<string, IconElement[]> = {
	// Actions
	"refresh-cw": [
		{
			tag: "path",
			attrs: {
				d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M21 3v5h-5"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M8 16H3v5"
			}
		}
	],
	download: [
		{
			tag: "path",
			attrs: {
				d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
			}
		},
		{
			tag: "polyline",
			attrs: {
				points: "7 10 12 15 17 10"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "12",
				x2: "12",
				y1: "15",
				y2: "3"
			}
		}
	],
	upload: [
		{
			tag: "path",
			attrs: {
				d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
			}
		},
		{
			tag: "polyline",
			attrs: {
				points: "17 8 12 3 7 8"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "12",
				x2: "12",
				y1: "3",
				y2: "15"
			}
		}
	],
	sun: [
		{
			tag: "circle",
			attrs: {
				cx: "12",
				cy: "12",
				r: "4"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M12 2v2"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M12 20v2"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m4.93 4.93 1.41 1.41"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m17.66 17.66 1.41 1.41"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M2 12h2"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M20 12h2"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m6.34 17.66-1.41 1.41"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m19.07 4.93-1.41 1.41"
			}
		}
	],
	moon: [
		{
			tag: "path",
			attrs: {
				d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"
			}
		}
	],
	menu: [
		{
			tag: "line",
			attrs: {
				x1: "4",
				x2: "20",
				y1: "12",
				y2: "12"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "4",
				x2: "20",
				y1: "6",
				y2: "6"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "4",
				x2: "20",
				y1: "18",
				y2: "18"
			}
		}
	],
	"chevron-left": [
		{
			tag: "path",
			attrs: {
				d: "m15 18-6-6 6-6"
			}
		}
	],
	"chevron-right": [
		{
			tag: "path",
			attrs: {
				d: "m9 18 6-6-6-6"
			}
		}
	],
	"chevron-down": [
		{
			tag: "path",
			attrs: {
				d: "m6 9 6 6 6-6"
			}
		}
	],
	"chevron-up": [
		{
			tag: "path",
			attrs: {
				d: "m18 15-6-6-6 6"
			}
		}
	],
	link: [
		{
			tag: "path",
			attrs: {
				d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
			}
		}
	],
	x: [
		{
			tag: "path",
			attrs: {
				d: "M18 6 6 18"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m6 6 12 12"
			}
		}
	],
	plus: [
		{
			tag: "path",
			attrs: {
				d: "M5 12h14"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M12 5v14"
			}
		}
	],
	search: [
		{
			tag: "circle",
			attrs: {
				cx: "11",
				cy: "11",
				r: "8"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m21 21-4.3-4.3"
			}
		}
	],
	pin: [
		{
			tag: "path",
			attrs: {
				d: "M12.586 2.586a2 2 0 0 1 2.828 0l2 2a2 2 0 0 1 0 2.828l-1.793 1.793-.914 4.57a1 1 0 0 1-.271.51l-1.414 1.414a1 1 0 0 1-1.414 0l-2.122-2.121-4.172 4.171a1 1 0 1 1-1.414-1.414l4.171-4.172-2.12-2.12a1 1 0 0 1 0-1.415l1.413-1.414a1 1 0 0 1 .51-.27l4.57-.915 1.792-1.793Z"
			}
		}
	],
	star: [
		{
			tag: "polygon",
			attrs: {
				points: "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
			}
		}
	],
	edit: [
		{
			tag: "path",
			attrs: {
				d: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"
			}
		}
	],
	trash: [
		{
			tag: "path",
			attrs: {
				d: "M3 6h18"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"
			}
		}
	],
	copy: [
		{
			tag: "rect",
			attrs: {
				width: "14",
				height: "14",
				x: "8",
				y: "8",
				rx: "2",
				ry: "2"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"
			}
		}
	],
	"external-link": [
		{
			tag: "path",
			attrs: {
				d: "M15 3h6v6"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M10 14 21 3"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
			}
		}
	],
	filter: [
		{
			tag: "polygon",
			attrs: {
				points: "22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"
			}
		}
	],
	sliders: [
		{
			tag: "line",
			attrs: {
				x1: "4",
				x2: "4",
				y1: "21",
				y2: "14"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "4",
				x2: "4",
				y1: "6",
				y2: "3"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "12",
				x2: "12",
				y1: "21",
				y2: "12"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "12",
				x2: "12",
				y1: "6",
				y2: "3"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "20",
				x2: "20",
				y1: "21",
				y2: "16"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "20",
				x2: "20",
				y1: "10",
				y2: "3"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "1",
				x2: "7",
				y1: "14",
				y2: "14"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "9",
				x2: "15",
				y1: "12",
				y2: "12"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "17",
				x2: "23",
				y1: "16",
				y2: "16"
			}
		}
	]
};
