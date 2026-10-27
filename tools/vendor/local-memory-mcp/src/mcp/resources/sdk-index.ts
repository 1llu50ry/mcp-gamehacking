import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { SessionContext } from "../session";
import { readResource } from "./index";

/**
 * Registers all resources and resource templates via SDK registerResource().
 *
 * Single-source adapter (TASK-098): every read handler delegates to the shared
 * implementation in `./index` (readResource), so the SDK transport and the
 * legacy test-adapter router (router.ts) serve resources through the SAME
 * code path — no overlapping logic to drift.
 *
 * This is the PRODUCTION registration path (server.ts → mcp-server.ts).
 * `./index` also remains the completion source (completion.ts →
 * completeResourceArgument); the SDK's per-template `complete` callbacks are
 * intentionally not configured here because mcp-server.ts installs a custom
 * `completion/complete` handler that overrides the SDK's built-in one.
 *
 * Static resources:
 *   - repository://index
 *   - session://roots
 *
 * Template resources:
 *   - repository://{name}/memories  (plain; + {?search} / {?type} / {?tag} /
 *     {?limit} / {?offset} / full-query siblings, TASK-442)
 *   - memory://{id}
 *   - repository://{name}/tasks  (plain; + {?status} / {?priority} /
 *     {?limit} / {?offset} / full-query siblings, TASK-442)
 *   - task://{id}
 *   - repository://{name}/summary
 *   - repository://{name}/actions  (plain; + {?limit} / {?offset} /
 *     full-query sibling, TASK-442)
 *   - action://{id}
 *   - codebase://{repo}/symbols  (RS-1/TASK-323)
 *   - codebase://{repo}/symbols{?search,kind,limit}
 *   - codebase://{repo}/symbols{?search} / {?kind} / {?limit} / {?offset}
 *   - codebase://{repo}/symbols/{name}
 *   - codebase://{repo}/files/{+file_path}
 *
 * TASK-442 note: this SDK's UriTemplate treats `{?a,b,c}` as ALL-or-NOTHING —
 * a concrete URI with ZERO or a SUBSET of the listed params matches NO
 * template and answers ResourceNotFound. Every collection with query params
 * therefore registers a plain no-query form PLUS one sibling template per
 * documented param (same pattern the codebase family adopted in TASK-323), so
 * clients like OpenCode that expand templates minimally can actually read them.
 */
export function registerAllResources(
	server: McpServer,
	store: SQLiteStore,
	_vectors: VectorStore,
	session: SessionContext
): void {
	const db = store;

	// Shared read dispatcher: the SDK invokes this with the concrete URI, and
	// readResource (./index) owns the URI → payload mapping for both transports.
	const read = (uri: URL): ReturnType<typeof readResource> => readResource(uri.toString(), db, session);

	// ── Static: Repository Index ──────────────────────────────────────

	server.registerResource(
		"repository-index",
		"repository://index",
		{
			title: "Repository Index",
			description: "All known repos with memory/task counts",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	// ── Static: Session Roots ────────────────────────────────────────

	server.registerResource(
		"session-roots",
		"session://roots",
		{
			title: "Session Roots",
			description: session?.roots?.length
				? "Active workspace roots provided by the MCP client"
				: "No active workspace roots were provided by the MCP client",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	// ── Template: Repository Memories ─────────────────────────────────
	// TASK-442: `{?search,type,tag,limit,offset}` alone matches ONLY the URI
	// with ALL five params (all-or-nothing operator), so the plain form and
	// one sibling per documented param are registered too — otherwise clients
	// reading repository://{name}/memories or ?search=… hit ResourceNotFound.

	server.registerResource(
		"repository-memories",
		new ResourceTemplate("repository://{name}/memories", { list: undefined }),
		{
			title: "Repository Memories",
			description: "Active memory entries for a repo (no filters)",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	server.registerResource(
		"repository-memories-filtered",
		new ResourceTemplate("repository://{name}/memories{?search,type,tag,limit,offset}", { list: undefined }),
		{
			title: "Filtered Repository Memories",
			description: "Filter memories in a repo by keyword, type, or tag",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	server.registerResource(
		"repository-memories-search",
		new ResourceTemplate("repository://{name}/memories{?search}", { list: undefined }),
		{
			title: "Repository Memories by Search",
			description: "Filter memories in a repo by keyword",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	server.registerResource(
		"repository-memories-type",
		new ResourceTemplate("repository://{name}/memories{?type}", { list: undefined }),
		{
			title: "Repository Memories by Type",
			description: "Filter memories in a repo by memory type",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	server.registerResource(
		"repository-memories-tag",
		new ResourceTemplate("repository://{name}/memories{?tag}", { list: undefined }),
		{
			title: "Repository Memories by Tag",
			description: "Filter memories in a repo by tag",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	server.registerResource(
		"repository-memories-limit",
		new ResourceTemplate("repository://{name}/memories{?limit}", { list: undefined }),
		{
			title: "Repository Memories with Page Size",
			description: "Page the memory list with an explicit page size",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	server.registerResource(
		"repository-memories-offset",
		new ResourceTemplate("repository://{name}/memories{?offset}", { list: undefined }),
		{
			title: "Repository Memories with Pagination Offset",
			description: "Page the memory list by offset",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	// ── Template: Memory Detail ───────────────────────────────────────

	server.registerResource(
		"memory-detail",
		new ResourceTemplate("memory://{id}", { list: undefined }),
		{
			title: "Memory Detail",
			description: "Full content and stats for a memory UUID",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	// ── Template: Repository Tasks ────────────────────────────────────
	// TASK-442: plain + per-param siblings (see Repository Memories note).

	server.registerResource(
		"repository-tasks",
		new ResourceTemplate("repository://{name}/tasks", { list: undefined }),
		{
			title: "Repository Tasks",
			description: "Active tasks for a repo (no filters)",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	server.registerResource(
		"repository-tasks-filtered",
		new ResourceTemplate("repository://{name}/tasks{?status,priority,limit,offset}", { list: undefined }),
		{
			title: "Filtered Repository Tasks",
			description: "Filter tasks in a repo by status or priority",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	server.registerResource(
		"repository-tasks-status",
		new ResourceTemplate("repository://{name}/tasks{?status}", { list: undefined }),
		{
			title: "Repository Tasks by Status",
			description: "Filter tasks in a repo by status",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	server.registerResource(
		"repository-tasks-priority",
		new ResourceTemplate("repository://{name}/tasks{?priority}", { list: undefined }),
		{
			title: "Repository Tasks by Priority",
			description: "Filter tasks in a repo by priority",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	server.registerResource(
		"repository-tasks-limit",
		new ResourceTemplate("repository://{name}/tasks{?limit}", { list: undefined }),
		{
			title: "Repository Tasks with Page Size",
			description: "Page the task list with an explicit page size",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	server.registerResource(
		"repository-tasks-offset",
		new ResourceTemplate("repository://{name}/tasks{?offset}", { list: undefined }),
		{
			title: "Repository Tasks with Pagination Offset",
			description: "Page the task list by offset",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	// ── Template: Task Detail ─────────────────────────────────────────

	server.registerResource(
		"task-detail",
		new ResourceTemplate("task://{id}", { list: undefined }),
		{
			title: "Task Detail",
			description: "Full content and comments for a task UUID",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	// ── Template: Repository Summary ──────────────────────────────────

	server.registerResource(
		"repository-summary",
		new ResourceTemplate("repository://{name}/summary", {
			list: undefined
		}),
		{
			title: "Repository Summary",
			description: "Architectural summary for a repo",
			mimeType: "text/plain"
		},
		(uri) => read(uri)
	);

	// ── Template: Repository Actions ─────────────────────────────────
	// TASK-442: plain + per-param siblings (see Repository Memories note).

	server.registerResource(
		"repository-actions",
		new ResourceTemplate("repository://{name}/actions", { list: undefined }),
		{
			title: "Repository Actions",
			description: "Audit log of tool actions for a repo (no filters)",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	server.registerResource(
		"repository-actions-filtered",
		new ResourceTemplate("repository://{name}/actions{?limit,offset}", { list: undefined }),
		{
			title: "Filtered Repository Actions",
			description: "Page the audit log for a repo",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	server.registerResource(
		"repository-actions-limit",
		new ResourceTemplate("repository://{name}/actions{?limit}", { list: undefined }),
		{
			title: "Repository Actions with Page Size",
			description: "Page the audit log with an explicit page size",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	server.registerResource(
		"repository-actions-offset",
		new ResourceTemplate("repository://{name}/actions{?offset}", { list: undefined }),
		{
			title: "Repository Actions with Pagination Offset",
			description: "Page the audit log by offset",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	// ── Template: Action Detail ───────────────────────────────────────

	server.registerResource(
		"action-detail",
		new ResourceTemplate("action://{id}", { list: undefined }),
		{
			title: "Action Detail",
			description: "Full details of an audit log entry",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	// ── Template: Codebase Symbols (list, no query) ────────────────────
	// RS-1/TASK-323 — serves reads WITHOUT query params. This SDK's
	// UriTemplate requires ALL listed `{?...}` params to dispatch, so the
	// plain and full-query forms are registered as separate templates.

	server.registerResource(
		"codebase-symbols",
		new ResourceTemplate("codebase://{repo}/symbols", { list: undefined }),
		{
			title: "Codebase Symbols",
			description: "Indexed symbol records for a repo",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	// ── Template: Codebase Symbols (filtered, full query) ──────────────

	server.registerResource(
		"codebase-symbols-filtered",
		new ResourceTemplate("codebase://{repo}/symbols{?search,kind,limit}", { list: undefined }),
		{
			title: "Filtered Codebase Symbols",
			description: "Search and filter indexed symbols by keyword or kind",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	// ── Template: Codebase Symbols (single-param siblings) ───────────────
	// The `{?...}` operator above matches ALL listed params or none (anchored
	// ^...$ with `([^&]+)`), so a URI with a SUBSET of params (e.g. ?limit=2),
	// and the pagination params offset/limit, match NO template and fail with
	// transport ResourceNotFound. Each param an agent may use alone gets its
	// own template so partial-query reads reach the dispatcher.

	server.registerResource(
		"codebase-symbols-search",
		new ResourceTemplate("codebase://{repo}/symbols{?search}", { list: undefined }),
		{
			title: "Codebase Symbols by Search",
			description: "Search indexed symbols by keyword",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	server.registerResource(
		"codebase-symbols-kind",
		new ResourceTemplate("codebase://{repo}/symbols{?kind}", { list: undefined }),
		{
			title: "Codebase Symbols by Kind",
			description: "Filter indexed symbols by kind",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	server.registerResource(
		"codebase-symbols-limit",
		new ResourceTemplate("codebase://{repo}/symbols{?limit}", { list: undefined }),
		{
			title: "Codebase Symbols with Page Size",
			description: "Page the symbol list with an explicit page size",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	server.registerResource(
		"codebase-symbols-offset",
		new ResourceTemplate("codebase://{repo}/symbols{?offset}", { list: undefined }),
		{
			title: "Codebase Symbols with Pagination Offset",
			description: "Page the symbol list by offset (follow hasMore pagination)",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	// ── Template: Codebase Symbol Detail (trace) ───────────────────────

	server.registerResource(
		"codebase-symbol",
		new ResourceTemplate("codebase://{repo}/symbols/{name}", { list: undefined }),
		{
			title: "Codebase Symbol Detail",
			description: "Trace payload for one symbol (definition, references, hierarchy)",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);

	// ── Template: Codebase File (landmark) ─────────────────────────────
	// `{+file_path}` (reserved expansion) is the ONLY form in this SDK's
	// UriTemplate that matches multi-segment paths — verified empirically:
	// `{file_path}` / `{file_path*}` capture a single path segment only.

	server.registerResource(
		"codebase-file",
		new ResourceTemplate("codebase://{repo}/files/{+file_path}", { list: undefined }),
		{
			title: "Codebase File",
			description: "Indexed file landmark (meta + symbol list, no content)",
			mimeType: "application/json"
		},
		(uri) => read(uri)
	);
}
