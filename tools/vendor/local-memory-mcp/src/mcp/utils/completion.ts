const MAX_COMPLETION_VALUES = 100;

export function rankCompletionValues(candidates: string[], input: string) {
	const unique = [...new Set(candidates.filter(Boolean))];
	const needle = input.trim().toLowerCase();

	if (!needle) {
		return unique.slice(0, MAX_COMPLETION_VALUES);
	}

	return unique
		.map((value) => ({ value, score: scoreCompletionValue(value, needle) }))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || a.value.localeCompare(b.value))
		.map((entry) => entry.value);
}

function scoreCompletionValue(value: string, needle: string) {
	const haystack = value.toLowerCase();
	if (haystack === needle) return 100;
	if (haystack.startsWith(needle)) return 75;
	if (haystack.includes(needle)) return 50;

	const compactNeedle = needle.replace(/[\s_-]+/g, "");
	const compactHaystack = haystack.replace(/[\s_-]+/g, "");
	if (compactNeedle && compactHaystack.includes(compactNeedle)) return 25;

	return 0;
}
