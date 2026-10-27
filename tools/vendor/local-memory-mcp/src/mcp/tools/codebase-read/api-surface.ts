/**
 * Compact public API surface view for TRACE (issue #86 / TASK-012).
 *
 * Given a container symbol (class / interface / module / namespace / enum /
 * type) and its indexed member hierarchy, render a deterministic, bounded
 * contract: method/property/function signatures WITHOUT bodies, private and
 * protected members excluded when accessibility metadata is recoverable from
 * the stored signature, and inherited public members folded in from the
 * container's `extends` / `implements` heritage edges.
 *
 * Every exposed member preserves its source location (file + line) so the
 * surface stays navigable; the same data is returned in the TRACE JSON
 * envelope under `apiSurface`.
 *
 * Accessibility is detected from the stored `signature` (the visitor preserves
 * `private readonly`, `protected`, … modifiers — see `ts-signature.ts`). There
 * is no dedicated column for it, so when the signature is absent or carries no
 * modifier the member is treated as public (fail-open, never drops a real API).
 * TS private fields (`#field`) and the `private` / `protected` keywords are
 * excluded; `public` is stripped from the rendered signature for a clean
 * contract line.
 *
 * Bounds: a hard member cap (`MAX_API_MEMBERS`) plus a bounded inheritance
 * traversal depth (`MAX_API_INHERITANCE_DEPTH`) guard against pathological
 * wide type surfaces; overflow sets `truncated`. Output order is the stable
 * source order (start line ascending), so two traces of the same index are
 * byte-identical.
 */

import type { CodebaseSymbol, CodebaseReference } from "../../types";

/** Hard cap on exposed members — keeps the surface bounded + deterministic. */
export const MAX_API_MEMBERS = 80;

/** Bounded depth for folding in inherited public members via heritage edges. */
export const MAX_API_INHERITANCE_DEPTH = 4;

/** Symbol kinds whose members form a block-style API surface (`{ ... }`). */
const CONTAINER_KINDS = new Set(["class", "interface", "module", "namespace", "enum", "type", "struct", "trait"]);

/** One exposed member of the API surface (navigable metadata preserved). */
export interface ApiMember {
	/** Member name. */
	name: string;
	/** Symbol kind (method / property / function / …). */
	kind: string;
	/** Compact signature WITHOUT body, accessibility keyword stripped. */
	signature: string;
	/** Source file of the member. */
	file: string;
	/** 1-based start line of the member (null when unknown). */
	line: number | null;
	/** True when the member comes from a base class via extends/implements. */
	inherited: boolean;
}

/** Compact public API surface for a traced container symbol. */
export interface ApiSurface {
	/** Container symbol name. */
	name: string;
	/** Container kind. */
	kind: string;
	/** Opening declaration line, e.g. `class OrderService {`. */
	signature: string;
	/** Source file of the container. */
	file: string;
	/** 1-based start line of the container. */
	line: number | null;
	/** Whether members are wrapped in a `{ ... }` block. */
	container: boolean;
	/** Exposed members (bounded + deterministic order). */
	members: ApiMember[];
	/** True when the member cap was hit (surface is truncated). */
	truncated: boolean;
}

/** Collapse whitespace/newlines to a single trimmed line. */
function toSingleLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/**
 * Whether a stored signature denotes a private or protected member.
 *
 * Detects the `private` / `protected` accessibility keywords (word-bounded so
 * `privateKey` / `protectedField` names are NOT mistaken for modifiers) and the
 * TS `#privateField` shorthand. Returns false when no signature is available —
 * a member with no recoverable accessibility is treated as public.
 */
export function isPrivateOrProtected(signature: string | null): boolean {
	if (!signature) return false;
	const s = signature.trim();
	if (/^#\w/.test(s)) return true;
	return /^(private|protected)\b/i.test(s);
}

/** Strip the leading accessibility keyword (`public`/`private`/`protected`). */
function stripAccessibility(signature: string): string {
	return signature.replace(/^(public|private|protected)\s+/i, "");
}

/**
 * Render a compact signature for a member, falling back to kind-based guess.
 * A trailing `;` is appended when absent so every rendered member line is a
 * complete contract statement (`mN(x: number): void;`) — both in the JSON
 * envelope and the block output.
 */
function compactSignature(sym: CodebaseSymbol): string {
	const raw = (sym.signature ?? "").trim();
	const base = raw ? stripAccessibility(toSingleLine(raw)) : fallbackSignature(sym);
	return base.endsWith(";") ? base : `${base};`;
}

/** Kind-based signature fallback when no stored signature exists. */
function fallbackSignature(sym: CodebaseSymbol): string {
	switch (sym.kind) {
		case "method":
		case "constructor":
			return `${sym.name}()`;
		case "property":
		case "field":
		case "get":
		case "set":
			return sym.name;
		default:
			return sym.name;
	}
}

/** Opening declaration line for the container (adds `{` for block kinds). */
function containerHeader(symbol: CodebaseSymbol): { signature: string; container: boolean } {
	const isContainer = CONTAINER_KINDS.has(symbol.kind);
	const raw = (symbol.signature ?? "").trim();
	const base = raw
		? toSingleLine(raw)
				.replace(/\{\s*$/, "")
				.trim()
		: `${symbol.kind} ${symbol.name}`;
	return { signature: isContainer ? `${base} {` : base, container: isContainer };
}

/** Map a symbol to an exposed API member. */
function toMember(sym: CodebaseSymbol, inherited: boolean): ApiMember {
	return {
		name: sym.name,
		kind: sym.kind,
		signature: compactSignature(sym),
		file: sym.file_path,
		line: sym.start_line ?? null,
		inherited
	};
}

/**
 * Recursively collect public members of a base class via `extends` /
 * `implements` heritage edges (issue #86). Bounded by `depth` and a visited set
 * so cycles / diamond hierarchies never loop; private/protected members are
 * dropped. Inherited members are marked `inherited: true`.
 */
function collectInheritedMembers(
	container: CodebaseSymbol,
	symbols: CodebaseSymbol[],
	heritageRefs: CodebaseReference[],
	depth: number,
	visited: Set<string>
): ApiMember[] {
	if (depth <= 0) return [];
	const baseRefs = heritageRefs.filter(
		(r) =>
			(r.kind === "extends" || r.kind === "implements") &&
			r.caller_name === container.name &&
			r.caller_file === container.file_path
	);
	const members: ApiMember[] = [];
	const symbolsById = new Map<string, CodebaseSymbol>();
	for (const s of symbols) symbolsById.set(s.id, s);

	for (const ref of baseRefs) {
		const base = ref.target_symbol_id
			? symbolsById.get(ref.target_symbol_id)
			: symbols.find((s) => s.name === ref.symbol_name && s.file_path === ref.target_file);
		if (!base || visited.has(base.id)) continue;
		visited.add(base.id);

		const baseChildren = symbols.filter((s) => s.parent_symbol_id === base.id);
		for (const c of baseChildren) {
			if (isPrivateOrProtected(c.signature)) continue;
			members.push(toMember(c, true));
		}
		members.push(...collectInheritedMembers(base, symbols, heritageRefs, depth - 1, visited));
	}
	return members;
}

/**
 * Build the compact public API surface for a traced container symbol.
 *
 * @param symbol        the traced container (class / interface / module / …).
 * @param children      the container's direct indexed children (members).
 * @param symbols       ALL repo symbols (for inheritance resolution).
 * @param heritageRefs  the repo's `extends` / `implements` reference rows.
 */
export function buildApiSurface(
	symbol: CodebaseSymbol,
	children: CodebaseSymbol[],
	symbols: CodebaseSymbol[],
	heritageRefs: CodebaseReference[]
): ApiSurface {
	const { signature, container } = containerHeader(symbol);

	// Direct public members first (direct wins over inherited on name clash).
	const byName = new Map<string, ApiMember>();
	for (const c of children.sort((a, b) => (a.start_line ?? 0) - (b.start_line ?? 0))) {
		if (isPrivateOrProtected(c.signature)) continue;
		if (!byName.has(c.name)) byName.set(c.name, toMember(c, false));
	}

	// Fold in inherited public members (bounded, cycle-safe).
	const inherited = collectInheritedMembers(
		symbol,
		symbols,
		heritageRefs,
		MAX_API_INHERITANCE_DEPTH,
		new Set([symbol.id])
	);
	for (const m of inherited) {
		if (!byName.has(m.name)) byName.set(m.name, m);
	}

	// Stable source order across the whole surface (null lines last).
	const members = [...byName.values()].sort(
		(a, b) => (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER)
	);

	const truncated = members.length > MAX_API_MEMBERS;
	const capped = truncated ? members.slice(0, MAX_API_MEMBERS) : members;

	return {
		name: symbol.name,
		kind: symbol.kind,
		signature,
		file: symbol.file_path,
		line: symbol.start_line ?? null,
		container,
		members: capped,
		truncated
	};
}

/** Render the API surface as compact, block-style Markdown/code. */
export function formatApiSurface(surface: ApiSurface): string {
	if (!surface.container) {
		return surface.signature;
	}
	const lines: string[] = [surface.signature];
	for (const m of surface.members) {
		// Member signatures already carry their trailing `;` (compactSignature).
		lines.push(`  ${m.signature}`);
	}
	lines.push("}");
	return lines.join("\n");
}
