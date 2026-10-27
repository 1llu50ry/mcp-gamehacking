/**
 * Shared helpers for the MCP resource surface (TASK-558 split).
 *
 * Envelope/pagination/error helpers extracted from resources/index.ts so the
 * per-domain modules (catalog listing, read dispatcher) stay under the 500-LOC
 * bound. Pure functions — no resource state.
 */

import { decodeCursor, encodeCursor } from "../utils/pagination";

/**
 * One resource content item of the MCP read envelope.
 *
 * Declared as a type alias (not an interface) so the SDK's read callback type
 * (`ReadResourceResult` carries an `[x: string]: unknown` index signature)
 * accepts it — interfaces do not get implicit index signatures.
 */
export type ResourceContent = {
	uri: string;
	mimeType: string;
	text: string;
	size: number;
	annotations: {
		audience: string[];
		priority: number;
		lastModified: string;
	};
};

/** The MCP resource.read envelope returned by readResource and its dispatchers. */
export type ResourceReadResult = {
	contents: ResourceContent[];
};

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * Parses a `repository://{name}/{path}[?query]` URI.
 * Returns null if the URI doesn't match the pattern.
 */
export function parseRepoUri(uri: string): { name: string; path: string; query: URLSearchParams } | null {
	const prefix = "repository://";
	if (!uri.startsWith(prefix)) return null;

	const rest = uri.slice(prefix.length);
	const queryStart = rest.indexOf("?");
	const withoutQuery = queryStart === -1 ? rest : rest.slice(0, queryStart);
	const queryString = queryStart === -1 ? "" : rest.slice(queryStart + 1);

	const slashIdx = withoutQuery.indexOf("/");
	if (slashIdx === -1) return null; // must have at least one slash

	const name = withoutQuery.slice(0, slashIdx);
	const path = withoutQuery.slice(slashIdx + 1);

	if (!name || !path) return null;

	return { name, path, query: new URLSearchParams(queryString) };
}

export function paginateEntries<T extends object>(
	key: "resources" | "resourceTemplates",
	entries: T[],
	params?: { cursor?: string; limit?: number }
) {
	const limit = normalizeLimit(params?.limit);
	const offset = decodeCursor(params?.cursor);
	const sliced = entries.slice(offset, offset + limit);
	const nextOffset = offset + sliced.length;

	return {
		[key]: sliced,
		nextCursor: nextOffset < entries.length ? encodeCursor(nextOffset) : undefined
	};
}

function normalizeLimit(limit: unknown) {
	if (typeof limit !== "number" || !Number.isFinite(limit)) {
		return DEFAULT_PAGE_SIZE;
	}

	return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(limit)));
}

export function deriveLastModifiedFromCollection(values: Array<string | undefined | null>) {
	const normalized = values.filter((value): value is string => typeof value === "string" && value.length > 0);
	return normalized.sort().at(-1) ?? new Date().toISOString();
}

export function resourceNotFound(message: string, uri: string) {
	const error = new Error(message) as Error & { code: number; data?: Record<string, unknown> };
	error.code = -32002;
	error.data = { uri };
	return error;
}

export function invalidCompletionParams(message: string) {
	const error = new Error(message) as Error & { code: number };
	error.code = -32602;
	return error;
}
