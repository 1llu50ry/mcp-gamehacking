/**
 * typescript-enricher — OPTIONAL two-phase semantic-signature enrichment
 * (issue #89, TASK-015).
 *
 * Tree-sitter remains the PRIMARY, always-on structural indexer. This module
 * is a BOUNDED, ISOLATED secondary pass that runs the TypeScript compiler API
 * over already-structurally-indexed files to infer *type* signatures
 * (return/param/property types) and persist them on the separate
 * `semantic_signature` / `semantic_source` / `semantic_updated_at` columns.
 *
 * Design guarantees (acceptance criteria):
 *  - Never overwrites the explicit structural `signature` (a distinct column).
 *  - Degrades gracefully when no tsconfig.json / TS deps are available.
 *  - Resolves the NEAREST tsconfig.json for monorepos.
 *  - All exceptions are caught by the CALLER (parse-pipeline) — this module
 *    returns a `degraded` result rather than throwing, and the pipeline adds a
 *    timeout so a slow program can never block structural indexing.
 *  - Bounded: the program is built with `noResolve` so the dependency graph is
 *    never loaded; only the single source file is checked.
 */

import * as ts from "typescript";
import path from "node:path";
import { logger } from "../../utils/logger";
import { SymbolKind, type ParsedSymbol } from "../parser/language-visitor";
import type {
	SemanticAdapter,
	SemanticEnrichmentInput,
	SemanticEnrichmentResult,
	SemanticSymbolEnrichment
} from "./adapter";

/** Provenance tag persisted to `semantic_source`. */
export const SEMANTIC_SOURCE_TYPESCRIPT = "typescript-compiler";

/** One inferred semantic signature for a single symbol. */
export interface SemanticEnrichment {
	semanticSignature: string;
	semanticSource: string;
}

/**
 * Result of enriching one file. `bySymbolKey` maps `${name}#${startLine}` →
 * the inferred enrichment (a symbol may fail inference individually without
 * failing the whole file). `degraded` is true when the compiler could not run
 * (no tsconfig / parse error) so the caller can skip persisting.
 */
export interface SemanticEnrichResult {
	bySymbolKey: Map<string, SemanticEnrichment>;
	source: string;
	degraded: boolean;
	reason?: string;
}

/** Stable key for a ParsedSymbol within a file (name + 1-based start line). */
export function symbolKey(name: string, startLine: number): string {
	return `${name}#${startLine}`;
}

/**
 * Resolve the nearest tsconfig.json by walking UP from `fileDir` (monorepo
 * safe). Returns the absolute path, or null when none exists up to the FS root.
 */
export function resolveNearestTsConfig(fileDir: string): string | null {
	let dir = path.resolve(fileDir);
	// Walk up to the root (path.resolve returns the same dir at the root).
	for (;;) {
		const candidate = path.join(dir, "tsconfig.json");
		try {
			if (ts.sys.fileExists(candidate)) return candidate;
		} catch {
			// ignore unreadable dirs and keep walking up
		}
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

/** Base compiler options used when no tsconfig.json is found (degrade). */
function defaultCompilerOptions(_filePath: string): ts.CompilerOptions {
	return {
		allowJs: true,
		checkJs: false,
		target: ts.ScriptTarget.Latest,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		module: ts.ModuleKind.NodeNext,
		skipLibCheck: true,
		noResolve: true,
		strict: false
	};
}

/**
 * Build compiler options from the nearest tsconfig.json, falling back to
 * {@link defaultCompilerOptions} on any parse/read error (graceful degrade).
 */
function loadCompilerOptions(filePath: string): { options: ts.CompilerOptions; fromTsConfig: boolean } {
	const absFile = path.resolve(filePath);
	const tsconfigPath = resolveNearestTsConfig(path.dirname(absFile));
	if (!tsconfigPath) {
		return { options: defaultCompilerOptions(filePath), fromTsConfig: false };
	}
	try {
		const config = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
		if (config.error) {
			logger.debug("[SemanticEnricher] tsconfig read error — using defaults", {
				tsconfigPath,
				diagnostics: ts.flattenDiagnosticMessageText(config.error.messageText, "\n")
			});
			return { options: defaultCompilerOptions(filePath), fromTsConfig: true };
		}
		const parsed = ts.parseJsonConfigFileContent(
			config.config,
			ts.sys,
			path.dirname(tsconfigPath),
			undefined,
			tsconfigPath
		);
		// noResolve keeps the program bounded to the single file; skipLibCheck
		// avoids loading .d.ts graphs. Local inference still works.
		const options: ts.CompilerOptions = {
			...parsed.options,
			noResolve: true,
			skipLibCheck: true
		};
		return { options, fromTsConfig: true };
	} catch (err) {
		logger.debug("[SemanticEnricher] tsconfig parse error — using defaults", {
			tsconfigPath,
			error: err instanceof Error ? err.message : String(err)
		});
		return { options: defaultCompilerOptions(filePath), fromTsConfig: true };
	}
}

/** Locate the declaration node matching (name, startLine) in a source file. */
function findDeclarationNode(sourceFile: ts.SourceFile, name: string, startLine: number): ts.Node | null {
	let found: ts.Node | null = null;
	const visit = (node: ts.Node): void => {
		if (found) return;
		const nodeName = getNodeName(node);
		if (nodeName === name) {
			const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
			if (line === startLine) {
				found = node;
				return;
			}
		}
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(sourceFile, visit);
	return found;
}

/** Best-effort declared name of a node (identifier / binding name / type name). */
function getNodeName(node: ts.Node): string | null {
	if (ts.isIdentifier(node)) return node.text;
	const nameable = node as { name?: ts.Node };
	if (nameable.name && ts.isIdentifier(nameable.name)) return nameable.name.text;
	// variable_declarator: name is the first child identifier.
	if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
	return null;
}

/** Infer a compact semantic signature string for a declaration node. */
function inferSemanticForNode(
	checker: ts.TypeChecker,
	sourceFile: ts.SourceFile,
	node: ts.Node,
	kind: SymbolKind
): string | null {
	try {
		switch (kind) {
			case SymbolKind.Function:
			case SymbolKind.Method: {
				const sigDecl = node as ts.SignatureDeclaration;
				const sig = checker.getSignatureFromDeclaration(sigDecl);
				if (!sig) return null;
				return checker.signatureToString(sig);
			}
			case SymbolKind.Variable: {
				// An explicit type annotation wins over resolution: `const x: ID`
				// surfaces `ID` (the declared alias), not the resolved `string`.
				if (ts.isVariableDeclaration(node) && node.type) {
					return node.type.getText(sourceFile);
				}
				const t = checker.getTypeAtLocation(node);
				return checker.typeToString(t);
			}
			case SymbolKind.Property: {
				const t = checker.getTypeAtLocation(node);
				return checker.typeToString(t);
			}
			case SymbolKind.Class:
			case SymbolKind.Interface:
			case SymbolKind.Type: {
				const tp = (node as { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> }).typeParameters;
				if (tp && tp.length > 0) {
					return `<${tp.map((p) => p.getText(sourceFile)).join(", ")}>`;
				}
				return null;
			}
			default:
				return null;
		}
	} catch {
		return null;
	}
}

/**
 * Enrich one file's structural symbols with inferred semantic signatures.
 *
 * @returns {@link SemanticEnrichResult}; on compiler failure returns
 *          `{ degraded: true }` with an empty map (never throws).
 */
export function enrichFileSemantic(filePath: string, content: string, symbols: ParsedSymbol[]): SemanticEnrichResult {
	const empty: SemanticEnrichResult = {
		bySymbolKey: new Map(),
		source: SEMANTIC_SOURCE_TYPESCRIPT,
		degraded: true
	};
	try {
		const { options } = loadCompilerOptions(filePath);
		const absFile = path.resolve(filePath);
		const scriptKind = /\.tsx$/.test(filePath)
			? ts.ScriptKind.TSX
			: /\.jsx$/.test(filePath)
				? ts.ScriptKind.JSX
				: ts.ScriptKind.TS;

		const sourceFile = ts.createSourceFile(absFile, content, ts.ScriptTarget.Latest, true, scriptKind);

		// In-memory host: serve ONLY the single source file so the program is
		// bounded to the file (noResolve already prevents dep resolution, but the
		// host also guards against any on-disk read of the file itself).
		const host = ts.createCompilerHost(options);
		host.getSourceFile = (fileName, languageVersion, onError) => {
			if (fileName === absFile) return sourceFile;
			return ts.createCompilerHost(options).getSourceFile(fileName, languageVersion, onError);
		};
		host.fileExists = (fileName) => fileName === absFile || ts.sys.fileExists(fileName);
		host.readFile = (fileName) => (fileName === absFile ? content : ts.sys.readFile(fileName));

		const program = ts.createProgram([absFile], options, host);
		const checker = program.getTypeChecker();

		const bySymbolKey = new Map<string, SemanticEnrichment>();
		for (const sym of symbols) {
			const node = findDeclarationNode(sourceFile, sym.name, sym.startLine);
			if (!node) continue;
			const sig = inferSemanticForNode(checker, sourceFile, node, sym.kind);
			if (sig && sig.length > 0) {
				bySymbolKey.set(symbolKey(sym.name, sym.startLine), {
					semanticSignature: sig,
					semanticSource: SEMANTIC_SOURCE_TYPESCRIPT
				});
			}
		}

		return {
			bySymbolKey,
			source: SEMANTIC_SOURCE_TYPESCRIPT,
			degraded: false
		};
	} catch (err) {
		logger.debug("[SemanticEnricher] enrichment failed (degraded)", {
			filePath,
			error: err instanceof Error ? err.message : String(err)
		});
		return { ...empty, reason: err instanceof Error ? err.message : String(err) };
	}
}

/**
 * Run the enrichment pass with a wall-clock timeout. Resolves to a
 * `degraded` result on timeout so the caller can skip persistence without
 * failing structural indexing. The timeout races a cancellable promise; the
 * underlying program is abandoned (GC'd) after resolution.
 */
export async function enrichFileSemanticWithTimeout(
	filePath: string,
	content: string,
	symbols: ParsedSymbol[],
	timeoutMs: number
): Promise<SemanticEnrichResult> {
	return new Promise<SemanticEnrichResult>((resolve) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				logger.debug("[SemanticEnricher] enrichment timed out — skipping", { filePath, timeoutMs });
				resolve({
					bySymbolKey: new Map(),
					source: SEMANTIC_SOURCE_TYPESCRIPT,
					degraded: true,
					reason: `timeout after ${timeoutMs}ms`
				});
			}
		}, timeoutMs);

		Promise.resolve()
			.then(() => enrichFileSemantic(filePath, content, symbols))
			.then((result) => {
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					resolve(result);
				}
			})
			.catch((err) => {
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					resolve({
						bySymbolKey: new Map(),
						source: SEMANTIC_SOURCE_TYPESCRIPT,
						degraded: true,
						reason: err instanceof Error ? err.message : String(err)
					});
				}
			});
	});
}

/**
 * SemanticAdapter implementing the issue #90 contract for the TypeScript family.
 *
 * Wraps the existing compiler-API enrichment pass (#89) so it is selectable by
 * language through the {@link SemanticAdapterRegistry}. `enrich` runs the
 * (synchronous, never-throwing) `enrichFileSemantic`; the registry adds the
 * wall-clock timeout + try/catch isolation on top.
 */
export class TypeScriptSemanticAdapter implements SemanticAdapter {
	readonly name = SEMANTIC_SOURCE_TYPESCRIPT;

	/** TS-family languages the compiler API can structurally check (#89). */
	supports(language: string, _repoPath: string): boolean {
		return ["typescript", "ts", "tsx", "javascript", "js", "jsx"].includes(language.toLowerCase());
	}

	async enrich(input: SemanticEnrichmentInput): Promise<SemanticEnrichmentResult> {
		const result = enrichFileSemantic(input.filePath, input.content, input.symbols);
		const bySymbolKey = new Map<string, SemanticSymbolEnrichment>();
		for (const [key, value] of result.bySymbolKey) {
			bySymbolKey.set(key, {
				semanticSignature: value.semanticSignature,
				semanticSource: value.semanticSource
			});
		}
		return {
			bySymbolKey,
			source: result.source,
			provider: this.name,
			degraded: result.degraded,
			reason: result.reason,
			...(result.degraded ? {} : { refreshedAt: new Date().toISOString() })
		};
	}
}

/** Singleton — registered into the default {@link SemanticAdapterRegistry}. */
export const typescriptSemanticAdapter = new TypeScriptSemanticAdapter();
