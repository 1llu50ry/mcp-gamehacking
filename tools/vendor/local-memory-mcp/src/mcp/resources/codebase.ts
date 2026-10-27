/**
 * codebase:// resource reads — symbol list, symbol detail (trace), file
 * landmark. Part of RS-1 (TASK-323).
 *
 * Read-only resource surface over the codebase index. Three families:
 *   - codebase://{repo}/symbols[?search=&kind=&limit=&offset=]  → symbol records
 *   - codebase://{repo}/symbols/{name}                           → trace payload
 *   - codebase://{repo}/files/{file_path}                        → file landmark
 *
 * Payloads REUSE the existing entity queries and service logic:
 *   - symbols list  → CodebaseSymbolEntity.searchSymbols (empty query lists all)
 *   - symbol detail → trace-service.traceSymbol (same data as TRACE mode)
 *   - file landmark → FILE-mode structuredContent shape (codebase.read.ts)
 *
 * Every read is read-only and DB FLAT: raw file content is NEVER stored or
 * served (files/{file_path} documents the disk-only contract; fetch content
 * via tools/codebase-read code mode with a caller-supplied repoPath).
 *
 * A repo that has not been indexed fails with RecoverableError carrying
 * guidance to run codebase-index (the canonical isIndexed semantic from
 * indexing-repository.getIndexStatus: totalFiles > 0).
 */

import type { SQLiteStore } from "../storage/sqlite";
import type { CodebaseSymbol } from "../types";
import {
	traceSymbol,
	AmbiguousSymbolError,
	SymbolNotFoundError,
	type TraceReference
} from "../codebase-index/services/trace-service";
import { RecoverableError } from "../codebase-index/types/errors";
import { CODEBASE_SEARCH_DEFAULT_LIMIT } from "../utils/constants";
import { storedReferenceToTraceReference } from "../tools/codebase-read/trace";

/** Upper bound for the symbols-list `limit` param (entity caps at 200 internally). */
const CODEBASE_RESOURCE_MAX_LIMIT = 200;

/** Parsed form of a codebase:// resource URI (null for non-codebase URIs). */
export interface CodebaseUriParts {
	repo: string;
	resource: "symbols" | "symbol" | "file";
	/** Symbols list — comma-free search filter (null when absent). */
	search: string | null;
	/** Symbols list — kind filter (null when absent). */
	kind: string | null;
	/** Symbols list — page size (null → caller default). */
	limit: number | null;
	/** Symbols list — page offset (default 0). */
	offset: number;
	/** Symbol detail — symbol name (symbols/{name} only). */
	name: string | null;
	/** File landmark — indexed file path (files/{file_path} only). */
	filePath: string | null;
}

/**
 * Parses `codebase://{repo}/...` URIs.
 *
 * URI forms (mirroring the registered SDK templates — any subset of the query
 * params is accepted by the parser; single-param siblings + the full-query
 * form are registered individually because the SDK's `{?...}` operator matches
 * ALL listed params or none):
 *   - `codebase://{repo}/symbols`                      (no query)
 *   - `codebase://{repo}/symbols?search=&kind=&limit=` (full-query form)
 *   - `codebase://{repo}/symbols?search=&kind=&limit=&offset=` (pagination)
 *   - `codebase://{repo}/symbols?search=` / `?kind=` / `?limit=` / `?offset=` (single-param)
 *   - `codebase://{repo}/symbols/{name}`               (single-segment name)
 *   - `codebase://{repo}/files/{file_path}`            (file_path may contain slashes)
 *
 * Returns null when the URI is not a valid codebase:// resource or carries
 * malformed percent-encoding (readCodebaseResource then raises the -32002
 * resource-not-found contract, never a raw URIError).
 */
export function parseCodebaseUri(uri: string): CodebaseUriParts | null {
	const prefix = "codebase://";
	if (!uri.startsWith(prefix)) return null;

	let rest = uri.slice(prefix.length);
	const queryStart = rest.indexOf("?");
	const queryString = queryStart === -1 ? "" : rest.slice(queryStart + 1);
	rest = queryStart === -1 ? rest : rest.slice(0, queryStart);

	const slashIdx = rest.indexOf("/");
	if (slashIdx === -1) return null; // must have a path
	const repo = safeDecode(rest.slice(0, slashIdx));
	const path = rest.slice(slashIdx + 1);
	if (!repo || !path) return null;

	const query = new URLSearchParams(queryString);
	const search = trimOrNull(query.get("search"));
	const kind = trimOrNull(query.get("kind"));
	const limit = parseBoundedLimit(query.get("limit"));
	const offset = Math.max(0, Math.trunc(Number(query.get("offset")) || 0));

	// Symbols list: codebase://{repo}/symbols
	if (path === "symbols") {
		return { repo, resource: "symbols", search, kind, limit, offset, name: null, filePath: null };
	}

	// Symbol detail: codebase://{repo}/symbols/{name} (single segment)
	const symbolsPrefix = "symbols/";
	if (path.startsWith(symbolsPrefix)) {
		const rawName = path.slice(symbolsPrefix.length);
		if (!rawName || rawName.includes("/")) return null;
		const name = safeDecode(rawName);
		if (!name) return null;
		return {
			repo,
			resource: "symbol",
			search: null,
			kind: null,
			limit: null,
			offset: 0,
			name,
			filePath: null
		};
	}

	// File landmark: codebase://{repo}/files/{file_path} (multi-segment)
	const filesPrefix = "files/";
	if (path.startsWith(filesPrefix)) {
		const rawPath = path.slice(filesPrefix.length);
		if (!rawPath) return null;
		const filePath = safeDecode(rawPath);
		if (!filePath) return null;
		return {
			repo,
			resource: "file",
			search: null,
			kind: null,
			limit: null,
			offset: 0,
			name: null,
			filePath
		};
	}

	return null;
}

/**
 * Reads a codebase:// resource into the MCP resource contents envelope.
 * Dispatches to the symbols list / symbol detail / file landmark builders.
 *
 * @throws {RecoverableError} when the repo is not indexed (guidance to run codebase-index).
 * @throws {Error} code -32002 when the resource itself does not exist (unknown
 *   URI, symbol not found, file not in index).
 */
export function readCodebaseResource(uri: string, db: SQLiteStore) {
	const parsed = parseCodebaseUri(uri);
	if (!parsed) throw resourceNotFound(`Unknown codebase resource URI: ${uri}`, uri);

	assertRepoIndexed(db, parsed.repo, uri);

	switch (parsed.resource) {
		case "symbols":
			return readSymbolsList(parsed, db, uri);
		case "symbol":
			return readSymbolDetail(parsed, db, uri);
		case "file":
			return readFileLandmark(parsed, db, uri);
	}
}

// ── Template metadata (shared across the three surfaces) ──────────────────

/**
 * listResourceTemplates entries (spread into resources/index.ts), mirroring
 * the SDK registrations: the `{?...}` operator matches ALL listed params or
 * none, so each param usable alone (search/kind/limit/offset) has its own
 * template; the file template advertises the SDK's multi-segment `{+file_path}`.
 */
export const CODEBASE_RESOURCE_TEMPLATES = [
	{
		uriTemplate: "codebase://{repo}/symbols",
		name: "Codebase Symbols",
		title: "Codebase Symbols",
		description: "Indexed symbol records for a repo",
		mimeType: "application/json",
		annotations: { audience: ["assistant"], priority: 0.7 }
	},
	{
		uriTemplate: "codebase://{repo}/symbols?search={search}&kind={kind}&limit={limit}",
		name: "Filtered Codebase Symbols",
		title: "Filtered Codebase Symbols",
		description: "Search and filter indexed symbols by keyword or kind",
		mimeType: "application/json",
		annotations: { audience: ["assistant"], priority: 0.65 }
	},
	{
		uriTemplate: "codebase://{repo}/symbols?search={search}",
		name: "Codebase Symbols by Search",
		title: "Codebase Symbols by Search",
		description: "Search indexed symbols by keyword",
		mimeType: "application/json",
		annotations: { audience: ["assistant"], priority: 0.6 }
	},
	{
		uriTemplate: "codebase://{repo}/symbols?kind={kind}",
		name: "Codebase Symbols by Kind",
		title: "Codebase Symbols by Kind",
		description: "Filter indexed symbols by kind",
		mimeType: "application/json",
		annotations: { audience: ["assistant"], priority: 0.6 }
	},
	{
		uriTemplate: "codebase://{repo}/symbols?limit={limit}",
		name: "Codebase Symbols with Page Size",
		title: "Codebase Symbols with Page Size",
		description: "Page the symbol list with an explicit page size",
		mimeType: "application/json",
		annotations: { audience: ["assistant"], priority: 0.55 }
	},
	{
		uriTemplate: "codebase://{repo}/symbols?offset={offset}",
		name: "Codebase Symbols with Pagination Offset",
		title: "Codebase Symbols with Pagination Offset",
		description: "Page the symbol list by offset (follow hasMore pagination)",
		mimeType: "application/json",
		annotations: { audience: ["assistant"], priority: 0.55 }
	},
	{
		uriTemplate: "codebase://{repo}/symbols/{name}",
		name: "Codebase Symbol Detail",
		title: "Codebase Symbol Detail",
		description: "Trace payload for one symbol (definition, references, hierarchy)",
		mimeType: "application/json",
		annotations: { audience: ["assistant"], priority: 0.75 }
	},
	{
		uriTemplate: "codebase://{repo}/files/{+file_path}",
		name: "Codebase File",
		title: "Codebase File",
		description: "Indexed file landmark (meta + symbol list, no content)",
		mimeType: "application/json",
		annotations: { audience: ["assistant"], priority: 0.6 }
	}
];

/**
 * URI strings completeResourceArgument accepts for {repo}: BOTH the listing
 * form (`?a={a}`, `{file_path}`) and the SDK registration form (`{?a,b,c}`,
 * `{+file_path}`) that production completion receives — exact-match, so no
 * listed template throws -32602.
 */
export const CODEBASE_TEMPLATE_URIS = [
	"codebase://{repo}/symbols",
	"codebase://{repo}/symbols?search={search}&kind={kind}&limit={limit}",
	"codebase://{repo}/symbols{?search,kind,limit}",
	"codebase://{repo}/symbols?search={search}",
	"codebase://{repo}/symbols{?search}",
	"codebase://{repo}/symbols?kind={kind}",
	"codebase://{repo}/symbols{?kind}",
	"codebase://{repo}/symbols?limit={limit}",
	"codebase://{repo}/symbols{?limit}",
	"codebase://{repo}/symbols?offset={offset}",
	"codebase://{repo}/symbols{?offset}",
	"codebase://{repo}/symbols/{name}",
	"codebase://{repo}/files/{file_path}",
	"codebase://{repo}/files/{+file_path}"
];

// ── Resource builders ─────────────────────────────────────────────────────

/**
 * Symbols list — a compact symbol record per match.
 *
 * Reuses CodebaseSymbolEntity.searchSymbols with a single call: an empty
 * `search` degrades to the LIKE `%%` path (lists all symbols for the repo),
 * `kind` filters in SQL, and `limit`/`offset` paginate in SQL with an
 * authoritative COUNT for `total`/`hasMore`.
 */
function readSymbolsList(parsed: CodebaseUriParts, db: SQLiteStore, uri: string) {
	const limit = parsed.limit ?? CODEBASE_SEARCH_DEFAULT_LIMIT;
	const offset = parsed.offset;

	const result = db.codebaseSymbols.searchSymbols({
		query: parsed.search ?? "",
		repo: parsed.repo,
		kind: parsed.kind ?? undefined,
		limit,
		offset
	});

	const payload = {
		mode: "symbols",
		repo: parsed.repo,
		search: parsed.search,
		kind: parsed.kind,
		records: result.symbols.map(symbolToRecord),
		total: result.total,
		hasMore: result.hasMore,
		limit,
		offset
	};

	return resourceContents(uri, payload, deriveLastModified(result.symbols.map((s) => s.updated_at)), 0.7);
}

/**
 * Symbol detail — the TRACE payload for one symbol.
 *
 * Reuses trace-service.traceSymbol (definition, export chain, table-backed +
 * in-memory references merged by call-site, parent/children hierarchy) fed by
 * the same inputs as TRACE mode: full repo symbol array + stored reference
 * edges mapped to TraceReference.
 *
 * An ambiguous name returns a disambiguation payload (the resolved
 * representation of "several symbols share this name") instead of failing —
 * the agent can then disambiguate or refine.
 */
function readSymbolDetail(parsed: CodebaseUriParts, db: SQLiteStore, uri: string) {
	const repo = parsed.repo;
	const name = parsed.name as string;

	const allSymbols = db.codebaseSymbols.getSymbolsByRepo(repo);
	const storedRefs: TraceReference[] = db.codebaseReferences
		.getReferencesBySymbol(repo, name)
		.map(storedReferenceToTraceReference);

	try {
		const result = traceSymbol(name, repo, allSymbols, true, storedRefs);
		const payload = {
			mode: "trace",
			repo,
			name,
			...result
		};
		return resourceContents(uri, payload, result.symbol.updated_at, 0.75);
	} catch (err) {
		if (err instanceof AmbiguousSymbolError) {
			const payload = {
				mode: "trace",
				repo,
				name,
				ambiguous: true,
				disambiguation: err.disambiguation.map(symbolToRecord)
			};
			return resourceContents(uri, payload, new Date().toISOString(), 0.75);
		}
		if (err instanceof SymbolNotFoundError) {
			throw resourceNotFound(`Symbol "${name}" not found in repo "${repo}"`, uri);
		}
		throw err;
	}
}

/**
 * File landmark — file meta + symbol list, WITHOUT raw content.
 *
 * Mirrors the FILE-mode structuredContent shape (codebase.read.ts
 * handleFileMode): `file` block with path/language/checksum/lines/sizeBytes/
 * lastIndexedAt plus the full symbol list. `content` is explicitly null and
 * documented as disk-only — the index stores no content (DB FLAT); fetch raw
 * content via tools/codebase-read code mode with a caller-supplied repoPath.
 */
function readFileLandmark(parsed: CodebaseUriParts, db: SQLiteStore, uri: string) {
	const repo = parsed.repo;
	const filePath = parsed.filePath as string;

	const file = db.codebaseFiles.getFile(repo, filePath);
	if (!file) {
		throw resourceNotFound(
			`File '${filePath}' not found in index for repo '${repo}'. Run index_repository (or re-index) to index it.`,
			uri
		);
	}

	const symbols = db.codebaseSymbols.getSymbolsByFile(repo, filePath);

	const payload = {
		mode: "file",
		file: {
			path: file.file_path,
			language: file.language,
			checksum: file.checksum,
			lines: file.lines,
			sizeBytes: file.size_bytes,
			lastIndexedAt: file.last_indexed_at
		},
		// Disk-only contract: the index stores no raw file content (DB FLAT).
		// Read content via tools/codebase-read code mode with a repoPath.
		content: null,
		symbols,
		total: symbols.length
	};

	return resourceContents(uri, payload, file.last_indexed_at || file.updated_at, 0.6);
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Compact symbol record for resource payloads
 * (spec: name / kind / file_path / lines / signature).
 */
function symbolToRecord(symbol: CodebaseSymbol) {
	return {
		id: symbol.id,
		name: symbol.name,
		kind: symbol.kind,
		filePath: symbol.file_path,
		startLine: symbol.start_line,
		endLine: symbol.end_line,
		signature: symbol.signature,
		exported: symbol.exported,
		defaultExport: symbol.default_export
	};
}

/**
 * Repo-not-indexed gate — mirrors the canonical isIndexed semantic from
 * indexing-repository.getIndexStatus (totalFiles > 0 via codebase_files).
 * Fails with RecoverableError + guidance to run codebase-index on the repo.
 */
function assertRepoIndexed(db: SQLiteStore, repo: string, uri: string): void {
	const fileCount = db.codebaseFiles.getFileCountByRepo(repo);
	if (fileCount === 0) {
		throw new RecoverableError(`Repo "${repo}" not indexed. Run codebase-index on repo.`, {
			uri,
			repo,
			guidance: "codebase-index"
		});
	}
}

function trimOrNull(value: string | null): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

/**
 * Decodes a percent-encoded URI segment; null on malformed encoding (a raw
 * URIError carries no .code and would surface as a generic internal error).
 * null → parse returns null → -32002 resource-not-found contract.
 */
function safeDecode(raw: string): string | null {
	try {
		return decodeURIComponent(raw);
	} catch {
		return null;
	}
}

function parseBoundedLimit(raw: string | null): number | null {
	if (raw === null || raw === "") return null;
	const n = Math.trunc(Number(raw));
	if (!Number.isFinite(n) || n < 1) return null;
	return Math.min(n, CODEBASE_RESOURCE_MAX_LIMIT);
}

function resourceContents(uri: string, payload: unknown, lastModified: string | null, priority: number) {
	const text = JSON.stringify(payload, null, 2);
	return {
		contents: [
			{
				uri,
				mimeType: "application/json",
				text,
				size: Buffer.byteLength(text, "utf8"),
				annotations: {
					audience: ["assistant"],
					priority,
					lastModified: lastModified ?? new Date().toISOString()
				}
			}
		]
	};
}

function deriveLastModified(values: Array<string | undefined | null>) {
	const normalized = values.filter((value): value is string => typeof value === "string" && value.length > 0);
	return normalized.sort().at(-1) ?? new Date().toISOString();
}

function resourceNotFound(message: string, uri: string) {
	const error = new Error(message) as Error & { code: number; data?: Record<string, unknown> };
	error.code = -32002;
	error.data = { uri };
	return error;
}
