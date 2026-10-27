import { createHash } from "node:crypto";

export interface StructuralSymbolFingerprintInput {
	name: string;
	kind: string;
	exported?: boolean | number;
	default_export?: boolean | number;
	signature?: string | null;
	doc_comment?: string | null;
	semantic_signature?: string | null;
	source_fingerprint?: string | null;
}

export function fingerprintSymbol(symbol: StructuralSymbolFingerprintInput): string {
	return createHash("sha256")
		.update(
			JSON.stringify([
				symbol.name,
				symbol.kind,
				Boolean(symbol.exported),
				Boolean(symbol.default_export),
				symbol.signature ?? null,
				symbol.doc_comment ?? null,
				symbol.semantic_signature ?? null,
				symbol.source_fingerprint ?? null
			])
		)
		.digest("hex");
}

export function fingerprintSourceRange(content: string, startLine?: number | null, endLine?: number | null): string {
	const lines = content.split(/\r?\n/);
	const start = Math.max(0, (startLine ?? 1) - 1);
	const end = Math.max(start + 1, endLine ?? startLine ?? 1);
	return createHash("sha256").update(lines.slice(start, end).join("\n")).digest("hex");
}
