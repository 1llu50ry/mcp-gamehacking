import { z } from "zod";

const McpAnnotationsSchema = z
	.object({
		audience: z.array(z.enum(["user", "assistant"])).optional(),
		priority: z.number().min(0).max(1).optional(),
		lastModified: z.string().optional()
	})
	.strict()
	.optional();

export const McpContentSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("text"),
		text: z.string(),
		annotations: McpAnnotationsSchema
	}),
	z.object({
		type: z.literal("image"),
		data: z.string(),
		mimeType: z.string(),
		annotations: McpAnnotationsSchema
	}),
	z.object({
		type: z.literal("resource"),
		resource: z.object({
			uri: z.string(),
			mimeType: z.string().optional(),
			text: z.string().optional(),
			annotations: McpAnnotationsSchema
		})
	})
]);

export type McpContent = z.infer<typeof McpContentSchema>;

export type McpResponse = {
	content?: McpContent[];
	isError?: boolean;
	structuredContent?: unknown;
};

export function createMcpResponse(
	data: unknown,
	summary: string,
	options?: {
		query?: string;
		results?: unknown[];
		structuredContentPathHint?: string;
		contentSummary?: string;
		includeJson?: boolean;
	}
): McpResponse {
	const { structuredContentPathHint, contentSummary, includeJson = false } = options || {};

	// Pruning logic to save tokens for the agent
	let finalData = data;
	if (data && typeof data === "object") {
		if (Array.isArray(data)) {
			// Direct array — prune each item
			finalData = data.map((item: unknown) => pruneMetadata(item as Record<string, unknown>));
		} else {
			// Shallow copy — only top-level keys are deleted/pruned below,
			// so no deep clone is needed. pruneMetadata re-copies each item it touches.
			const copy = { ...(data as Record<string, unknown>) };
			finalData = copy;

			// Prune known memory/task arrays if found in the data structure
			const arrayKeys = ["results", "tasks", "memories", "items"];
			let foundArray = false;

			for (const key of arrayKeys) {
				const value = copy[key];
				if (Array.isArray(value)) {
					copy[key] = value.map((item: unknown) => pruneMetadata(item as Record<string, unknown>));
					foundArray = true;
				}
			}

			// If it's just an object (like a single memory), prune it
			if (!foundArray) {
				finalData = pruneMetadata(copy);
			}
		}
	}

	const content: McpContent[] = [];
	const normalizedContentSummary = contentSummary?.trim();
	const normalizedSummary = summary.trim() || "Request completed.";

	if (normalizedContentSummary) {
		content.push({
			type: "text",
			text: normalizedContentSummary
		});
	} else {
		let text = normalizedSummary;
		const hasStructuredContent =
			finalData != null &&
			typeof finalData === "object" &&
			(Array.isArray(finalData) ? finalData.length > 0 : Object.keys(finalData).length > 0);
		if (includeJson && hasStructuredContent) {
			text += ` ${
				structuredContentPathHint
					? `Read structuredContent.${structuredContentPathHint} for details.`
					: `Read structuredContent for machine-readable results.`
			}`;
		}
		content.push({
			type: "text",
			text
		});
	}

	const response: McpResponse = {
		isError: false
	};

	if (includeJson) {
		response.structuredContent = finalData;
	}

	response.content = content;

	return response;
}

/**
 * Prunes redundant or operational metadata from memory/task objects to save tokens.
 */
function pruneMetadata(item: Record<string, unknown>): Record<string, unknown> {
	if (!item || typeof item !== "object") return item;

	// Shallow copy to avoid mutating original objects (only top-level keys are deleted)
	const pruned = { ...item };

	// Common operational fields to remove from agent context
	const toRemove = [
		"hit_count",
		"recall_count",
		"last_used_at",
		"expires_at",
		"model",
		"recall_rate",
		"vector_version",
		"similarity" // Similarity is useful but adds noise if many results
	];

	for (const field of toRemove) {
		delete pruned[field];
	}

	// If it's a memory, prune scope slightly if redundant?
	// No, keep scope as it defines the repo/context.

	return pruned;
}

export function createTextOnlyResponse(text: string): McpResponse {
	return {
		content: [
			{
				type: "text",
				text
			}
		],
		structuredContent: { text },
		isError: false
	} as McpResponse;
}

/**
 * Options for {@link buildTableResult}.
 */
export type TableResultOptions = {
	/** Optional top-level `schema` discriminator (e.g. "task-read/search"). */
	schema?: string;
	/** Optional stable mode discriminator. */
	mode?: string;
	/**
	 * Optional key under which the `{ columns, rows }` table is nested
	 * (e.g. "results", "tasks", "handoffs", "claims"). When omitted, the
	 * columns/rows are placed at the top level of the envelope.
	 */
	key?: string;
	/** Optional count override. Defaults to `rows.length`. */
	count?: number;
	/** Optional total count (when the request is paginated). */
	total?: number;
	/** Optional pagination offset. */
	offset?: number;
	/** Optional pagination limit. */
	limit?: number;
	/** Optional additional top-level fields merged into the envelope (e.g. `query`). */
	extra?: Record<string, unknown>;
};

/**
 * Builds the shared table envelope scaffold:
 *
 *   `{ schema?, mode?, <key>?: { columns, rows }, count, total?, offset?, limit? }`
 *
 * This encapsulates the `COLUMNS = [...] as const` + `rows.map` +
 * `structuredData = { schema, <kind>: { columns, rows }, count, total, offset, limit }`
 * shape that was previously duplicated verbatim across memory.read,
 * task-read (search/list), standard-read, handoff.read and claim.manage.
 *
 * Column names/order and row mapping are preserved as passed in; `count`
 * defaults to `rows.length`, matching the count semantics of every call site.
 * Returns the same shape as the inline object literals it replaces, so the
 * wire output is behavior-identical.
 */
export function buildTableResult(
	columns: readonly string[],
	rows: readonly unknown[][],
	options: TableResultOptions = {}
): Record<string, unknown> {
	const { schema, mode, key, count = rows.length, total, offset, limit, extra } = options;

	const table = { columns: [...columns], rows };
	const result: Record<string, unknown> = {};

	if (schema !== undefined) {
		result.schema = schema;
	}
	if (mode !== undefined) {
		result.mode = mode;
	}
	if (extra) {
		Object.assign(result, extra);
	}
	if (key) {
		result[key] = table;
	} else {
		result.columns = table.columns;
		result.rows = table.rows;
	}
	result.count = count;
	if (total !== undefined) result.total = total;
	if (offset !== undefined) result.offset = offset;
	if (limit !== undefined) result.limit = limit;

	return result;
}

/**
 * Prepends the two stable envelope discriminators to an existing structured
 * payload without renaming or duplicating any field (issue #99).
 *
 * `schema` identifies the producing tool, `mode` the auto-inferred branch, so a
 * client can dispatch on `(schema, mode)` instead of probing for domain keys
 * (`memory` vs `standard` vs a flattened task). Every legacy key is preserved
 * verbatim at its current path, so no compatibility alias is required — the
 * envelope only grows.
 *
 * Deliberately does NOT mirror the payload under a generic `item`/`items` key:
 * `structuredContent` is billed to the agent's context window, and duplicating
 * a full object to satisfy a shape convention would regress the token budget
 * this issue is meant to protect.
 */
export function withEnvelope<T extends object>(
	schema: string,
	mode: string,
	data: T
): T & { schema: string; mode: string } {
	return { schema, mode, ...data };
}

export function getPrimaryTextContent(response: McpResponse): string {
	if (!Array.isArray(response.content)) return "";
	const textItem = response.content.find((item) => item.type === "text");
	return textItem?.type === "text" ? textItem.text : "";
}

export function isMcpResponse(obj: unknown): obj is McpResponse {
	if (typeof obj !== "object" || obj === null) return false;
	const response = obj as Record<string, unknown>;
	if (!Array.isArray(response.content)) return false;
	return response.content.every(
		(item) => typeof item === "object" && item !== null && "type" in item && typeof item.type === "string"
	);
}
