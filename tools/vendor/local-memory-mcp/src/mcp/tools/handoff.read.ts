import { SQLiteStore } from "../storage/sqlite";
import { buildTableResult, createMcpResponse, McpResponse, withEnvelope } from "../utils/mcp-response";
import { inferReadMode } from "../utils/auto-infer";
import { HandoffReadSchema } from "./schemas/index";

// ---------------------------------------------------------------------------
// Summary builders
// ---------------------------------------------------------------------------

function buildHandoffListSummary(
	repo: string,
	count: number,
	status?: string,
	fromAgent?: string,
	toAgent?: string,
	sampleHandoffs?: Array<{ id: string; from_agent: string; to_agent: string | null; status: string; summary: string }>
) {
	const parts: string[] = [];
	const header = `Found ${count} handoff${count === 1 ? "" : "s"} in repo "${repo}".`;
	parts.push(header);

	if (sampleHandoffs && sampleHandoffs.length > 0) {
		const lines = sampleHandoffs
			.slice(0, 3)
			.map(
				(h) => `  [${h.id.slice(0, 8)}] ${h.from_agent}→${h.to_agent || "?"} (${h.status}): ${h.summary.slice(0, 60)}`
			);
		parts.push("", ...lines);
		if (count > 3) parts.push(`  ... and ${count - 3} more`);
	}

	if (status) {
		parts.push(`  Status filter: ${status}.`);
	}

	if (fromAgent) {
		parts.push(`  From agent: ${fromAgent}.`);
	}

	if (toAgent) {
		parts.push(`  To agent: ${toAgent}.`);
	}

	return parts.join("\n");
}

function buildClaimListSummary(
	repo: string,
	count: number,
	agent?: string,
	activeOnly?: boolean,
	sampleClaims?: Array<{ id: string; task_id: string; agent: string; status?: string }>
) {
	const parts: string[] = [];
	const header = `Found ${count} claim${count === 1 ? "" : "s"} in repo "${repo}".`;
	parts.push(header);

	if (sampleClaims && sampleClaims.length > 0) {
		const lines = sampleClaims
			.slice(0, 3)
			.map(
				(c) =>
					`  [${c.id.slice(0, 8)}] task=${c.task_id?.slice(0, 8) || "?"} agent=${c.agent} (${c.status || "active"})`
			);
		parts.push("", ...lines);
		if (count > 3) parts.push(`  ... and ${count - 3} more`);
	}

	if (agent) {
		parts.push(`  Agent filter: ${agent}.`);
	}

	if (activeOnly) {
		parts.push("  Showing active claims only.");
	}

	return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

/**
 * DETAIL: Fetch a single handoff by id.
 *
 * FIX-023 — display/lookup consistency: the list view renders the 8-char
 * prefix `[${id.slice(0, 8)}]` (kept: it is compact and matches the short-code
 * convention used across the other read tools). The entity now resolves a
 * unique short prefix back to the full UUID, so an id copied from the list is
 * directly usable here. The detail summary is rendered from the RESOLVED
 * `handoff.id` (not the raw input) so the prefix shown always corresponds to
 * the canonical row, even when a longer prefix or the full UUID was supplied.
 */
function coreDetail(id: string, json: boolean, storage: SQLiteStore): McpResponse {
	const handoff = storage.handoffs.getHandoffById(id);
	if (!handoff) {
		throw new Error(`Handoff not found: ${id}`);
	}

	const excerpt = handoff.summary.length > 60 ? handoff.summary.slice(0, 60) + "..." : handoff.summary;
	const contentSummary = `Handoff [${handoff.id.slice(0, 8)}] "${excerpt}" — ${handoff.from_agent}→${handoff.to_agent || "unassigned"} (${handoff.status})`;

	return createMcpResponse(withEnvelope("handoff-read", "detail", handoff), contentSummary, {
		contentSummary,
		includeJson: json
	});
}

/**
 * LIST CLAIMS: Return claims with optional agent/active_only filters.
 */
function coreListClaims(
	owner: string,
	repo: string,
	agent: string | undefined,
	activeOnly: boolean,
	limit: number,
	offset: number,
	json: boolean,
	storage: SQLiteStore
): McpResponse {
	const claims = storage.handoffs.listClaims({
		owner,
		repo,
		agent,
		active_only: activeOnly,
		limit,
		offset
	});

	const COLUMNS = ["id", "task_id", "task_code", "agent", "role", "claimed_at", "released_at", "metadata"] as const;
	const rows = claims.map((claim) => [
		claim.id,
		claim.task_id,
		claim.task_code ?? null,
		claim.agent,
		claim.role,
		claim.claimed_at,
		claim.released_at,
		claim.metadata
	]);

	const structuredData = buildTableResult(COLUMNS, rows, {
		schema: "claim-list",
		mode: "claims",
		key: "claims",
		count: rows.length,
		offset
	});

	const contentSummary = buildClaimListSummary(repo, rows.length, agent, activeOnly, claims);

	return createMcpResponse(structuredData, contentSummary, {
		contentSummary,
		includeJson: json
	});
}

/**
 * LIST / SEARCH HANDOFFS: Return handoffs with optional status/from_agent/to_agent filters.
 */
function coreListHandoffs(
	owner: string,
	repo: string,
	status: string | undefined,
	fromAgent: string | undefined,
	toAgent: string | undefined,
	limit: number,
	offset: number,
	mode: "list" | "search",
	json: boolean,
	storage: SQLiteStore
): McpResponse {
	const handoffs = storage.handoffs.listHandoffs({
		owner,
		repo,
		status: status as import("../types").Handoff["status"] | undefined,
		from_agent: fromAgent,
		to_agent: toAgent,
		limit,
		offset
	});

	const COLUMNS = [
		"id",
		"from_agent",
		"to_agent",
		"task_id",
		"task_code",
		"status",
		"created_at",
		"updated_at",
		"expires_at",
		"summary",
		"context"
	] as const;
	const rows = handoffs.map((handoff) => [
		handoff.id,
		handoff.from_agent,
		handoff.to_agent,
		handoff.task_id,
		handoff.task_code ?? null,
		handoff.status,
		handoff.created_at,
		handoff.updated_at,
		handoff.expires_at,
		handoff.summary,
		handoff.context
	]);

	const structuredData = buildTableResult(COLUMNS, rows, {
		schema: "handoff-read",
		mode,
		key: "handoffs",
		count: rows.length,
		offset
	});

	const contentSummary = buildHandoffListSummary(repo, rows.length, status, fromAgent, toAgent, handoffs);

	return createMcpResponse(structuredData, contentSummary, {
		contentSummary,
		includeJson: json
	});
}

/**
 * Validates that owner and repo are non-empty, throwing a descriptive error
 * for list/claim modes that require them.
 */
function requireOwnerRepo(owner: string, repo: string): void {
	if (!owner && !repo) {
		throw new Error(
			"owner and repo are required for listing — provide them explicitly or configure MCP workspace roots"
		);
	}
	if (!owner) {
		throw new Error("owner is required for listing — provide it explicitly or configure MCP workspace roots");
	}
	if (!repo) {
		throw new Error("repo is required for listing — provide it explicitly or configure MCP workspace roots");
	}
}

// ---------------------------------------------------------------------------
// Public entry point — auto-infer operation from field presence
// ---------------------------------------------------------------------------

/**
 * Unified handoff read handler. Replaces handoff-list and claim-list.
 *
 * **Auto-infer logic:**
 * - `id` non-empty → **DETAIL** single handoff (no owner/repo needed)
 * - `claim: true` or `agent` present → **LIST CLAIMS** (was claim-list)
 * - `query` non-empty → **SEARCH** handoffs with filters (was handoff-list)
 * - none → **LIST HANDOFFS** (was handoff-list, no filters)
 *
 * `id`/`query` use "non-empty" presence so a serialize-all client sending
 * `id: ""`/`query: ""` does not hijack the mode.
 */
export async function handleHandoffRead(args: unknown, storage: SQLiteStore): Promise<McpResponse> {
	const validated = HandoffReadSchema.parse(args);
	const { id, status, from_agent, to_agent, agent, active_only, limit, offset, owner, repo, json } = validated;

	// ── Auto-infer mode via the shared helper (OPT-DRY-06) ──
	// `claim`/`agent` use truthy presence — `claim` defaults to `false` after
	// schema parse, so "defined" would match on every call. `id`/`query` use
	// "non-empty" presence to match the identifier semantics of the other read
	// tools (an empty string from a serialize-all client is treated as absent).
	const mode = inferReadMode(validated, {
		rules: [
			{ mode: "detail", fields: ["id"], presence: "non-empty" },
			{ mode: "claims", fields: ["claim", "agent"], presence: "truthy" },
			{ mode: "search", fields: ["query"], presence: "non-empty" }
		],
		fallback: "list"
	});

	// ── 1. id present → DETAIL ─────────────────────────────────────
	if (mode === "detail") {
		return coreDetail(id!, json, storage);
	}

	// ── 2. claim:true or agent present → LIST CLAIMS ──────────────
	if (mode === "claims") {
		requireOwnerRepo(owner, repo);
		return coreListClaims(owner, repo, agent ?? undefined, active_only, limit, offset, json, storage);
	}

	// ── 3. query present → SEARCH handoffs ───────────────────────
	if (mode === "search") {
		requireOwnerRepo(owner, repo);
		return coreListHandoffs(owner, repo, status, from_agent, to_agent, limit, offset, "search", json, storage);
	}

	// ── 4. Fallback → LIST HANDOFFS (no filters) ─────────────────
	requireOwnerRepo(owner, repo);
	return coreListHandoffs(owner, repo, status, from_agent, to_agent, limit, offset, "list", json, storage);
}
