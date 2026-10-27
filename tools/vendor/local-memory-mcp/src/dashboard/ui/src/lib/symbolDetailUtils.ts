export const KIND_ICONS: Record<string, string> = {
	function: "zap",
	class: "layers",
	interface: "terminal",
	type: "hash",
	enum: "list",
	variable: "database",
	// Reference edge kinds (Phase 1.1 / TASK-299-301): the same map resolves a
	// stable icon for symbol kinds AND reference kinds (call/instantiation/
	// import/extends/implements), so renderers can use getKindIcon uniformly.
	call: "zap",
	instantiation: "plus",
	import: "download",
	extends: "arrow-right",
	implements: "check"
};

export const KIND_LABELS: Record<string, string> = {
	function: "Function",
	class: "Class",
	interface: "Interface",
	type: "Type",
	enum: "Enum",
	variable: "Variable",
	call: "Call",
	instantiation: "Instantiation",
	import: "Import",
	extends: "Extends",
	implements: "Implements"
};

/**
 * Canonical display order for reference edge groups. Any kind not listed here
 * (or absent entirely) collapses into the "other" bucket and renders
 * gracefully with its raw kind value.
 */
export const REFERENCE_KIND_ORDER: string[] = ["call", "instantiation", "import", "extends", "implements"];

/** True when the raw kind is one of the known reference edge kinds. */
export function isKnownRefKind(kind: string | undefined | null): kind is string {
	return !!kind && REFERENCE_KIND_ORDER.includes(kind);
}

/**
 * Grouping key for a reference: its kind when known, otherwise "other".
 * Unknown kinds all land in the same fallback bucket.
 */
export function refKindKey(kind: string | undefined | null): string {
	return isKnownRefKind(kind) ? kind : "other";
}

/**
 * Display label for a reference kind. Known kinds get a capitalized label;
 * unknown kinds render gracefully as `Other · <raw kind>` (requirement: never
 * show a raw kind value without context); kind-less (legacy in-memory)
 * references collapse into "Other". The synthetic "other" bucket key
 * (refKindKey) is special-cased to render plain "Other" — it is a bucket, not
 * a raw kind, so it must never leak as `Other · other` (F2).
 */
export function refKindLabel(kind: string | undefined | null): string {
	if (!kind || kind === "other") return "Other";
	return KIND_LABELS[kind] ?? `Other · ${kind}`;
}

/**
 * Distinct raw kinds inside the "other" bucket, in first-seen order — lets the
 * fallback group surface exactly which unrecognized kinds were encountered.
 */
export function otherRefKindLabels<T extends { kind?: string | null }>(refs: T[]): string[] {
	const seen: string[] = [];
	for (const ref of refs) {
		const kind = ref.kind;
		if (kind && !isKnownRefKind(kind) && !seen.includes(kind)) seen.push(kind);
	}
	return seen;
}

/** Group references by kind group (REFERENCE_KIND_ORDER first, then "other"). */
export function groupRefsByKind<T extends { kind?: string | null }>(refs: T[]): Map<string, T[]> {
	const map = new Map<string, T[]>();
	for (const key of [...REFERENCE_KIND_ORDER, "other"]) {
		map.set(key, []);
	}
	for (const ref of refs) {
		map.get(refKindKey(ref.kind))!.push(ref);
	}
	for (const key of [...REFERENCE_KIND_ORDER, "other"]) {
		if (map.get(key)!.length === 0) map.delete(key);
	}
	return map;
}

/** Get the icon name for a symbol kind */
export function getKindIcon(kind: string): string {
	return KIND_ICONS[kind] || "code";
}

/** Get the display label for a symbol kind */
export function getKindLabel(kind: string): string {
	return KIND_LABELS[kind] || "Symbol";
}

/** Build a location text string from filePath, line, and column */
export function buildLocationText(filePath?: string, line?: number, column?: number): string | null {
	if (!filePath) return null;
	let loc = filePath;
	if (line != null) {
		loc += `:${line}`;
		if (column != null) {
			loc += `:${column}`;
		}
	}
	return loc;
}

/** Group TraceReference[] by filePath */
export function groupRefsByFile<T extends { filePath: string }>(refs: T[]): Map<string, T[]> {
	const map = new Map<string, T[]>();
	for (const ref of refs) {
		const existing = map.get(ref.filePath);
		if (existing) {
			existing.push(ref);
		} else {
			map.set(ref.filePath, [ref]);
		}
	}
	return map;
}
