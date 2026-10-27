/**
 * row-mappers — pure persistence row mappers for the parse pipeline.
 *
 * Split of the former parse-pipeline.ts monolith (TASK-553). Each mapper turns
 * a parsed visitor artifact (symbol / reference / file) into its DB insert row
 * WITHOUT touching shared counters or the write lock, so the batch-persist
 * module can accumulate rows and flush them in one bounded transaction.
 */

import type { ParsedReference } from "../../parser/language-visitor";
import type { CodebaseFileInsert, CodebaseSymbolInsert, CodebaseReferenceInsert } from "../../../types";
import type { ParseTask } from "./constants";
import type { SymbolWithSemantic } from "./types";
import { fingerprintSourceRange } from "../../../utils/source-fingerprint";

/** Build a canonical {@link CodebaseReferenceInsert} from a visitor reference. */
export function referenceInsert(ref: ParsedReference, filePath: string, repo: string): CodebaseReferenceInsert {
	return {
		repo,
		symbol_name: ref.symbolName,
		caller_file: ref.callerFile || filePath,
		caller_line: ref.callerLine,
		caller_name: ref.callerName,
		kind: ref.kind,
		target_file: ref.targetFile ?? null,
		target_symbol_id: ref.targetSymbolId ?? null,
		role: ref.role ?? null,
		local_name: ref.importInfo?.localName ?? null,
		imported_name: ref.importInfo?.importedName ?? null,
		module_specifier: ref.importInfo?.moduleSpecifier ?? null,
		import_kind: ref.importInfo?.importKind ?? null
	};
}

/** Build a canonical reference insert from a fully resolved (flat) row input. */
export function referenceInsertFromRow(row: {
	repo: string;
	filePath: string;
	symbolName: string;
	callerLine: number;
	callerName: string | null;
	kind: ParsedReference["kind"];
	targetFile: string | null;
	targetSymbolId: string | null;
	role: ParsedReference["role"] | null;
	importInfo?: ParsedReference["importInfo"];
}): CodebaseReferenceInsert {
	return {
		repo: row.repo,
		symbol_name: row.symbolName,
		caller_file: row.filePath,
		caller_line: row.callerLine,
		caller_name: row.callerName,
		kind: row.kind,
		target_file: row.targetFile,
		target_symbol_id: row.targetSymbolId,
		role: row.role ?? null,
		local_name: row.importInfo?.localName ?? null,
		imported_name: row.importInfo?.importedName ?? null,
		module_specifier: row.importInfo?.moduleSpecifier ?? null,
		import_kind: row.importInfo?.importKind ?? null
	};
}

/**
 * Map one resolved symbol (with optional semantic columns) to its
 * {@link CodebaseSymbolInsert} row. The parent map is recomputed per parse and
 * replaced atomically per file by the indexing writer (delete-by-file +
 * bulk-insert in one txn), so the entity honors the pre-assigned id.
 */
export function symbolRow(
	sym: SymbolWithSemantic,
	repo: string,
	filePath: string,
	content: string
): CodebaseSymbolInsert {
	return {
		id: sym.id,
		repo,
		file_path: filePath,
		name: sym.name,
		kind: sym.kind,
		exported: sym.exported,
		default_export: sym.defaultExport,
		start_line: sym.startLine,
		start_col: sym.startCol,
		end_line: sym.endLine,
		end_col: sym.endCol,
		signature: sym.signature,
		doc_comment: sym.docComment,
		parent_symbol_id: sym.resolvedParentSymbolId,
		semantic_signature: sym.semantic?.semanticSignature ?? null,
		semantic_source: sym.semantic?.semanticSource ?? null,
		semantic_updated_at: sym.semanticUpdatedAt,
		source_fingerprint: fingerprintSourceRange(content, sym.startLine, sym.endLine)
	};
}

/** Map a parsed file back to its {@link CodebaseFileInsert} row. */
export function fileRow(plan: ParseTask, repo: string, checksum: string, lineCount: number): CodebaseFileInsert {
	return {
		repo,
		file_path: plan.filePath,
		language: plan.language,
		checksum,
		lines: lineCount,
		size_bytes: plan.sizeBytes
	};
}
