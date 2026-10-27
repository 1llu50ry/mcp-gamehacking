import { db } from "../../lib/context";
import { ServiceError } from "../../lib/jsonApi";
import type { CodebaseSymbol } from "../../../mcp/types";
import type { CallerCalleePair, SymbolCallersResult } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// 2. SYMBOL CALLERS (CallGraph DAG pairs)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Caller/callee pairs for a symbol, grouped by caller (CallGraph DAG data).
 *
 * Mirrors the reference model of trace-service.ts (rows where
 * `symbol_name = target`), but exposes the ordered PAIR list the graph needs.
 * Caller context comes from codebase_references (caller_file / caller_line /
 * caller_name); callee = the queried symbol (with target_file when the v23
 * parse resolved it). Pairs are deduped by (caller name/file/line + kind) so
 * one call site never yields duplicate edges.
 *
 * `filePath` (optional, TASK-373) scopes the lookup to a single definition —
 * graph nodes carry filePath, so the CallGraph drilldown (TASK-328) always
 * disambiguates duplicate symbol names. When the scope still leaves multiple
 * matches (or a duplicate name is queried without filePath), the call fails
 * with 409 AMBIGUOUS_SYMBOL listing the candidates — mirroring traceSymbol's
 * disambiguation contract instead of silently picking an arbitrary
 * definition. filePath-scoped PAIRS are filtered to rows whose target
 * resolves to that exact symbol (target_symbol_id, else target_file), so the
 * returned symbol metadata and its edges describe the SAME node.
 *
 * @throws ServiceError 404 SYMBOL_NOT_FOUND when no symbol of that name
 *   exists (in that file, when filePath is provided).
 * @throws ServiceError 409 AMBIGUOUS_SYMBOL on duplicate names that filePath
 *   does not narrow to one.
 */
export function getSymbolCallers(repo: string, name: string, kind?: string, filePath?: string): SymbolCallersResult {
	const matches = db.codebaseSymbols.getSymbolByName(repo, name);
	if (matches.length === 0) {
		throw new ServiceError(404, `Symbol "${name}" not found in repo "${repo}"`, "SYMBOL_NOT_FOUND");
	}
	// Optional filePath scoping — never fall back to an arbitrary definition
	// for duplicate names (409, mirroring traceSymbol).
	const scoped = filePath ? matches.filter((m) => m.file_path === filePath) : matches;
	if (scoped.length === 0) {
		const where = filePath ? ` in file "${filePath}"` : "";
		throw new ServiceError(404, `Symbol "${name}" not found${where} in repo "${repo}"`, "SYMBOL_NOT_FOUND");
	}
	if (scoped.length > 1) {
		const candidates = scoped.map((s) => `${s.file_path}:${s.start_line ?? 0}`).join(", ");
		throw new ServiceError(
			409,
			`Ambiguous symbol "${name}" in repo "${repo}" — ${scoped.length} matches (${candidates}); provide filePath to disambiguate`,
			"AMBIGUOUS_SYMBOL"
		);
	}
	const symbol = scoped[0];

	let refs = db.codebaseReferences.getReferencesBySymbol(repo, name);
	// When scoped to a file, keep only pairs attributable to that definition
	// (exact target_symbol_id, else target_file) — the pairs + symbol
	// metadata must describe the same node the drilldown points at.
	if (filePath) {
		refs = refs.filter((r) =>
			r.target_symbol_id ? r.target_symbol_id === symbol.id : r.target_file === symbol.file_path
		);
	}
	if (kind) refs = refs.filter((r) => r.kind === kind);

	// Per-file symbol preload (bounded per request) resolves caller kinds for
	// the grouped view without an N+1 per call site.
	const fileSymbolsCache = new Map<string, CodebaseSymbol[]>();
	const callerKindOf = (filePath: string, callerName: string | null): string | null => {
		if (!callerName) return null;
		let fileSymbols = fileSymbolsCache.get(filePath);
		if (!fileSymbols) {
			fileSymbols = db.codebaseSymbols.getSymbolsByFile(repo, filePath);
			fileSymbolsCache.set(filePath, fileSymbols);
		}
		return fileSymbols.find((s) => s.name === callerName)?.kind ?? null;
	};

	const pairKey = (p: CallerCalleePair): string =>
		`${p.caller.name ?? ""}\u0000${p.caller.filePath}\u0000${p.caller.line ?? 0}\u0000${p.kind}`;

	const pairs: CallerCalleePair[] = [];
	const seenPairs = new Set<string>();
	for (const ref of refs) {
		const pair: CallerCalleePair = {
			caller: { name: ref.caller_name, filePath: ref.caller_file, line: ref.caller_line },
			callee: { name: ref.symbol_name, filePath: ref.target_file },
			kind: ref.kind
		};
		const key = pairKey(pair);
		if (seenPairs.has(key)) continue;
		seenPairs.add(key);
		pairs.push(pair);
	}

	// Group by caller symbol (name + file), preserving first-seen order.
	const grouped = new Map<string, SymbolCallersResult["groupedByCaller"][number]>();
	for (const pair of pairs) {
		const key = `${pair.caller.name ?? ""}\u0000${pair.caller.filePath}`;
		let entry = grouped.get(key);
		if (!entry) {
			entry = {
				caller: {
					name: pair.caller.name,
					filePath: pair.caller.filePath,
					kind: callerKindOf(pair.caller.filePath, pair.caller.name)
				},
				count: 0,
				pairs: []
			};
			grouped.set(key, entry);
		}
		entry.count++;
		entry.pairs.push(pair);
	}

	return {
		symbol: { name: symbol.name, kind: symbol.kind, filePath: symbol.file_path, line: symbol.start_line },
		pairs,
		groupedByCaller: [...grouped.values()],
		total: pairs.length
	};
}
