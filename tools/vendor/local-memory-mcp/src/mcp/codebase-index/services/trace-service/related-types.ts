import type { CodebaseReference, CodebaseSymbol, RelatedTypesResult } from "../../../types";
import { MAX_TYPE_EDGES_PER_LEVEL } from "./constants";
import { resolveTypeTarget, typeEdgesOf } from "./resolve";

export function collectRelatedTypes(
	root: CodebaseSymbol,
	repo: string | undefined,
	symbols: CodebaseSymbol[],
	references: CodebaseReference[],
	maxDepth: number
): RelatedTypesResult {
	const edges: RelatedTypesResult["edges"] = [];
	let skippedUnresolved = 0;

	const symbolsById = new Map<string, CodebaseSymbol>();
	for (const s of symbols) symbolsById.set(s.id, s);

	const symbolsByFile = new Map<string, CodebaseSymbol[]>();
	for (const s of symbols) {
		const arr = symbolsByFile.get(s.file_path) ?? [];
		arr.push(s);
		symbolsByFile.set(s.file_path, arr);
	}

	const reported = new Set<string>([root.id]);
	const expanded = new Set<string>();

	const rootRefs = typeEdgesOf(root, references);
	let frontier: Array<{ symbolId: string; depth: number }> = [];
	for (const ref of rootRefs) {
		const resolved = resolveTypeTarget(ref, root, repo, symbols, symbolsById, symbolsByFile);
		if (!resolved) {
			skippedUnresolved++;
			continue;
		}
		const key = resolved.symbol.id;
		if (reported.has(key)) continue;
		reported.add(key);
		edges.push({
			targetSymbolId: key,
			targetName: resolved.symbol.name,
			targetFile: resolved.symbol.file_path,
			targetKind: resolved.symbol.kind,
			role: ref.role ?? null,
			depth: 1,
			fromName: root.name,
			fromSymbolId: root.id,
			line: ref.caller_line ?? null
		});
		frontier.push({ symbolId: key, depth: 1 });
	}
	expanded.add(root.id);

	for (let depth = 2; depth <= maxDepth; depth++) {
		const next: Array<{ symbolId: string; depth: number }> = [];
		let levelBreadth = 0;
		for (const current of frontier) {
			if (expanded.has(current.symbolId)) continue;
			expanded.add(current.symbolId);
			const symbol = symbolsById.get(current.symbolId);
			if (!symbol) continue;
			const refs = typeEdgesOf(symbol, references);
			for (const ref of refs) {
				if (levelBreadth >= MAX_TYPE_EDGES_PER_LEVEL) break;
				const resolved = resolveTypeTarget(ref, symbol, repo, symbols, symbolsById, symbolsByFile);
				if (!resolved) {
					skippedUnresolved++;
					continue;
				}
				const key = resolved.symbol.id;
				levelBreadth++;
				if (reported.has(key)) continue;
				reported.add(key);
				edges.push({
					targetSymbolId: key,
					targetName: resolved.symbol.name,
					targetFile: resolved.symbol.file_path,
					targetKind: resolved.symbol.kind,
					role: ref.role ?? null,
					depth,
					fromName: symbol.name,
					fromSymbolId: current.symbolId,
					line: ref.caller_line ?? null
				});
				next.push({ symbolId: key, depth });
			}
			if (levelBreadth >= MAX_TYPE_EDGES_PER_LEVEL) break;
		}
		frontier = next;
		if (frontier.length === 0) break;
	}

	return { edges, skippedUnresolved };
}
