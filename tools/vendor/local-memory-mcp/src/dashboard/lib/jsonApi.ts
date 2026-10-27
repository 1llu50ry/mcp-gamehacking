import express from "express";
import { db } from "./context";

/**
 * HTTP error carrying an explicit status (and optional machine-readable code /
 * extra payload) so controllers can signal 4xx/5xx by throwing instead of
 * hand-rolling catch blocks. `handleController` translates it into a
 * JSON:API error response (or a custom responder via `onError`).
 */
export class HttpError extends Error {
	readonly status: number;
	readonly code?: string;
	readonly extra?: Record<string, unknown>;

	constructor(status: number, message: string, code?: string, extra?: Record<string, unknown>) {
		super(message);
		this.name = "HttpError";
		this.status = status;
		this.code = code;
		this.extra = extra;
	}
}

/**
 * Service-layer error with HTTP status. Thrown by services to signal
 * business-rule violations (404 not-found, 400 validation, 422 all-failed,
 * etc.) without depending on HTTP types. `handleController` honors the
 * `status` property, preserving the original HTTP status code.
 *
 * Backward-compatible: `handleController` also checks for `HttpError`
 * (which carries `code` and `extra`) so controllers keep using `HttpError`
 * for request-shape validation.
 */
export class ServiceError extends Error {
	readonly status: number;
	readonly code?: string;

	constructor(status: number, message: string, code?: string) {
		super(message);
		this.name = "ServiceError";
		this.status = status;
		this.code = code;
	}
}

export interface PageParams {
	page: number;
	pageSize: number;
	offset: number;
}

export interface ParsePageParamsOptions {
	/** Page size when `pageSize` is missing/invalid. Default 20. */
	defaultPageSize?: number;
	/** Upper clamp for `pageSize`. Default 100. */
	maxPageSize?: number;
}

/**
 * Normalizes dashboard list pagination. Unifies the previously scattered
 * inline parses (MemoriesController used `limit`, others `pageSize`, with
 * per-controller caps 50/100) onto a single `pageSize` query param with a
 * consistent clamp. Invalid/garbage input falls back to `defaultPageSize`.
 */
export function parsePageParams(query: Record<string, unknown>, opts: ParsePageParamsOptions = {}): PageParams {
	const defaultPageSize = opts.defaultPageSize ?? 20;
	const maxPageSize = opts.maxPageSize ?? 100;
	const page = Math.max(1, parseInt(String(query.page ?? ""), 10) || 1);
	const rawSize = parseInt(String(query.pageSize ?? ""), 10);
	const pageSize = Math.min(maxPageSize, Math.max(1, Number.isFinite(rawSize) ? rawSize : defaultPageSize));
	return { page, pageSize, offset: (page - 1) * pageSize };
}

export interface HandleControllerOptions {
	/** Final HTTP status for the returned body (default 200). */
	status?: number;
	/** Run `db.refresh()` before the handler (default true). */
	refresh?: boolean;
	/**
	 * Custom error responder. The default emits a JSON:API error body
	 * (`jsonApiError`) with the thrown status. CodebaseController uses this
	 * to preserve its `{ error, code }` wire contract.
	 */
	onError?: (res: express.Response, err: HttpError) => void;
}

/**
 * Wraps a dashboard controller handler with the standard request lifecycle:
 * `db.refresh()` (unless `refresh: false`) → run handler → send its return
 * value as the response body. The handler signals failures by throwing
 * `HttpError` (404/400/etc.); anything else becomes a 500.
 *
 * Handlers either `return` a body (sent as JSON) or write the response
 * themselves (streaming endpoints) — in the latter case the wrapper respects
 * `res.headersSent`.
 */
export async function handleController(
	req: express.Request,
	res: express.Response,
	fn: (req: express.Request, res: express.Response) => unknown | Promise<unknown>,
	opts: HandleControllerOptions = {}
): Promise<void> {
	const status = opts.status ?? 200;
	const shouldRefresh = opts.refresh ?? true;
	try {
		if (shouldRefresh) await db.refresh();
		const body = await fn(req, res);
		if (!res.headersSent) {
			res.status(status).json(body);
		}
	} catch (err: unknown) {
		let httpErr: HttpError;
		if (err instanceof HttpError) {
			httpErr = err;
		} else if (err instanceof ServiceError) {
			// ServiceError carries the original HTTP status from business logic.
			// Wrap in HttpError so onError callbacks get the full shape.
			httpErr = new HttpError(err.status, err.message, err.code);
		} else {
			httpErr = new HttpError(500, err instanceof Error ? err.message : "Internal server error");
		}
		if (opts.onError) {
			opts.onError(res, httpErr);
			return;
		}
		if (!res.headersSent) {
			res.status(httpErr.status).json(jsonApiError(httpErr.message, httpErr.status));
		} else {
			res.end();
		}
	}
}

export function jsonApiRes(data: unknown, type: string, extra: { meta?: unknown; links?: unknown } = {}) {
	const isArray = Array.isArray(data);
	const dataLayer = isArray
		? (data as Array<Record<string, unknown>>).map((item: Record<string, unknown>) => {
				const { id, ...attributes } = item;
				return { type, id: String(id || "system"), attributes };
			})
		: (() => {
				const { id, ...attributes } = data as Record<string, unknown>;
				return { type, id: String(id || attributes.id || "system"), attributes };
			})();

	return {
		jsonapi: { version: "1.1" },
		data: dataLayer,
		...extra
	};
}

export function jsonApiError(message: string, status: number = 500) {
	return {
		jsonapi: { version: "1.1" },
		errors: [{ status: String(status), detail: message }]
	};
}

export function getAttributes(req: express.Request) {
	return req.body.data?.attributes || req.body;
}
