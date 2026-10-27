import express from "express";
import { handleController, HttpError } from "../lib/jsonApi";
import { CodebaseService, errorCodeToHttp } from "../services/codebase.service";

/**
 * Error responder for the codebase endpoints.
 *
 * Unlike the other dashboard controllers, the codebase API deliberately
 * returns raw payloads (no JSON:API envelope): the UI deserializer and the
 * integration tests rely on top-level fields (`code`, `symbols`, `root`,
 * `isIndexed`, ...). Errors therefore keep the `{ error, code, ...extra }`
 * shape instead of `jsonApiError`'s `{ errors: [...] }`.
 */
function onCodebaseError(res: express.Response, err: HttpError): void {
	if (res.headersSent) {
		res.end();
		return;
	}
	const body: Record<string, unknown> = { error: err.message, code: err.code || "INTERNAL_SERVER_ERROR" };
	if (err.extra) Object.assign(body, err.extra);
	res.status(err.status).json(body);
}

/**
 * Converts a tool-handler error payload (`structuredContent.error`) into a
 * thrown `HttpError` carrying the tool's code, preserving the HTTP status
 * derived by `errorCodeToHttp`.
 */
function assertNoToolError(data: Record<string, unknown>, fallbackCode: string, extra?: Record<string, unknown>): void {
	if (data.error) {
		throw new HttpError(
			errorCodeToHttp((data.code as string) ?? ""),
			data.error as string,
			(data.code as string) ?? fallbackCode,
			extra
		);
	}
}

/**
 * Reads a request param from the query string (GET) or JSON body (POST),
 * trimmed. Undefined when absent/empty — callers 400 on required params.
 */
function param(req: express.Request, key: string): string | undefined {
	const fromQuery = req.query[key];
	if (typeof fromQuery === "string" && fromQuery.trim() !== "") return fromQuery.trim();
	const body = (req.body as Record<string, unknown> | undefined)?.[key];
	if (typeof body === "string" && body.trim() !== "") return body.trim();
	return undefined;
}

/**
 * Thin request/response adapter for codebase endpoints.
 * Business logic delegated to CodebaseService.
 */
export class CodebaseController {
	// GET /api/codebase/architecture?repo=owner/repo&depth=2&includeSymbolCounts=true
	static async getArchitecture(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const repo = (req.query.repo as string)?.trim();
				if (!repo) throw new HttpError(400, "repo query parameter is required", "MISSING_REPO");

				const result = await CodebaseService.readArchitecture(
					repo,
					req.query.depth as string,
					req.query.includeSymbolCounts as string
				);

				return result;
			},
			{ onError: onCodebaseError }
		);
	}

	// GET /api/codebase/symbols?repo=owner/repo&filePath=src/main.ts
	static async getFileSymbols(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const repo = (req.query.repo as string)?.trim();
				const filePath = (req.query.filePath as string)?.trim();

				if (!repo) throw new HttpError(400, "repo query parameter is required", "MISSING_REPO");
				if (!filePath) throw new HttpError(400, "filePath query parameter is required", "MISSING_FILE_PATH");

				const result = await CodebaseService.readFileSymbols(repo, filePath);
				assertNoToolError(result as Record<string, unknown>, "GET_SYMBOLS_FAILED");
				return result;
			},
			{ onError: onCodebaseError }
		);
	}

	// GET /api/codebase/search?repo=owner/repo&query=handler&kind=Function&limit=20&offset=0
	static async searchSymbols(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const params: Record<string, unknown> = {};

				if (req.query.query !== undefined) params.query = req.query.query;
				if (req.query.repo !== undefined) params.repo = (req.query.repo as string).trim();
				if (req.query.kind !== undefined) params.kind = req.query.kind;
				if (req.query.filePath !== undefined) params.filePath = req.query.filePath;
				if (req.query.exportedOnly !== undefined) params.exportedOnly = req.query.exportedOnly;
				if (req.query.limit !== undefined) params.limit = req.query.limit;
				if (req.query.offset !== undefined) params.offset = req.query.offset;

				const result = await CodebaseService.searchSymbols(params);
				assertNoToolError(result as Record<string, unknown>, "SEARCH_FAILED");
				return result;
			},
			{ onError: onCodebaseError }
		);
	}

	// GET /api/codebase/code-search?repo=owner/repo&content=handler&regex=false&language=ts&limit=10&offset=0
	// Content grep over indexed files (TASK-317, backend CODE mode from TASK-316).
	// `regex` is a STRICT boolean in the tool schema (z.boolean, not coerced), so the
	// query string is coerced here before proxying to CodebaseService.searchCode.
	static async searchCode(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const repo = (req.query.repo as string)?.trim();
				const content = (req.query.content as string)?.trim();

				if (!repo) throw new HttpError(400, "repo query parameter is required", "MISSING_REPO");
				if (!content) throw new HttpError(400, "content query parameter is required", "MISSING_CONTENT");

				const params: Record<string, unknown> = { repo, content };
				if (req.query.regex !== undefined) params.regex = req.query.regex === "true" || req.query.regex === "1";
				if (req.query.language !== undefined) params.language = req.query.language;
				if (req.query.limit !== undefined) params.limit = req.query.limit;
				if (req.query.offset !== undefined) params.offset = req.query.offset;
				if (req.query.repoPath !== undefined) params.repoPath = (req.query.repoPath as string).trim();

				const result = await CodebaseService.searchCode(params);
				assertNoToolError(result as Record<string, unknown>, "CODE_SEARCH_FAILED");
				return result;
			},
			{ onError: onCodebaseError }
		);
	}

	// GET /api/codebase/trace?name=handleCodebaseRead&repo=owner/repo&includeReferences=true
	static async traceSymbol(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const name = (req.query.name as string)?.trim();
				if (!name) throw new HttpError(400, "name query parameter is required", "MISSING_NAME");

				const result = await CodebaseService.traceSymbol(
					name,
					req.query.repo as string,
					req.query.includeReferences as string
				);

				const data = result as Record<string, unknown>;
				assertNoToolError(
					data,
					"TRACE_FAILED",
					data.disambiguation ? { disambiguation: data.disambiguation } : undefined
				);
				return result;
			},
			{ onError: onCodebaseError }
		);
	}

	// GET/POST /api/codebase/file/content?repo=owner/repo&path=src/main.ts&repoPath=/abs/path
	// Raw file content from disk (bounded to FILE_CONTENT_MAX_LINES), for the
	// FileViewer (TASK-324 CG-B). Path traversal is rejected (PATH_TRAVERSAL).
	static async getFileContent(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const repo = param(req, "repo");
				if (!repo) throw new HttpError(400, "repo query parameter is required", "MISSING_REPO");
				const filePath = param(req, "path");
				if (!filePath) throw new HttpError(400, "path query parameter is required", "MISSING_FILE_PATH");

				return await CodebaseService.readFileContent(repo, filePath, param(req, "repoPath"));
			},
			{ onError: onCodebaseError }
		);
	}

	// GET /api/codebase/symbol/callers?repo=owner/repo&name=startServer&kind=call&filePath=src/target.ts
	// Caller/callee pairs for a symbol — CallGraph DAG data (TASK-324 CG-B).
	// Optional filePath disambiguates duplicate symbol names (409 AMBIGUOUS_SYMBOL, TASK-373).
	static async getSymbolCallers(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const repo = param(req, "repo");
				if (!repo) throw new HttpError(400, "repo query parameter is required", "MISSING_REPO");
				const name = param(req, "name");
				if (!name) throw new HttpError(400, "name query parameter is required", "MISSING_NAME");

				return await CodebaseService.symbolCallers(repo, name, param(req, "kind"), param(req, "filePath"));
			},
			{ onError: onCodebaseError }
		);
	}

	// GET /api/codebase/graph?repo=owner/repo&limit=120&kind=call
	// Code-graph nodes/edges for KGGraphCanvas (TASK-324 CG-B). Degree-ranked,
	// edge-capped server-side.
	static async getCodeGraph(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const repo = param(req, "repo");
				if (!repo) throw new HttpError(400, "repo query parameter is required", "MISSING_REPO");

				return await CodebaseService.codeGraph(repo, param(req, "limit"), param(req, "kind"));
			},
			{ onError: onCodebaseError }
		);
	}

	// GET /api/codebase/index-status?repo=owner/repo
	static async getIndexStatus(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const repo = (req.query.repo as string)?.trim();
				if (!repo) throw new HttpError(400, "repo query parameter is required", "MISSING_REPO");

				const result = await CodebaseService.getIndexStatus(repo);
				return result;
			},
			{ onError: onCodebaseError }
		);
	}

	// POST /api/codebase/index
	// Body: { repo, repoPath?, force?, includeGlobs?, excludeGlobs? }
	static async startIndex(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const repo = (req.body.repo as string)?.trim();
				const reqRepoPath = (req.body.repoPath as string)?.trim();

				if (!repo) throw new HttpError(400, "repo is required in body", "MISSING_REPO");
				if (!reqRepoPath) throw new HttpError(400, "repoPath is required in body", "MISSING_REPO_PATH");

				const result = await CodebaseService.startIndex(
					repo,
					reqRepoPath,
					req.body.force as boolean,
					req.body.includeGlobs as string[],
					req.body.excludeGlobs as string[]
				);

				assertNoToolError(result as Record<string, unknown>, "INDEX_FAILED");
				return result;
			},
			{ onError: onCodebaseError }
		);
	}

	// POST /api/codebase/auto-index
	// Body: { repo, repoPath? }
	static async autoIndex(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const repo = (req.body.repo as string)?.trim();
				const reqRepoPath = (req.body.repoPath as string)?.trim();

				if (!repo) throw new HttpError(400, "repo is required in body", "MISSING_REPO");

				const result = await CodebaseService.autoIndex(repo, reqRepoPath);
				return result;
			},
			{ onError: onCodebaseError }
		);
	}
}
