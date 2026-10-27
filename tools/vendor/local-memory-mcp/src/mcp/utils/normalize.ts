// Normalization layer for text processing
// Requirements: 4.1, 5.1, 17.4
import { STOPWORDS } from "./stopwords";

export { STOPWORDS };

export function normalize(text: string): string {
	return (
		text
			.toLowerCase()
			// Keep alphanumeric, spaces, and tech-friendly symbols (underscore, hyphen, dot)
			.replace(/[^a-z0-9\s_\-.]/g, " ")
			.replace(/\s+/g, " ")
			.trim()
	);
}

export function parseRepoInput(repo: string, owner?: string): { owner: string; repo: string } {
	if (!repo) return { owner: "", repo: "" };
	if (owner) return { owner: owner.trim(), repo: repo.trim() };
	const parts = repo.split("/");
	if (parts.length > 1) {
		return { owner: parts[0].trim(), repo: parts.slice(1).join("/").trim() };
	}
	return { owner: "", repo: parts[0].trim() };
}

/**
 * Normalizes a repository name by removing common owner/ prefixes (e.g. 'vheins/repo' -> 'repo').
 * This prevents agents from accidentally using full GitHub paths as repo IDs.
 */
export function normalizeRepo(repo: string): string {
	if (!repo) return "";

	// Guard: detect JSON-stringified scope objects that would corrupt the DB.
	// This catches cases where an MCP client passes scope as a JSON string
	// like '{"owner":"vheins","repo":"local-memory-mcp"}' instead of a proper
	// { owner, repo } object. The normalizeToolArgs() function should have
	// caught this earlier, but this is a defense-in-depth measure.
	if (repo.startsWith("{") && repo.endsWith("}")) {
		try {
			const parsed = JSON.parse(repo);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.repo) {
				return String(parsed.repo).trim();
			}
		} catch {
			// Not valid JSON — not a corrupted scope, continue with normal normalization
		}
	}

	const parts = repo.split("/");
	// Return the last part (the repository name itself)
	return parts[parts.length - 1].trim();
}

export function tokenize(text: string): string[] {
	return normalize(text)
		.split(" ")
		.filter((token) => token.length > 0 && !STOPWORDS.has(token));
}
