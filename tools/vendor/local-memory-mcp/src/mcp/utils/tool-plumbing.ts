// ── Shared tool plumbing ──────────────────────────────────────────────────
// Single source of truth for the write-tool set, resource-mutation URI
// derivation, and page-limit normalization.
//
// Consumed by BOTH dispatch paths so they cannot drift:
//   - router.ts        (MCP protocol router — thin test adapter)
//   - tools/index.ts   (native MCP SDK tool registration — production)
//
// Keep this file free of store/vector dependencies: it is pure logic shared
// by two transports.

/**
 * Tools that mutate the DB — must run under write lock.
 *
 * NOTE: "codebase-index" is intentionally NOT a WRITE_TOOL (TASK-007).
 * The full index run (file discovery + tree-sitter parse) is heavy CPU work
 * that must not hold the file lock. indexing-writer.ts acquires the lock
 * per DB batch (with retry/backoff) instead, keeping lock hold time minimal.
 */
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
	// Canonical memory tools
	"memory-write",
	"memory-delete",
	// Summarize tools
	"repo-summarize",
	// Handoff & Claim
	"handoff-write",
	"claim-manage",
	// Standards
	"standard-write",
	"standard-delete",
	// Tasks
	"task-write",
	"task-delete",
	"observation-write"
]);

/**
 * Tools whose calls emit an action_log row (OPT-PERF-05).
 *
 * Derived from WRITE_TOOLS (the canonical mutation-tool set above) plus
 * "codebase-index" — an explicit mutation that is deliberately excluded from
 * WRITE_TOOLS for lock reasons (TASK-007) but still warrants an audit row.
 *
 * Read-only tools (memory-read, task-read, standard-read, handoff-read,
 * codebase-read, agent-context, synthesize, ...) are NOT included: persisting
 * a row per read is the hot-path write-amplification this set exists to
 * prevent. "claim-manage" is included because it is mutation-capable
 * (CLAIM/RELEASE); its read-only LIST modes are further skipped inside
 * logToolAction (TASK-162 mode gate — args without task_id/task_code and
 * without release:true are pure reads).
 *
 * Both dispatch transports (tools/index.ts, router.ts) gate through
 * logToolAction (utils/action-log.ts), which consults this set.
 */
export const ACTION_LOG_TOOLS: ReadonlySet<string> = new Set([...WRITE_TOOLS, "codebase-index"]);

/**
 * Derives the set of resource URIs affected by a tool call, used to notify
 * clients via `notifications/resources/updated` after mutations.
 *
 * Both transports call this with the same normalized args + handler result so
 * resource invalidation stays consistent regardless of dispatch path.
 *
 * CRITICAL (OPT-DRY-08): handlers return a `McpResponse`, which exposes
 * `structuredContent` — the field `createMcpResponse` sets ONLY when the
 * handler passed `includeJson: true` (utils/mcp-response.ts:117-119). The
 * previous readers here used `res.structuredData`/`res.data`, keys a
 * `McpResponse` never has, so task:// and memory:// URIs (and response-derived
 * repos) silently no-opped on the SDK path. Keep reading `structuredContent`,
 * and handle its absence gracefully (no `includeJson` → no response-derived
 * URIs, never throw) — the args-driven collection/index URIs still apply.
 *
 * ENTITY-AWARE ID ROUTING (mirrors extractActionLog, utils/action-log.ts
 * TASK-155): the domain is derived from the toolName prefix and a generic
 * top-level `structuredContent.id` maps ONLY to its own domain's URI — memory
 * tools (memory-*) populate `memory://`, task tools (task-*) populate
 * `task://`, nothing else does. Domain-qualified keys always map to their own
 * URI: `memory.id` / `memories` → `memory://`; `task.id` / `tasks` /
 * `results` → `task://`. Task codes (`.task_code`) are intentionally NOT
 * mapped: the `task://{id}` resource template (resources/index.ts) resolves
 * exactly 36-char UUIDs, so a code like "OPT-..." can never be a valid task
 * resource URI (the same guard the old code applied to args ids).
 *
 * Pure and never throws: `result` is `unknown` and may be any scaffolded
 * shape — malformed payloads degrade to no URIs, not exceptions.
 */
export function collectAffectedResourceUris(
	toolName: string,
	args: Record<string, unknown>,
	result: unknown
): string[] {
	const structuredContent = ((result as Record<string, unknown> | undefined)?.structuredContent ?? undefined) as
		| Record<string, unknown>
		| undefined;

	const repo =
		(args?.repo as string) ||
		((args?.scope as Record<string, unknown>)?.repo as string) ||
		(structuredContent?.repo as string) ||
		((structuredContent?.scope as Record<string, unknown>)?.repo as string);

	const uris = new Set<string>();

	const touchesMemory = toolName.startsWith("memory-") || toolName === "task-write" || toolName === "task-delete";
	const touchesTasks = toolName.startsWith("task-");

	if (touchesMemory && repo) {
		uris.add(`repository://${encodeURIComponent(repo)}/memories`);
	}

	if (touchesTasks && repo) {
		uris.add(`repository://${encodeURIComponent(repo)}/tasks`);
	}

	if (repo) {
		uris.add("repository://index");
	}

	const domain = toolName.split("-")[0];
	const isMemoryDomain = domain === "memory";
	const isTaskDomain = domain === "task";

	const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);

	const add = (prefix: "memory" | "task", id: unknown): void => {
		if (isUuid(id)) uris.add(`${prefix}://${id}`);
	};

	// Extract ids from a buildTableResult envelope ({ columns, rows }) — either
	// nested under `key` (task-read list/search, ...) or at the top level
	// (memory.read search/recap omit the key). The id column is located by name
	// so column order can never drift the extraction.
	const addTableIds = (prefix: "memory" | "task", key?: string): void => {
		const table = (key ? structuredContent?.[key] : structuredContent) as
			| { columns?: unknown; rows?: unknown }
			| undefined;
		if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return;
		const idIndex = table.columns.indexOf("id");
		if (idIndex === -1) return;
		for (const row of table.rows) {
			if (Array.isArray(row)) add(prefix, row[idIndex]);
		}
	};

	// Args carry ids on direct mutation tools (create/update/delete).
	// One-direction routing (mirrors TASK-157): `args.id` maps only to the
	// tool's own domain URI; qualified `memory_id` / `task_id` always map to
	// their own URI.
	if (isMemoryDomain) {
		add("memory", args?.id ?? args?.memory_id);
	}
	if (isTaskDomain) {
		add("task", args?.id ?? args?.task_id);
	}

	// Response-derived ids (structuredContent). Each block runs only for its
	// own domain so a cross-domain id can never leak into the wrong URI.
	if (isMemoryDomain && structuredContent) {
		// memory-read/detail (single): { memory: { id } }
		add("memory", (structuredContent.memory as Record<string, unknown> | undefined)?.id);
		// memory-write create/update/ack: { id, ... } — generic id → memory.
		add("memory", structuredContent.id);
		// memory-write/bulk + memory-read/detail (bulk): results/memories arrays
		// of { id, ... } entries.
		for (const listKey of ["results", "memories"] as const) {
			const list = structuredContent[listKey];
			if (Array.isArray(list)) {
				for (const item of list as unknown[]) {
					add("memory", (item as Record<string, unknown> | undefined)?.id);
				}
			}
		}
		// memory.read search/recap: buildTableResult envelope — top level or
		// nested under "memories".
		addTableIds("memory");
		addTableIds("memory", "memories");
	}

	if (isTaskDomain && structuredContent) {
		add("task", (structuredContent.task as Record<string, unknown> | undefined)?.id);
		// task-write create/update + task-read/detail: { id, ... } / { ...task }.
		add("task", structuredContent.id);
		// task-write/bulk: results: [{ id, ... }]
		if (Array.isArray(structuredContent.results)) {
			for (const item of structuredContent.results as unknown[]) {
				add("task", (item as Record<string, unknown> | undefined)?.id);
			}
		}
		// task-read/detail (bulk, ids[]/codes[] args): tasks is an ARRAY of full
		// task objects ({ ...task, comments, children, depended_by }), not a
		// { columns, rows } envelope — mirror the memory-side array handling
		// (memories). Safe: task-read/list's `tasks` is an envelope object, so
		// Array.isArray is false → no-op here; the array is captured.
		if (Array.isArray(structuredContent.tasks)) {
			for (const item of structuredContent.tasks as unknown[]) {
				add("task", (item as Record<string, unknown> | undefined)?.id);
			}
		}
		// task-read/list: keyed "tasks"; task-read/search: keyed "results".
		addTableIds("task", "tasks");
		addTableIds("task", "results");
	}

	return [...uris];
}

/**
 * Normalizes a list/tool pagination `limit` argument.
 *
 * Falls back to `fallback` for missing/invalid values, clamps to [1, 100],
 * and coerces to an integer.
 */
export function normalizePageLimit(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		return Math.max(1, fallback);
	}

	return Math.min(value, 100);
}
