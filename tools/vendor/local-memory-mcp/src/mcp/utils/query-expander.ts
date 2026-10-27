/**
 * Simple Technical Query Expander
 * Maps common developer terms to synonyms to improve recall.
 */
const TECH_SYNONYMS: Record<string, string[]> = {
	update: ["migrate", "change", "alter", "modify", "patch", "upgrade"],
	database: ["db", "sql", "schema", "persistence", "storage", "sqlite", "postgres"],
	auth: ["login", "security", "token", "session", "permission", "authorization", "authentication", "system"],
	authentication: ["auth", "login", "security", "token", "session", "permission"],
	system: ["architecture", "structure", "design", "security"],
	error: ["bug", "issue", "failure", "mistake", "fix", "exception"],
	ui: ["frontend", "component", "styling", "css", "layout", "view"],
	deploy: ["publish", "release", "ci", "cd", "pipeline"]
};

export function expandQuery(query: string, prompt?: string): string {
	// Combine query and prompt if available
	const baseText = prompt ? `${query} ${prompt}` : query;
	const words = baseText.toLowerCase().split(/\s+/);
	const expansions = new Set<string>(words);

	for (const word of words) {
		// Basic cleaning of common characters
		const cleanWord = word.replace(/[?.!,]/g, "");
		if (TECH_SYNONYMS[cleanWord]) {
			TECH_SYNONYMS[cleanWord].forEach((syn) => expansions.add(syn));
		}
	}

	return Array.from(expansions).join(" ");
}
