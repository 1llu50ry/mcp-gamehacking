/**
 * standard-read — orchestrator + re-exports.
 *
 * Auto-infer logic:
 * - `id`/`code`/`ids`/`codes` (non-empty) → DETAIL (single or bulk)
 * - `query` (non-empty)                   → SEARCH (hybrid scoring per SPEC-001)
 * - none                                  → LIST   (paginated list of all standards)
 *
 * DETAIL precedes SEARCH so a non-empty identifier beats a query, and every
 * discriminator uses "non-empty" presence so a serialize-all client sending
 * `query: ""` cannot hijack the mode.
 */

import { StandardReadSchema, StandardReadInput } from "../schemas/index";
import { SQLiteStore } from "../../storage/sqlite";
import { VectorStore } from "../../types";
import { McpResponse, createMcpResponse } from "../../utils/mcp-response";
import { inferReadMode } from "../../utils/auto-infer";
import { fetchAggregatedKgContext } from "../kg-archivist/query";
import { handleSearchMode } from "./search";
import { handleDetailMode } from "./detail";

// Re-export sub-modules for direct access
export { handleDetailMode } from "./detail";
export { handleSearchMode } from "./search";

// ── List columns ────────────────────────────────────────────────────────

const LIST_COLUMNS = ["code", "id", "title", "context", "language", "scope", "tags", "version", "updated_at"] as const;

// ── List handler ─────────────────────────────────────────────────────────

async function handleListMode(validated: StandardReadInput, db: SQLiteStore): Promise<McpResponse> {
	const filterParams: Record<string, unknown> = {};

	if (validated.context) filterParams.context = validated.context;
	if (validated.version) filterParams.version = validated.version;
	if (validated.language) filterParams.language = validated.language;
	if (validated.stack && validated.stack.length > 0) filterParams.stack = validated.stack[0];
	if (validated.tags && validated.tags.length > 0) filterParams.tag = validated.tags[0];
	if (validated.repo) filterParams.repo = validated.repo;
	if (validated.is_global !== undefined) filterParams.is_global = validated.is_global;

	const standards = db.standards.search({
		...filterParams,
		limit: validated.limit,
		offset: validated.offset
	} as Parameters<typeof db.standards.search>[0]);

	const rows = standards.map((s) => [
		s.code ?? "-",
		s.id,
		s.title,
		s.context,
		s.language || "-",
		s.is_global ? "global" : s.repo || "-",
		s.tags.join(", "),
		s.version,
		s.updated_at
	]);

	let contentSummary: string;
	if (standards.length > 0) {
		const parts = ["### Standards", ""];

		// Grouped bullets by language (fallback "-" for null)
		const grouped = new Map<string, typeof standards>();
		const groupOrder: string[] = [];
		for (const s of standards) {
			const lang = s.language || "-";
			if (!grouped.has(lang)) {
				grouped.set(lang, []);
				groupOrder.push(lang);
			}
			grouped.get(lang)!.push(s);
		}

		// Sort group keys: "-" last, others alphabetically
		groupOrder.sort((a, b) => {
			if (a === "-" && b === "-") return 0;
			if (a === "-") return 1;
			if (b === "-") return -1;
			return a.localeCompare(b);
		});

		for (const lang of groupOrder) {
			const items = grouped.get(lang)!;
			parts.push(`**${lang} (${items.length})**`);
			for (const s of items) {
				const scopePart = s.is_global ? "" : ` — ${s.repo || "-"}`;
				parts.push(`- ${s.code ?? "-"} ${s.title} — ${s.context}${scopePart}`);
			}
			parts.push("");
		}

		parts.push("Use standard-read with code for full content.");
		contentSummary = parts.join("\n");
	} else {
		contentSummary = "No coding standards found.";
	}

	const responseData: Record<string, unknown> = {
		schema: "standard-read",
		mode: "list",
		standards: {
			columns: [...LIST_COLUMNS],
			rows
		},
		count: standards.length,
		offset: validated.offset
	};

	// Best-effort KG context (REFACTOR-KG-005) — gated on the json flag
	// (audit F3/F4): `kg` only ships inside `structuredContent`.
	if (validated.json && standards.length > 0) {
		const kgData = fetchAggregatedKgContext(
			db,
			validated.repo ?? "",
			standards.map((s) => s.title),
			"standard"
		);
		if (kgData) responseData.kg = kgData;
	}

	return createMcpResponse(responseData, contentSummary, {
		contentSummary,
		structuredContentPathHint: "standards",
		// Audit F4: was hardcoded `true`, so `standard-read` was the ONE read
		// tool with no way to opt out of the structured payload — the `json`
		// flag it already accepts was silently ignored in list/search mode
		// while detail mode honored it. Now consistent with memory-read,
		// task-read and its own detail branch.
		includeJson: validated.json
	});
}

// ── Main entry point ─────────────────────────────────────────────────────

/**
 * Unified standard-read handler.
 *
 * Auto-infer logic:
 * - `id`/`code`/`ids`/`codes` (non-empty) → DETAIL (single or bulk)
 * - `query` (non-empty)                   → SEARCH (hybrid scoring per SPEC-001)
 * - none                                  → LIST   (paginated list of all standards)
 */
export async function handleStandardRead(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = StandardReadSchema.parse(params);

	// Auto-infer mode via the shared helper (OPT-DRY-06):
	//   id/code/ids/codes → DETAIL · query → SEARCH · none → LIST.
	// DETAIL precedes SEARCH so a non-empty identifier beats a query. Every
	// discriminator uses "non-empty" presence so an explicit empty-string
	// `query: ""` (serialize-all client) is treated as absent, not SEARCH.
	const mode = inferReadMode(validated, {
		rules: [
			{ mode: "detail", fields: ["id", "code", "ids", "codes"], presence: "non-empty" },
			{ mode: "search", fields: ["query"], presence: "non-empty" }
		],
		fallback: "list"
	});

	switch (mode) {
		case "search":
			return handleSearchMode(validated, db, vectors);
		case "detail":
			return handleDetailMode(validated, db);
		default:
			return handleListMode(validated, db);
	}
}
