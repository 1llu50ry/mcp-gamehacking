export const TYPE_COLORS: Record<string, string> = {
	person: "#22c55e",
	place: "#3b82f6",
	organization: "#f97316",
	concept: "#a855f7",
	unknown: "#6b7280"
};

export function getTypeColor(type: string): string {
	return TYPE_COLORS[type?.toLowerCase()] ?? TYPE_COLORS.unknown;
}

export function formatTimestamp(ts: string): string {
	if (!ts) return "";
	try {
		const d = new Date(ts);
		return d.toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit"
		});
	} catch {
		return ts;
	}
}

/**
 * Minimal shape of a KG entity payload rendered by the dashboard detail views.
 * Extra fields from the API are preserved via the index signature.
 */
export interface KgEntityDetail {
	name: string;
	type?: string;
	description?: string | null;
	created_at?: string;
	updated_at?: string;
	[key: string]: unknown;
}
