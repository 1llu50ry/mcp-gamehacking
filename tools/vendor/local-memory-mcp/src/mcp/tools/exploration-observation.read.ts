import { SQLiteStore } from "../storage/sqlite";
import { buildTableResult, createMcpResponse, type McpResponse, withEnvelope } from "../utils/mcp-response";
import { ExplorationObservationReadSchema } from "./schemas";

export async function handleExplorationObservationRead(
	args: Record<string, unknown>,
	storage: SQLiteStore
): Promise<McpResponse> {
	const validated = ExplorationObservationReadSchema.parse(args);
	if (validated.id) {
		const observation = storage.explorationObservations.getById(
			validated.owner,
			validated.repo,
			validated.id,
			validated.hydrate_evidence
		);
		if (!observation) throw new Error(`Exploration observation not found: ${validated.id}`);
		const summary = `[${observation.id.slice(0, 8)}] ${observation.subject}: ${observation.fact}`;
		return createMcpResponse(withEnvelope("observation-read", "detail", { observation }), summary, {
			contentSummary: summary,
			includeJson: validated.json
		});
	}

	const observations = storage.explorationObservations.list(validated, validated.hydrate_evidence);
	const columns = [
		"id",
		"subject",
		"fact",
		"confidence",
		"freshness",
		"task_id",
		"agent",
		"evidence_count",
		"updated_at",
		...(validated.hydrate_evidence ? ["evidence"] : [])
	];
	const rows = observations.map((item) => [
		item.id,
		item.subject,
		item.fact.length > 320 ? `${item.fact.slice(0, 320)}...` : item.fact,
		item.confidence,
		item.freshness,
		item.task_id,
		item.agent,
		item.evidence_count,
		item.updated_at,
		...(validated.hydrate_evidence ? [item.evidence ?? []] : [])
	]);
	const data = buildTableResult(columns, rows, {
		schema: "observation-read",
		mode: "list",
		key: "observations",
		count: rows.length,
		offset: validated.offset
	});
	const summary = observations.length
		? observations
				.map((item) => {
					const fact = item.fact.length > 240 ? `${item.fact.slice(0, 240)}...` : item.fact;
					return `- [${item.id.slice(0, 8)}] (${item.confidence.toFixed(2)}) ${item.subject}: ${fact}`;
				})
				.join("\n")
		: "No exploration observations found.";
	return createMcpResponse(data, summary, { contentSummary: summary, includeJson: validated.json });
}
