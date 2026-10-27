/**
 * Shared setup for the dashboard codebase API integration tests.
 *
 * Extracted from codebase-api.integration.test.ts (TASK-428) so the per-module
 * suites (index/metadata/search, file-content, symbols/graph) can each live in
 * their own < 500-line file. Each split file imports `startCodebaseServer`
 * plus whichever seed helpers it needs.
 *
 * The `vi.mock("../../dashboard/lib/context", ...)` factory is hoisted to the
 * top of THIS module; because every split file imports from here first, the
 * mock is registered before any route/context module loads — mirroring the
 * original single-file ordering.
 */

import express from "express";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AddressInfo } from "node:net";
import { vi } from "vitest";

// ── Env overrides for bounded payloads (TASK-324) ───────────────────────────
// Read by constants.ts at module load (beforeAll's dynamic route import) —
// must be set before that import runs. Keeps the graph edge-cap and the
// file-content line-cap tests cheap (10 edges / 10 lines instead of the
// production 400 / 2000).
process.env.CODE_GRAPH_MAX_EDGES = "10";
process.env.FILE_CONTENT_MAX_LINES = "10";

// ── Mock context.ts (must be BEFORE any imports that transitively load it) ──

vi.mock("../../dashboard/lib/context", async () => {
	const { SQLiteStore } = await import("../../mcp/storage/sqlite");
	const db = new SQLiteStore(":memory:");

	return {
		db,
		vectors: {
			upsert: vi.fn(),
			remove: vi.fn(),
			search: vi.fn().mockResolvedValue([])
		},
		mcpClient: { start: vi.fn(), stop: vi.fn(), isConnected: vi.fn(() => false), getPendingCount: vi.fn(() => 0) },
		logger: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn()
		},
		startTime: Date.now()
	};
});

// ── Helpers ───────────────────────────────────────────────────────────────

export function createTempTsFile(dir: string, filename: string, content: string): string {
	const filePath = path.join(dir, filename);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
	return filePath;
}

export function createTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "codebase-api-test-"));
}

/**
 * Seed the `callers-repo` fixture used by the symbol-callers describe block:
 * `startServer` (callers-repo/src/target.ts) referenced by `invoke`
 * (callers-repo/src/callers.ts) via one `call` and one `import` row.
 */
export async function seedCallersRepo(): Promise<void> {
	const { db } = await import("../../dashboard/lib/context");

	db.codebaseFiles.upsertFile({
		repo: "callers-repo",
		file_path: "src/target.ts",
		language: "typescript",
		checksum: "ct1",
		lines: 20,
		size_bytes: 200
	});
	db.codebaseFiles.upsertFile({
		repo: "callers-repo",
		file_path: "src/callers.ts",
		language: "typescript",
		checksum: "ct2",
		lines: 30,
		size_bytes: 300
	});

	db.codebaseSymbols.bulkUpsertSymbols([
		{
			id: "sym-start-server",
			repo: "callers-repo",
			file_path: "src/target.ts",
			name: "startServer",
			kind: "Function",
			exported: true,
			default_export: false,
			start_line: 3,
			start_col: 0,
			end_line: 12,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			id: "sym-invoke",
			repo: "callers-repo",
			file_path: "src/callers.ts",
			name: "invoke",
			kind: "Function",
			exported: false,
			default_export: false,
			start_line: 5,
			start_col: 0,
			end_line: 9,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		}
	]);

	db.codebaseReferences.bulkUpsertReferences("callers-repo", [
		{
			repo: "callers-repo",
			symbol_name: "startServer",
			caller_file: "src/callers.ts",
			caller_line: 6,
			caller_name: "invoke",
			kind: "call",
			target_file: "src/target.ts",
			target_symbol_id: "sym-start-server"
		},
		{
			repo: "callers-repo",
			symbol_name: "startServer",
			caller_file: "src/callers.ts",
			caller_line: 7,
			caller_name: "invoke",
			kind: "import",
			target_file: "src/target.ts",
			target_symbol_id: "sym-start-server"
		}
	]);
}

/**
 * Seed the `graph-repo` fixture used by the code-graph describe block:
 * two files, three symbols (Alpha/Beta co-defined in a.ts, Gamma in b.ts),
 * two call reference rows (Beta→Gamma, Gamma→Alpha). Yields exactly
 * 3 edges in default mode: 2 calls + 1 co_defined chain (Alpha→Beta).
 */
export async function seedGraphRepo(): Promise<void> {
	const { db } = await import("../../dashboard/lib/context");

	db.codebaseFiles.upsertFile({
		repo: "graph-repo",
		file_path: "src/a.ts",
		language: "typescript",
		checksum: "graph-a",
		lines: 20,
		size_bytes: 200
	});
	db.codebaseFiles.upsertFile({
		repo: "graph-repo",
		file_path: "src/b.ts",
		language: "typescript",
		checksum: "graph-b",
		lines: 10,
		size_bytes: 100
	});

	db.codebaseSymbols.bulkUpsertSymbols([
		{
			id: "graph-alpha",
			repo: "graph-repo",
			file_path: "src/a.ts",
			name: "Alpha",
			kind: "Function",
			exported: true,
			default_export: false,
			start_line: 1,
			start_col: 0,
			end_line: 10,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			id: "graph-beta",
			repo: "graph-repo",
			file_path: "src/a.ts",
			name: "Beta",
			kind: "Function",
			exported: true,
			default_export: false,
			start_line: 11,
			start_col: 0,
			end_line: 20,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			id: "graph-gamma",
			repo: "graph-repo",
			file_path: "src/b.ts",
			name: "Gamma",
			kind: "Function",
			exported: true,
			default_export: false,
			start_line: 1,
			start_col: 0,
			end_line: 10,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		}
	]);

	db.codebaseReferences.bulkUpsertReferences("graph-repo", [
		{
			repo: "graph-repo",
			symbol_name: "Alpha",
			caller_file: "src/b.ts",
			caller_line: 5,
			caller_name: "Gamma",
			kind: "call",
			target_file: "src/a.ts",
			target_symbol_id: "graph-alpha"
		},
		{
			repo: "graph-repo",
			symbol_name: "Gamma",
			caller_file: "src/a.ts",
			caller_line: 15,
			caller_name: "Beta",
			kind: "call",
			target_file: "src/b.ts",
			target_symbol_id: "graph-gamma"
		}
	]);
}

/**
 * Seed the `heritage-repo` fixture for TASK-374: heritage (extends) and
 * module-scope import reference rows carry caller_name=null (the TS emitter
 * hard-codes null — ts-reference-emission.ts / typescript-visitor.ts), so the
 * caller symbol must be resolved by SPAN. Fixture (src/child.ts):
 *   - ChildService class lines 5-30 (top-level), NestedConfig class lines
 *     7-10 (parent ChildService);
 *   - an extends row at caller_line 7 — contained by BOTH ChildService and
 *     NestedConfig, so the INNERMOST (NestedConfig) must win;
 *   - a module-scope import row at caller_line 2 — above every symbol span,
 *     so it falls back to the file's first top-level symbol (ChildService).
 */
export async function seedHeritageRepo(): Promise<void> {
	const { db } = await import("../../dashboard/lib/context");

	db.codebaseFiles.upsertFile({
		repo: "heritage-repo",
		file_path: "src/base.ts",
		language: "typescript",
		checksum: "her-base",
		lines: 12,
		size_bytes: 200
	});
	db.codebaseFiles.upsertFile({
		repo: "heritage-repo",
		file_path: "src/logger.ts",
		language: "typescript",
		checksum: "her-logger",
		lines: 6,
		size_bytes: 100
	});
	db.codebaseFiles.upsertFile({
		repo: "heritage-repo",
		file_path: "src/child.ts",
		language: "typescript",
		checksum: "her-child",
		lines: 30,
		size_bytes: 400
	});

	db.codebaseSymbols.bulkUpsertSymbols([
		{
			id: "her-base",
			repo: "heritage-repo",
			file_path: "src/base.ts",
			name: "BaseService",
			kind: "Class",
			exported: true,
			default_export: false,
			start_line: 1,
			start_col: 0,
			end_line: 12,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			id: "her-logger",
			repo: "heritage-repo",
			file_path: "src/logger.ts",
			name: "Logger",
			kind: "Function",
			exported: true,
			default_export: false,
			start_line: 1,
			start_col: 0,
			end_line: 6,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			id: "her-child",
			repo: "heritage-repo",
			file_path: "src/child.ts",
			name: "ChildService",
			kind: "Class",
			exported: true,
			default_export: false,
			start_line: 5,
			start_col: 0,
			end_line: 30,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			id: "her-nested",
			repo: "heritage-repo",
			file_path: "src/child.ts",
			name: "NestedConfig",
			kind: "Class",
			exported: false,
			default_export: false,
			start_line: 7,
			start_col: 2,
			end_line: 10,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: "her-child"
		}
	]);

	db.codebaseReferences.bulkUpsertReferences("heritage-repo", [
		// Heritage row: caller_name null, caller_line 7 inside BOTH ChildService
		// (5-30) and NestedConfig (7-10) — the innermost span must win.
		{
			repo: "heritage-repo",
			symbol_name: "BaseService",
			caller_file: "src/child.ts",
			caller_line: 7,
			caller_name: null,
			kind: "extends",
			target_file: "src/base.ts",
			target_symbol_id: "her-base"
		},
		// Module-scope import row: caller_name null, caller_line 2 above every
		// symbol span → top-level fallback → ChildService.
		{
			repo: "heritage-repo",
			symbol_name: "Logger",
			caller_file: "src/child.ts",
			caller_line: 2,
			caller_name: null,
			kind: "import",
			target_file: "src/logger.ts",
			target_symbol_id: "her-logger"
		}
	]);
}

/**
 * Seed the `dup-repo` fixture for TASK-373: the name `handleInit` exists in
 * TWO files (src/a.ts + src/b.ts), with one call row targeting each
 * definition. Before the fix getSymbolCallers silently picked matches[0]
 * (src/a.ts by file_path ordering) — now it must 409 without filePath and
 * scope cleanly (symbol AND pairs) with it.
 */
export async function seedDuplicateRepo(): Promise<void> {
	const { db } = await import("../../dashboard/lib/context");

	db.codebaseFiles.upsertFile({
		repo: "dup-repo",
		file_path: "src/a.ts",
		language: "typescript",
		checksum: "dup-a",
		lines: 10,
		size_bytes: 100
	});
	db.codebaseFiles.upsertFile({
		repo: "dup-repo",
		file_path: "src/b.ts",
		language: "typescript",
		checksum: "dup-b",
		lines: 10,
		size_bytes: 100
	});
	db.codebaseFiles.upsertFile({
		repo: "dup-repo",
		file_path: "src/callers.ts",
		language: "typescript",
		checksum: "dup-c",
		lines: 20,
		size_bytes: 200
	});

	db.codebaseSymbols.bulkUpsertSymbols([
		{
			id: "dup-init-a",
			repo: "dup-repo",
			file_path: "src/a.ts",
			name: "handleInit",
			kind: "Function",
			exported: true,
			default_export: false,
			start_line: 1,
			start_col: 0,
			end_line: 10,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			id: "dup-init-b",
			repo: "dup-repo",
			file_path: "src/b.ts",
			name: "handleInit",
			kind: "Function",
			exported: true,
			default_export: false,
			start_line: 1,
			start_col: 0,
			end_line: 10,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			id: "dup-run",
			repo: "dup-repo",
			file_path: "src/callers.ts",
			name: "run",
			kind: "Function",
			exported: false,
			default_export: false,
			start_line: 1,
			start_col: 0,
			end_line: 20,
			end_col: 1,
			signature: null,
			doc_comment: null,
			parent_symbol_id: null
		}
	]);

	db.codebaseReferences.bulkUpsertReferences("dup-repo", [
		{
			repo: "dup-repo",
			symbol_name: "handleInit",
			caller_file: "src/callers.ts",
			caller_line: 3,
			caller_name: "run",
			kind: "call",
			target_file: "src/a.ts",
			target_symbol_id: "dup-init-a"
		},
		{
			repo: "dup-repo",
			symbol_name: "handleInit",
			caller_file: "src/callers.ts",
			caller_line: 6,
			caller_name: "run",
			kind: "call",
			target_file: "src/b.ts",
			target_symbol_id: "dup-init-b"
		}
	]);
}

// ── Server factory ─────────────────────────────────────────────────────────

export interface CodebaseServer {
	baseUrl: string;
	close: () => Promise<void>;
}

/**
 * Spin up an isolated express app mounting the codebase routes against the
 * mocked in-memory context. Returns the base URL and a close handle; call the
 * latter in `afterAll`. Each split file owns its own server + store.
 */
export async function startCodebaseServer(): Promise<CodebaseServer> {
	const codebaseRoutes = (await import("../../dashboard/routes/codebase.routes")).default;
	const app = express();
	app.use(express.json());
	app.use("/api/codebase", codebaseRoutes);
	const server = app.listen(0);
	const { port } = server.address() as AddressInfo;
	const baseUrl = `http://127.0.0.1:${port}`;
	return {
		baseUrl,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()));
			})
	};
}
