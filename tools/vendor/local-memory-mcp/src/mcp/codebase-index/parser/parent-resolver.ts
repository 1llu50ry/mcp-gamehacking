/**
 * parent-resolver — parent_symbol_id resolution for the parse pipeline.
 *
 * Phase 1.1 / TASK-300: every language visitor already emits
 * `ParsedSymbol.parentName` — the NAME of the enclosing container (class /
 * interface / enum / function, etc.). What was missing is the DB id link:
 * parse-pipeline inserted `parent_symbol_id: null` unconditionally. This
 * module closes the gap with a two-part contract:
 *
 *   1. `resolveParentSymbolId(visitorStack)` — the shared policy util that
 *      Wave 1 language tasks (TASK-301..312) plug into. Given a stack of
 *      enclosing containers (innermost LAST), it returns the id of the
 *      NEAREST parent-eligible container, or null.
 *
 *   2. `resolveFileParents(symbols)` — pipeline integration: assigns each
 *      symbol a fresh id, builds a per-file registry of parent-eligible
 *      containers, disambiguates same-name collisions by span containment,
 *      and resolves every symbol's parent id using the policy util. Pure and
 *      deterministic per parse result — re-parsing a file recomputes the
 *      whole parent map, which the indexing writer replaces atomically
 *      (delete-by-file + bulk-insert in one transaction).
 *
 * Resolution is NAME-BASED per ADR-002 (no LSP): a child links to the
 * same-file container whose name matches `parentName`. Containment only
 * disambiguates when two same-name containers coexist in one file (e.g.
 * `class Foo` + `interface Foo`) — the innermost enclosing container wins.
 * Parent links never cross files (no visitor emits a cross-file parentName).
 */

import { randomUUID } from "crypto";
import type { ParsedSymbol } from "./language-visitor";
import { SymbolKind } from "./language-visitor";

// ── Public types ────────────────────────────────────────────────────────

/**
 * A container candidate on the visitor's nesting stack.
 *
 * Visitors (and the per-file linker) push every enclosing container while
 * descending the AST; `resolveParentSymbolId` scans the stack innermost-first
 * and returns the first PARENT-ELIGIBLE candidate's id.
 */
export interface ParentCandidate {
	/** Symbol name of the enclosing container (matches `parentName`). */
	name: string;
	/** Semantic kind — the parent-eligibility key (see PARENT_ELIGIBLE_KINDS). */
	kind: SymbolKind;
	/** 1-based start line of the container (span-containment disambiguation). */
	startLine: number;
	/** 1-based end line of the container (span-containment disambiguation). */
	endLine: number;
	/** Assigned id — set once the pipeline assigns ids (null pre-assignment). */
	symbolId: string | null;
}

/**
 * A parsed symbol carrying its assigned id + resolved parent id — the
 * pipeline-facing output of `resolveFileParents`.
 */
export interface ResolvedSymbol extends ParsedSymbol {
	/** UUID assigned by the pipeline (persisted as codebase_symbols.id). */
	id: string;
	/** Resolved same-file parent id (or null when top-level / unresolved). */
	resolvedParentSymbolId: string | null;
}

// ── Parent-eligibility policy ────────────────────────────────────────────

/**
 * Symbol kinds that can BE a parent of another symbol.
 *
 * Default policy across languages: class-like containers (class/interface/
 * enum) own their members; function/method are eligible so nested-function
 * nesting can be expressed when a language's top-level-symbol policy extracts
 * nested functions (TS deliberately does NOT — nested declarations inside
 * class bodies are skipped by the walker; other Wave 1 languages opt in by
 * emitting a `parentName`). Variable/property/type-alias/module/heading kinds
 * are NOT containers and are never parents.
 */
export const PARENT_ELIGIBLE_KINDS: ReadonlySet<SymbolKind> = new Set<SymbolKind>([
	SymbolKind.Class,
	SymbolKind.Interface,
	SymbolKind.Enum,
	SymbolKind.Function,
	SymbolKind.Method
]);

/** Per-file registry keyed by container name → candidate list (ids assigned). */
type ContainerRegistry = Map<string, ParentCandidate[]>;

// ── The plug-in contract (per spec: resolveParentSymbolId(visitorStack)) ─

/**
 * Resolve the parent symbol id from the visitor's stack of enclosing
 * containers (innermost LAST).
 *
 * Scans the stack innermost-first and returns the `symbolId` of the first
 * candidate whose kind is in `PARENT_ELIGIBLE_KINDS` and whose id is known.
 * Returns null when no eligible container exists, or when the eligible
 * container's id has not been assigned yet (a visitor calling the util before
 * pipeline id assignment gets null and must rely on `parentName` instead —
 * `resolveFileParents` performs the actual id linking).
 *
 * @param visitorStack  - Enclosing containers, innermost LAST (top of stack).
 * @param eligibleKinds - Overridable eligibility set (default: PARENT_ELIGIBLE_KINDS).
 */
export function resolveParentSymbolId(
	visitorStack: ParentCandidate[],
	eligibleKinds: ReadonlySet<SymbolKind> = PARENT_ELIGIBLE_KINDS
): string | null {
	for (let i = visitorStack.length - 1; i >= 0; i--) {
		const candidate = visitorStack[i];
		if (!eligibleKinds.has(candidate.kind)) continue;
		if (candidate.symbolId) return candidate.symbolId;
	}
	return null;
}

// ── Pipeline integration ─────────────────────────────────────────────────

/**
 * Resolve same-file parent links for one parse result.
 *
 * Steps:
 *   1. Assign every symbol a fresh UUID (id generation moves from the entity
 *      to the pipeline so children can reference their parent's id before
 *      insert — id churn per reparse is unchanged from the status quo, since
 *      delete+insert already regenerated ids for re-parsed files).
 *   2. Build the container registry from PARENT-ELIGIBLE symbols (candidates
 *      carry their assigned ids).
 *   3. For each symbol with a `parentName`: exclude the symbol itself (a
 *      parent-eligible same-name symbol — e.g. a constructor-style member —
 *      must never link to its own id), then collect same-name containers that
 *      SPAN-ENCLOSE the child ordered outer-first (ascending startLine), so
 *      `resolveParentSymbolId`'s innermost-LAST scan returns the NEAREST
 *      enclosing container; falling back to any remaining same-name container
 *      when none encloses (best-effort, name-based per ADR-002).
 *   4. Delegate the final pick to `resolveParentSymbolId` so the policy stays
 *      in ONE place for Wave 1 languages to override.
 */
export function resolveFileParents(symbols: ParsedSymbol[]): ResolvedSymbol[] {
	// Step 1: assign ids before registry build so candidates can be linked.
	const withIds: ResolvedSymbol[] = symbols.map((sym) => ({
		...sym,
		id: randomUUID(),
		resolvedParentSymbolId: null
	}));

	// Step 2: registry of parent-eligible containers, keyed by name.
	const registry: ContainerRegistry = buildContainerRegistry(withIds);

	// Steps 3 + 4: resolve each symbol's parent via the shared policy util.
	for (const sym of withIds) {
		if (!sym.parentName) continue;

		const candidates = registry.get(sym.parentName);
		if (!candidates || candidates.length === 0) continue;

		// Self-exclusion: a parent-eligible symbol must never link to itself.
		// Without this, a constructor-style member (`class Foo { Foo() {} }`)
		// — same-name and parent-eligible — would win the innermost-LAST scan
		// and become its own parent. Applied once so BOTH the enclosing list
		// and the fallback stack below are self-free.
		const others = candidates.filter((c) => c.symbolId !== sym.id);
		if (others.length === 0) continue;

		// Containment first: collect the same-name containers whose span
		// encloses this symbol's start line, ordered outer-first (ascending
		// startLine, longer span first on ties). The shared util scans
		// innermost-LAST, so the NEAREST enclosing container wins (disambiguates
		// same-name collisions like `class Foo` + `interface Foo`, and nested
		// same-name containers like `function foo { function foo {} }`).
		const enclosing = others
			.filter((c) => c.startLine <= sym.startLine && c.endLine >= sym.startLine)
			.sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);

		// Fallback: none of the same-name containers encloses this symbol —
		// best-effort name-based link per ADR-002. `others` (self-excluded)
		// guarantees the fallback never returns the symbol itself either.
		const stack = enclosing.length > 0 ? enclosing : others;
		sym.resolvedParentSymbolId = resolveParentSymbolId(stack);
	}

	return withIds;
}

/**
 * Build the per-file container registry from an id-assigned parse result.
 *
 * Only PARENT-ELIGIBLE kinds are indexed (they are the only symbols a child
 * can link to). Same-name containers accumulate so collision disambiguation
 * by span can happen per child.
 */
function buildContainerRegistry(symbols: ResolvedSymbol[]): ContainerRegistry {
	const registry: ContainerRegistry = new Map();
	for (const sym of symbols) {
		if (!PARENT_ELIGIBLE_KINDS.has(sym.kind)) continue;
		const candidate: ParentCandidate = {
			name: sym.name,
			kind: sym.kind,
			startLine: sym.startLine,
			endLine: sym.endLine,
			symbolId: sym.id
		};
		const candidates = registry.get(sym.name);
		if (candidates) {
			candidates.push(candidate);
		} else {
			registry.set(sym.name, [candidate]);
		}
	}
	return registry;
}
