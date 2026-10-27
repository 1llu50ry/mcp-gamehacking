import type { IconElement } from "../iconTypes";

export const navigationIcons: Record<string, IconElement[]> = {
	// Navigation
	brain: [
		{
			tag: "path",
			attrs: {
				d: "M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M17.599 6.5a3 3 0 0 0 .399-1.375"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M6.003 5.125A3 3 0 0 0 6.401 6.5"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M3.477 10.896a4 4 0 0 1 .585-.396"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M19.938 10.5a4 4 0 0 1 .585.396"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M6 18a4 4 0 0 1-1.967-.516"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M19.967 17.484A4 4 0 0 1 18 18"
			}
		}
	],
	"layout-dashboard": [
		{
			tag: "rect",
			attrs: {
				width: "7",
				height: "9",
				x: "3",
				y: "3",
				rx: "1"
			}
		},
		{
			tag: "rect",
			attrs: {
				width: "7",
				height: "5",
				x: "14",
				y: "3",
				rx: "1"
			}
		},
		{
			tag: "rect",
			attrs: {
				width: "7",
				height: "9",
				x: "14",
				y: "12",
				rx: "1"
			}
		},
		{
			tag: "rect",
			attrs: {
				width: "7",
				height: "5",
				x: "3",
				y: "16",
				rx: "1"
			}
		}
	],
	database: [
		{
			tag: "ellipse",
			attrs: {
				cx: "12",
				cy: "5",
				rx: "9",
				ry: "3"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M3 5V19A9 3 0 0 0 21 19V5"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M3 12A9 3 0 0 0 21 12"
			}
		}
	],
	"clipboard-list": [
		{
			tag: "rect",
			attrs: {
				width: "8",
				height: "4",
				x: "8",
				y: "2",
				rx: "1",
				ry: "1"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M12 11h4"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M12 16h4"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M8 11h.01"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M8 16h.01"
			}
		}
	],
	"book-open": [
		{
			tag: "path",
			attrs: {
				d: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"
			}
		},
		{
			tag: "path",
			attrs: {
				d: "M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"
			}
		}
	]
};
