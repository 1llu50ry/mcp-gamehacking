/**
 * memory-read/recap — RECAP mode handler (stats + top memories timeline).
 *
 * Split from memory.read.ts (TASK-555). Auto-inferred when a memory-read call
 * carries neither a query nor an identifier. Public behavior is unchanged:
 *
 *   none of query/id/code/ids/codes → RECAP — repo stats by type (excluding
 *   task_archive), recent memories ordered by importance DESC / created_at
 *   DESC, a by-date text timeline, pointer-table structured content, and
 *   best-effort KG enrichment (json-only). Uses its own limit cap (1-50).
 */

import type { MemoryEntry } from "../../types";
import type { SQLiteStore } from "../../storage/sqlite";
import { createMcpResponse, type McpResponse } from "../../utils/mcp-response";
import { logger } from "../../utils/logger";
import type { MemoryReadInput } from "../schemas/index";
import { fetchGatedMemoryKgContext } from "./kg";
import { ackMarker, MEMORY_COLUMNS, memoryPointerRow } from "./shared";

export async function handleRecapMode(params: MemoryReadInput, db: SQLiteStore): Promise<McpResponse> {
	// Recap uses its own limit cap (1-50)
	const recapLimit = Math.min(params.limit, 50);

	logger.info("[Tool] memory.read (recap)", { repo: params.repo, limit: recapLimit, offset: params.offset });

	// Aggregate stats (counts by type)
	const stats = db.memories.getStats(params.owner, params.repo);

	// Total active memories (excluding task_archive)
	const total = db.memories.getTotalCount(params.owner, params.repo, false, ["task_archive"]);

	// Top memories ordered by importance DESC, created_at DESC
	const rows = db.memories.getRecentMemories(params.owner, params.repo, recapLimit, params.offset, false, [
		"task_archive"
	]);

	// by_type excluding task_archive
	const byType: Record<string, number> = {};
	for (const [type, count] of Object.entries(stats.byType)) {
		if (type !== "task_archive") {
			byType[type] = count;
		}
	}

	// Build pointer table
	const topRows = rows.map(memoryPointerRow);

	let contentSummary: string;
	if (total > 0) {
		const parts: string[] = [];

		// Header: total + inline stats
		const statsLine = Object.entries(byType)
			.filter(([, c]) => c > 0)
			.map(([t, c]) => `${t}: ${c}`)
			.join(" · ");
		parts.push(`Memory Timeline — ${total} total${rows.length < total ? ` (showing ${rows.length})` : ""}`);
		// Shared [N] legend (TASK-424): recap reuses the importance scale but is
		// a full by-date timeline (no per-group cap), so the marker differs from
		// search mode's grouped renderer.
		parts.push("> [N] = importance (1–5) · Memory Timeline shows every match by date (no per-group cap)");
		if (statsLine) parts.push(statsLine);
		parts.push("");

		// Timeline grouped by created_at date
		const dateGroups: Map<string, MemoryEntry[]> = new Map();
		const sortedByDate = [...rows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
		for (const row of sortedByDate) {
			const dateKey = row.created_at.split("T")[0];
			const group = dateGroups.get(dateKey);
			if (group) {
				group.push(row);
			} else {
				dateGroups.set(dateKey, [row]);
			}
		}

		for (const [date, entries] of dateGroups) {
			parts.push(date);
			for (const entry of entries) {
				const code = (entry.code || "-").padEnd(8);
				const type = (entry.type || "").padEnd(10);
				parts.push(`  ${code} [${entry.importance}]  ${type}  ${entry.title}${ackMarker(entry)}`);
			}
			parts.push("");
		}

		parts.push("Use memory-read with id (or code) for full content.");
		contentSummary = parts.join("\n").trim();
	} else {
		contentSummary = `No memories found for repo "${params.repo}".`;
	}

	const structuredData: Record<string, unknown> = {
		schema: "memory-read",
		mode: "recap",
		stats: { byType },
		top: {
			columns: [...MEMORY_COLUMNS],
			rows: topRows
		},
		count: rows.length,
		total,
		offset: params.offset,
		limit: recapLimit
	};

	// Best-effort KG context (REFACTOR-KG-003) — gated on `params.json`
	// (audit F3): the payload only ships inside `structuredContent`.
	const kgData = fetchGatedMemoryKgContext(db, params.repo, rows, params.json);
	if (kgData) structuredData.kg = kgData;

	return createMcpResponse(structuredData, contentSummary, {
		contentSummary,
		includeJson: params.json
	});
}
