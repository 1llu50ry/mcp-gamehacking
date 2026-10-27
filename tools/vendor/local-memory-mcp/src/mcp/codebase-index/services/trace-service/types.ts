import type { CodebaseSymbol } from "../../../types";

export interface TraceResult {
	symbol: CodebaseSymbol;
	definition: {
		file: string;
		line: number;
		column: number;
		endLine: number;
		endColumn: number;
	};
	references: TraceReference[];
	exportChain: {
		exported: boolean;
		defaultExport: boolean;
	};
	parent: {
		id: string;
		name: string;
		kind: string;
		filePath: string;
		line: number | null;
	} | null;
	children: CodebaseSymbol[];
	disambiguation?: CodebaseSymbol[];
	reexportChain: ReexportChainEntry[];
}

export interface ReexportChainEntry {
	filePath: string;
	startLine: number | null;
	aliasName: string | null;
	canonicalName: string | null;
	moduleSpecifier: string | null;
	importKind: string | null;
}

export interface TraceReference {
	filePath: string;
	startLine: number;
	startCol: number;
	endLine: number;
	endCol: number;
	context: string;
	kind?: string;
	callerName?: string | null;
	targetFile?: string | null;
	targetSymbolId?: string | null;
	role?: string | null;
	localName?: string | null;
	importedName?: string | null;
	moduleSpecifier?: string | null;
	importKind?: string | null;
}
