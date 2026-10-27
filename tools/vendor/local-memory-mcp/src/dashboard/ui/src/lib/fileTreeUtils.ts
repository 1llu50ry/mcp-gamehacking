// ─── File Tree Utility Functions ───────────────────────────────────────────────
// Extracted from CodebaseFileTree.svelte for reuse in sub-components

/** Count files and symbols in a directory node */
export function countChildren(node: Record<string, unknown>): { files: number; symbols: number } {
	const children = node.children as Record<string, unknown>[] | undefined;
	if (!children || !Array.isArray(children)) {
		return { files: 0, symbols: 0 };
	}
	let files = 0;
	let symbols = 0;
	for (const child of children) {
		const t = child.type as string | undefined;
		const childPath = (child.path as string) || "";
		const isDir =
			t === "directory" ||
			t === "dir" ||
			(!t && childPath.endsWith("/")) ||
			(!t && Array.isArray(child.children) && child.children.length > 0);
		if (isDir) {
			const sub = countChildren(child);
			files += sub.files;
			symbols += sub.symbols;
		} else {
			files += 1;
			if (child.symbolCounts && typeof child.symbolCounts === "object") {
				symbols += Object.values(child.symbolCounts as Record<string, number>).reduce(
					(a: number, b: number) => a + b,
					0
				);
			}
		}
	}
	return { files, symbols };
}

/** Get file extension for icon/label */
export function getExt(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export const KIND_SHORT: Record<string, string> = {
	function: "f",
	class: "c",
	interface: "i",
	type: "t",
	enum: "e",
	variable: "v"
};

export const KIND_ORDER = ["function", "class", "interface", "type", "enum", "variable"];

/** Format symbolCounts object into a compact badge string like "f12 c3 i5" */
export function formatKindCounts(counts: Record<string, number> | undefined): string {
	if (!counts || typeof counts !== "object") return "";
	const parts: string[] = [];
	for (const kind of KIND_ORDER) {
		const n = counts[kind];
		if (n && n > 0) {
			parts.push(`${KIND_SHORT[kind] || kind.charAt(0)}${n}`);
		}
	}
	return parts.join(" ");
}

/** Aggregate symbolCounts from a node and all its children */
export function aggregateSymbolCounts(node: Record<string, unknown>): Record<string, number> {
	const result: Record<string, number> = {};
	const direct = node.symbolCounts as Record<string, number> | undefined;
	if (direct && typeof direct === "object") {
		for (const [k, v] of Object.entries(direct)) {
			result[k] = (result[k] || 0) + (v as number);
		}
	}
	const children = node.children as Record<string, unknown>[] | undefined;
	if (children && Array.isArray(children)) {
		for (const child of children) {
			const sub = aggregateSymbolCounts(child);
			for (const [k, v] of Object.entries(sub)) {
				result[k] = (result[k] || 0) + v;
			}
		}
	}
	return result;
}

/** Get icon name for file type based on extension */
export function getFileIcon(name: string): string {
	const ext = getExt(name);
	switch (ext) {
		case "ts":
		case "tsx":
			return "file-text";
		case "js":
		case "jsx":
			return "file-code";
		case "json":
			return "braces";
		case "md":
			return "book-open";
		case "css":
		case "scss":
		case "tailwind":
			return "palette";
		case "svelte":
			return "flame";
		case "html":
			return "globe";
		case "yaml":
		case "yml":
			return "settings";
		default:
			return "file";
	}
}

/** Map extension to label for suffix badge */
export function extLabel(name: string): string {
	const ext = getExt(name);
	if (ext) return `.${ext}`;
	return "";
}

/** Color for extension badge */
export function extColor(name: string): string {
	const ext = getExt(name);
	switch (ext) {
		case "ts":
		case "tsx":
			return "#3178c6";
		case "js":
		case "jsx":
			return "#f7df1e";
		case "svelte":
			return "#ff3e00";
		case "css":
		case "scss":
			return "#cc6699";
		case "json":
			return "#a8b1c4";
		case "md":
			return "#755838";
		default:
			return "var(--color-text-muted)";
	}
}

/** Check if node is a directory */
export function isDir(node: Record<string, unknown>): boolean {
	const t = node.type as string | undefined;
	const p = (node.path as string) || "";
	if (t === "directory" || t === "dir") return true;
	if (Array.isArray(node.children) && node.children.length > 0) return true;
	if (!t && p.endsWith("/")) return true;
	return false;
}
