import { CodingStandardEntry } from "../types";

/**
 * Converts a context string to a URL-safe slug.
 * e.g. "Error Handling" → "error-handling"
 *      "API   Design"   → "api-design"
 */
export function toContextSlug(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function buildStandardVectorText(
	standard: Pick<
		CodingStandardEntry,
		"title" | "content" | "context" | "version" | "language" | "stack" | "tags" | "metadata"
	>
): string {
	return [
		standard.title,
		standard.content,
		standard.context,
		standard.version,
		standard.language ?? "",
		...standard.stack,
		...standard.tags,
		JSON.stringify(standard.metadata)
	]
		.filter(Boolean)
		.join("\n");
}
