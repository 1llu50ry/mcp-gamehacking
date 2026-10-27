/**
 * Utility helpers — functions and a type.
 */

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^\w-]+/g, "");
}

export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function safeParseJSON<T>(json: string): Result<T> {
	try {
		return { ok: true, value: JSON.parse(json) as T };
	} catch (e) {
		return { ok: false, error: String(e) };
	}
}

export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
