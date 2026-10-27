/**
 * memory-read/detail — single or bulk detail by id/code.
 *
 * Handles:
 * - Single memory by `id` or `code`
 * - Bulk memories by `ids[]` or `codes[]`
 *
 * Extracted from memory.read.ts (OPT-DRY-06 / OPT-FLOW-01) so the
 * orchestrator stays under 500 lines; mirrors task-read/detail.ts and
 * standard-read/detail.ts.
 */

import { MemoryEntry } from "../../types";
import { SQLiteStore } from "../../storage/sqlite";
import { createMcpResponse, McpResponse, withEnvelope } from "../../utils/mcp-response";
import { formatDisplayTimestamp } from "../../utils/display-time";
import { UUID_REGEX } from "../../utils/uuid";
import { isMemoryAcknowledged } from "../../utils/memory-utils";
import { fetchKgContext, fetchAggregatedKgContext } from "../kg-archivist/query";
import { MemoryReadInput } from "../schemas/index";

// ── Helpers ─────────────────────────────────────────────────────────────

export function formatMemoryDetail(memory: MemoryEntry, showId?: boolean): string {
	const lines: string[] = [`Code: ${memory.code || "-"}`];
	if (showId) lines.push(`ID: ${memory.id}`);
	lines.push(
		`Title: ${memory.title}`,
		`Type: ${memory.type}`,
		`Importance: ${memory.importance}`,
		`Status: ${memory.status}`,
		`Acknowledged: ${isMemoryAcknowledged(memory) ? "yes" : "no"}`,
		`Tags: ${memory.tags.length > 0 ? memory.tags.join(", ") : "-"}`,
		`Created: ${formatDisplayTimestamp(memory.created_at)}`,
		`Updated: ${formatDisplayTimestamp(memory.updated_at)}`
	);
	if (memory.scope?.repo) lines.push(`Repo: ${memory.scope.repo}`);
	if (memory.scope?.folder) lines.push(`Folder: ${memory.scope.folder}`);
	if (memory.scope?.language) lines.push(`Language: ${memory.scope.language}`);
	if (memory.content) lines.push("", "--- Content ---", memory.content);
	return lines.join("\n");
}

/** Spreads the derived acknowledged flag onto a memory for structured output (TASK-423). */
function withAcknowledged(memory: MemoryEntry): MemoryEntry & { acknowledged: boolean } {
	return { ...memory, acknowledged: isMemoryAcknowledged(memory) };
}

export function formatBulkDetail(memories: MemoryEntry[]): string {
	const SEPARATOR = "━".repeat(44);
	const parts = memories.map((m) => SEPARATOR + "\n" + formatMemoryDetail(m, true));
	return `Bulk detail — ${memories.length} memories\n\n${parts.join("\n")}\n\nUse memory-read with id (or code) for full content.`;
}

// ── Detail handler ──────────────────────────────────────────────────────

export async function handleDetailMode(validated: MemoryReadInput, db: SQLiteStore): Promise<McpResponse> {
	const { id, code, ids, codes, owner, repo } = validated;

	// Bulk detail via ids array
	if (ids !== undefined && ids.length > 0) {
		const memories = db.memories.getByIds(ids);
		const contentSummary = memories.length > 0 ? formatBulkDetail(memories) : "No memories found for given ids.";
		// KG context only ships inside `structuredContent`, so computing it for
		// a text-mode read is pure waste (audit F3).
		const kgContext = validated.json
			? fetchAggregatedKgContext(
					db,
					repo,
					memories.map((m: MemoryEntry) => m.title),
					"memory"
				)
			: null;
		const data: Record<string, unknown> = { memories: memories.map(withAcknowledged) };
		if (kgContext) data.kg = kgContext;
		return createMcpResponse(withEnvelope("memory-read", "detail", data), contentSummary, {
			contentSummary,
			includeJson: validated.json
		});
	}

	// Bulk detail via codes array
	if (codes !== undefined && codes.length > 0) {
		const memories = db.memories.getMemoriesByCodes(codes, owner, repo);
		const contentSummary = memories.length > 0 ? formatBulkDetail(memories) : "No memories found for given codes.";
		const kgContext = validated.json
			? fetchAggregatedKgContext(
					db,
					repo,
					memories.map((m: MemoryEntry) => m.title),
					"memory"
				)
			: null;
		const data: Record<string, unknown> = { memories: memories.map(withAcknowledged) };
		if (kgContext) data.kg = kgContext;
		return createMcpResponse(withEnvelope("memory-read", "detail", data), contentSummary, {
			contentSummary,
			includeJson: validated.json
		});
	}

	// Single detail by id or code. Branch on UUID shape so a code-addressed
	// lookup runs EXACTLY one query (getById for ids, getByCode for codes) —
	// the old `getById(id) ?? getByCode(id, ...)` burned two queries whenever
	// a code was passed through `id` (OPT-FLOW-01). Mirrors the convention in
	// task-read/detail.ts and standard-read/detail.ts.
	let memory: MemoryEntry | null = null;
	if (id) {
		memory = UUID_REGEX.test(id) ? db.memories.getById(id) : db.memories.getByCode(id, owner, repo);
	} else if (code) {
		memory = db.memories.getByCode(code, owner, repo);
	}

	if (!memory) {
		throw new Error(`Memory not found: ${id || code}`);
	}

	const content = formatMemoryDetail(memory);

	const kgContext = validated.json ? fetchKgContext(db, repo, memory.title, "memory") : null;
	const data: Record<string, unknown> = { memory: withAcknowledged(memory) };
	if (kgContext) data.kg = kgContext;

	return createMcpResponse(withEnvelope("memory-read", "detail", data), content, {
		contentSummary: content,
		includeJson: validated.json
	});
}
