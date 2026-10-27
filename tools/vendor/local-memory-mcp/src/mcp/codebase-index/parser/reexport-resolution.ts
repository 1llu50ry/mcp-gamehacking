/**
 * reexport-resolution — re-export → canonical target resolution (issue #87,
 * TASK-013, semantic-graph epic P1).
 *
 * Given a `export { X } from './mod'` / `export { X as Y } from './mod'` /
 * `export * from './mod'` reference edge plus the repo's indexed symbol
 * surface, resolve the CANONICAL declaration the name ultimately points at —
 * chasing barrel / index chains across any number of hops and terminating
 * safely on cycles.
 *
 * Strategy (reuses the #83 import-resolution primitives):
 *
 *   1. MODULE → FILE  — via `resolveModuleToFile` (relative + tsconfig alias
 *      + barrel/index fallbacks). Aliased re-exports (`export { X as Y }`)
 *      keep the canonical imported name `X` for the chain; `Y` is only a local
 *      alias recorded for TRACE.
 *   2. FILE → re-export edge — a target file that re-exports the name via its
 *      OWN `export { X } from './next'` edge is followed transitively.
 *   3. FILE → exported symbol — the chain terminates when the name is a direct
 *      `exported` symbol in the resolved file (the canonical declaration).
 *   4. `export * from './types'` — expanded against the target file's EXPORTED
 *      symbols, each of which is resolved transitively.
 *
 * Cycle safety: every `resolveName` call is keyed by `file#name` in a
 * `visiting` set; re-entering the same `(file, name)` pair yields an empty
 * result (the cycle is cut, not thrown).
 *
 * Failure is silent and total: resolution never throws; an unresolvable name
 * degrades to `[]` and the re-export row is still persisted (unresolved
 * re-exports stay VISIBLE with null targets).
 */

import type { CodebaseReference, CodebaseSymbol } from "../../types";
import type { ImportInfo } from "./language-visitor";
import { resolveModuleToFile, type TsconfigPaths } from "./import-resolution";

/** A re-export edge, normalized for resolution (visitor + DB form). */
export interface ReexportSpec {
	/** Raw module specifier (`'./mod'`, `'@/domain'`). */
	moduleSpecifier: string;
	/** Canonical imported name (`User`). `null` for wildcard `export *`. */
	importedName: string | null;
	/** Local alias (`DomainUser` of `export { User as DomainUser }`). */
	aliasName: string | null;
	/** `named` for `export { X }`, `wildcard` for `export *`. */
	importKind: "named" | "wildcard";
}

/** A resolved canonical target of a re-export. */
export interface ResolvedReexport {
	targetFile: string;
	targetSymbolId: string | null;
	/** The canonical exported name at the resolved target. */
	canonicalName: string;
}

/** Immutable context the resolver needs from the index. */
export interface ReexportResolverContext {
	/** Repo-relative paths of all indexed files (codebase_files). */
	indexedFiles: ReadonlySet<string>;
	/** Repo symbols grouped by `file_path`. */
	symbolsByFile: Map<string, CodebaseSymbol[]>;
	/** Re-export edges grouped by `caller_file`. */
	reexportEdges: Map<string, ReexportSpec[]>;
	/** Parsed tsconfig baseUrl/paths (nullable). */
	tsconfig: TsconfigPaths | null;
}

/**
 * Cycle-safe, transitive re-export resolver. Stateless over calls — each
 * public `resolve` call takes its own `visiting` set (defaults to empty) so
 * concurrent/sequential resolution does not leak cycle state.
 */
export class ReexportResolver {
	constructor(private readonly ctx: ReexportResolverContext) {}

	/**
	 * Resolve a re-export reference emitted by the visitor to its canonical
	 * target(s). Returns `[]` for any fully-unresolved chain (and for cycle
	 * cut-points). Wildcards expand to one entry per re-exported symbol.
	 */
	resolve(callerFile: string, spec: ReexportSpec, visiting: Set<string> = new Set()): ResolvedReexport[] {
		const targetFile = resolveModuleToFile(spec.moduleSpecifier, callerFile, this.ctx.indexedFiles, this.ctx.tsconfig);
		if (!targetFile) return [];

		if (spec.importKind === "wildcard") {
			return this.expandWildcard(targetFile, visiting);
		}
		return this.resolveName(targetFile, spec.importedName!, visiting);
	}

	private expandWildcard(file: string, visiting: Set<string>): ResolvedReexport[] {
		const symbols = this.ctx.symbolsByFile.get(file) ?? [];
		const out: ResolvedReexport[] = [];
		for (const sym of symbols) {
			if (!sym.exported) continue;
			for (const r of this.resolveName(file, sym.name, visiting)) out.push(r);
		}
		return dedupeResolved(out);
	}

	private resolveName(file: string, name: string, visiting: Set<string>): ResolvedReexport[] {
		const visitKey = `${file}#${name}`;
		if (visiting.has(visitKey)) return [];
		visiting.add(visitKey);

		// 1. Follow a re-export edge from this file: `export { name } from 'x'`.
		const edges = this.ctx.reexportEdges.get(file) ?? [];
		const re = edges.find((e) => e.importKind === "named" && e.importedName === name);
		if (re) {
			const followed = this.resolve(file, re, visiting);
			if (followed.length > 0) return followed;
			// Edge resolved to nothing (dead target) — degrade to a same-file
			// exported symbol if one exists, else an empty (cycle/unknown) result.
			const local = this.findExportedSymbol(file, name);
			return local ? [local] : [];
		}

		// 2. No re-export edge — the name is a direct exported symbol here.
		const local = this.findExportedSymbol(file, name);
		return local ? [local] : [];
	}

	private findExportedSymbol(file: string, name: string): ResolvedReexport | null {
		const sym = (this.ctx.symbolsByFile.get(file) ?? []).find((s) => s.name === name && s.exported === true);
		return sym ? { targetFile: file, targetSymbolId: sym.id, canonicalName: name } : null;
	}
}

function dedupeResolved(items: ResolvedReexport[]): ResolvedReexport[] {
	const seen = new Set<string>();
	const out: ResolvedReexport[] = [];
	for (const r of items) {
		const key = r.targetSymbolId ? `id:${r.targetSymbolId}` : `f:${r.targetFile}#${r.canonicalName}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(r);
	}
	return out;
}

/** Build a {@link ReexportSpec} from a stored `codebase_references` row. */
export function reexportSpecFromReference(ref: CodebaseReference): ReexportSpec | null {
	if (!ref.module_specifier) return null;
	const isWildcard = ref.import_kind === "wildcard" || ref.imported_name === null;
	return {
		moduleSpecifier: ref.module_specifier,
		importedName: isWildcard ? null : ref.imported_name,
		aliasName: ref.local_name ?? null,
		importKind: isWildcard ? "wildcard" : "named"
	};
}

/** Build a {@link ReexportSpec} from a visitor `ParsedReference`. */
export function reexportSpecFromParsedReference(ref: { importInfo?: ImportInfo | null }): ReexportSpec | null {
	const info = ref.importInfo;
	if (!info || !info.moduleSpecifier) return null;
	const isWildcard = info.importKind === "wildcard" || info.importedName === null;
	return {
		moduleSpecifier: info.moduleSpecifier,
		importedName: isWildcard ? null : info.importedName,
		aliasName: info.localName ?? null,
		importKind: isWildcard ? "wildcard" : "named"
	};
}

/**
 * Build a {@link ReexportResolverContext} from the repo index: indexed file
 * paths, all symbols (grouped by file), and all stored re-export edges.
 */
export function buildReexportResolverContext(
	reexportRefs: CodebaseReference[],
	symbols: CodebaseSymbol[],
	indexedFiles: ReadonlySet<string>,
	tsconfig: TsconfigPaths | null = null
): ReexportResolverContext {
	const symbolsByFile = new Map<string, CodebaseSymbol[]>();
	for (const s of symbols) {
		const arr = symbolsByFile.get(s.file_path) ?? [];
		arr.push(s);
		symbolsByFile.set(s.file_path, arr);
	}

	const reexportEdges = new Map<string, ReexportSpec[]>();
	for (const r of reexportRefs) {
		const spec = reexportSpecFromReference(r);
		if (!spec) continue;
		const arr = reexportEdges.get(r.caller_file) ?? [];
		arr.push(spec);
		reexportEdges.set(r.caller_file, arr);
	}

	return { indexedFiles, symbolsByFile, reexportEdges, tsconfig };
}

/** Convenience: build a ready-to-use {@link ReexportResolver}. */
export function buildReexportResolver(
	reexportRefs: CodebaseReference[],
	symbols: CodebaseSymbol[],
	indexedFiles: ReadonlySet<string>,
	tsconfig: TsconfigPaths | null = null
): ReexportResolver {
	return new ReexportResolver(buildReexportResolverContext(reexportRefs, symbols, indexedFiles, tsconfig));
}
