export const VALID_COLUMNS = new Set([
	"code",
	"type",
	"title",
	"content",
	"importance",
	"agent",
	"role",
	"model",
	"completed_at",
	"expires_at",
	"supersedes",
	"status",
	"hit_count",
	"recall_count",
	"last_used_at"
]);

export function mergeStructuredData(
	metadata: Record<string, unknown>,
	structuredData?: Record<string, unknown>
): Record<string, unknown> {
	return { ...metadata, structuredData: structuredData ?? {} };
}
