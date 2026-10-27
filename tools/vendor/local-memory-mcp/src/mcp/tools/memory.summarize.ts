import { MemorySummarizeSchema } from "./schemas/index";
import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";

export async function handleMemorySummarize(params: Record<string, unknown>, db: SQLiteStore): Promise<McpResponse> {
	const validated = MemorySummarizeSchema.parse(params);

	const summary = validated.signals.join("\n- ");
	const fullSummary = `Project summary:\n- ${summary}`;

	db.summaries.upsertSummary(validated.owner!, validated.repo, fullSummary);

	const content = `Updated summary for repo "${validated.repo}" with ${validated.signals.length} signals:\n\n${fullSummary}`;

	return createMcpResponse(
		{
			repo: validated.repo,
			signals: validated.signals,
			signalCount: validated.signals.length,
			owner: validated.owner
		},
		content,
		{
			contentSummary: content,
			includeJson: validated.json
		}
	);
}
