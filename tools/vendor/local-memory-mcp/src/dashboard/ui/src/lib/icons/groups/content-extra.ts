import type { IconElement } from "../iconTypes";

export const contentExtraIcons: Record<string, IconElement[]> = {
	tool: [
		{
			tag: "path",
			attrs: {
				d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
			}
		}
	],
	columns: [
		{
			tag: "rect",
			attrs: {
				width: "18",
				height: "18",
				x: "3",
				y: "3",
				rx: "2",
				ry: "2"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "12",
				x2: "12",
				y1: "3",
				y2: "21"
			}
		}
	],
	sparkle: [
		{
			tag: "path",
			attrs: {
				d: "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
			}
		}
	],
	settings: [
		{
			tag: "path",
			attrs: {
				d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
			}
		},
		{
			tag: "circle",
			attrs: {
				cx: "12",
				cy: "12",
				r: "3"
			}
		}
	],
	wifi: [
		{
			tag: "path",
			attrs: {
				d: "M5 12.55a11 11 0 0 1 14.08 0"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M1.42 9a16 16 0 0 1 21.16 0"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M8.53 16.11a6 6 0 0 1 6.95 0"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "12",
				x2: "12.01",
				y1: "20",
				y2: "20"
			}
		}
	],
	hash: [
		{
			tag: "line",
			attrs: {
				x1: "4",
				x2: "20",
				y1: "9",
				y2: "9"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "4",
				x2: "20",
				y1: "15",
				y2: "15"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "10",
				x2: "8",
				y1: "3",
				y2: "21"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "16",
				x2: "14",
				y1: "3",
				y2: "21"
			}
		}
	],
	inbox: [
		{
			tag: "polyline",
			attrs: {
				points: "22 12 16 12 14 15 10 15 8 12 2 12"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
			}
		}
	],
	archive: [
		{
			tag: "rect",
			attrs: {
				width: "20",
				height: "5",
				x: "2",
				y: "3",
				rx: "1"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M10 12h4"
			}
		}
	],
	"alert-circle": [
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
				x1: "12",
				x2: "12",
				y1: "8",
				y2: "12"
			}
		},
		{
			tag: "line",
			attrs: {
				x1: "12",
				x2: "12.01",
				y1: "16",
				y2: "16"
			}
		}
	],
	eye: [
		{
			tag: "path",
			attrs: {
				d: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"
			}
		},
		{
			tag: "circle",
			attrs: {
				cx: "12",
				cy: "12",
				r: "3"
			}
		}
	],
	gavel: [
		{
			tag: "path",
			attrs: {
				d: "m14 14-3.5 3.5a2.12 2.12 0 0 1-3 0l-.5-.5a2.12 2.12 0 0 1 0-3L10 10"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m11 11 4.5 4.5"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m16 16 2.5 2.5a1.5 1.5 0 0 1 0 2.12l-.88.88a1.5 1.5 0 0 1-2.12 0L13 19"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m3.5 6.5 6-6"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M6 3 4.5 4.5"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M9 6 7.5 7.5"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M12 9 10.5 10.5"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M16.5 13.5 15 15"
			}
		}
	],
	"message-circle": [
		{
			tag: "path",
			attrs: {
				d: "M21 12a9 9 0 0 1-9 9H3l2.1-4.2A9 9 0 1 1 21 12Z"
			}
		}
	],
	"upload-cloud": [
		{
			tag: "path",
			attrs: {
				d: "M4 14.9A7 7 0 1 1 15.7 8h.8a4.5 4.5 0 0 1 2.1 8.4"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M12 13v8"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m8 17 4-4 4 4"
			}
		}
	],
	"file-up": [
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
				d: "M12 12v6"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m15 15-3-3-3 3"
			}
		}
	],
	"file-type-2": [
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
				d: "M9 13v-1h6v1"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M12 12v6"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M11 18h2"
			}
		}
	],
	send: [
		{
			tag: "path",
			attrs: {
				d: "M22 2 11 13"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m22 2-7 20-4-9-9-4Z"
			}
		}
	],
	"clock-arrow-up": [
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
				d: "M12 6v6l3 2"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M16 19.5a6 6 0 0 1-8 0"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M16 2v4h4"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "m14 4 2-2 2 2"
			}
		}
	],
	users: [
		{
			tag: "path",
			attrs: {
				d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
			}
		},
		{
			tag: "circle",
			attrs: {
				cx: "9",
				cy: "7",
				r: "4"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M22 21v-2a4 4 0 0 0-3-3.87"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M16 3.13a4 4 0 0 1 0 7.75"
			}
		}
	],
	"share-2": [
		{
			tag: "circle",
			attrs: { cx: "18", cy: "5", r: "3" }
		},
		{
			tag: "circle",
			attrs: { cx: "6", cy: "12", r: "3" }
		},
		{
			tag: "circle",
			attrs: { cx: "18", cy: "19", r: "3" }
		},
		{
			tag: "line",
			attrs: { x1: "8.59", y1: "13.51", x2: "15.42", y2: "17.49" }
		},
		{
			tag: "line",
			attrs: { x1: "15.41", y1: "6.51", x2: "8.59", y2: "10.49" }
		}
	],
	folder: [
		{
			tag: "path",
			attrs: {
				d: "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"
			}
		}
	],
	lock: [
		{
			tag: "rect",
			attrs: {
				width: "18",
				height: "11",
				x: "3",
				y: "11",
				rx: "2",
				ry: "2"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M7 11V7a5 5 0 0 1 10 0v4"
			}
		}
	]
};
