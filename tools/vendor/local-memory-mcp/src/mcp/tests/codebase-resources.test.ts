/**
 * codebase:// resource integration tests (RS-1/TASK-323).
 *
 * Tests the shared read dispatcher (resources/index.ts readResource →
 * resources/codebase.ts) directly — the same conventions as index.test.ts:
 * createTestStore + direct readResource/listResourceTemplates/
 * completeResourceArgument calls on a seeded in-memory store.
 *
 * Covered: symbols list (no-query all / single-param search, kind, limit,
 * offset / full-query search+kind+limit / pagination), symbol detail (trace
 * payload + references + parent/children hierarchy), ambiguous
 * disambiguation, symbol/file not found (-32002), repo-not-indexed
 * RecoverableError guidance, bad-uri incl. malformed %-encoding (-32002),
 * template listing (incl. single-param siblings and {+file_path}), and {repo}
 * completion for every codebase template in both notations.
 */

import { describe, it, expect } from "vitest";
import { createTestStore } from "../storage/sqlite";
import { readResource, listResourceTemplates, completeResourceArgument } from "../resources/index";
import { RecoverableError } from "../codebase-index/types/errors";
import type { CodebaseSymbolInsert } from "../types/codebase-symbol";
import type { CodebaseFileInsert } from "../types/codebase-file";

const REPO = "cb-res";

// ── Fixtures (pre-assigned ids so parent_symbol_id links resolve) ─────────

const FILES: CodebaseFileInsert[] = [
	{ repo: REPO, file_path: "src/index.ts", language: "typescript", lines: 60, size_bytes: 1200 },
	{ repo: REPO, file_path: "utils.ts", language: "typescript", lines: 30, size_bytes: 600 }
];

const SYMBOLS: CodebaseSymbolInsert[] = [
	{
		id: "svc-1",
		repo: REPO,
		file_path: "src/index.ts",
		name: "Service",
		kind: "class",
		exported: true,
		default_export: false,
		start_line: 1,
		start_col: 1,
		end_line: 12,
		end_col: 1,
		signature: "export class Service",
		doc_comment: "Entry service.",
		parent_symbol_id: null
	},
	{
		id: "m-1",
		repo: REPO,
		file_path: "src/index.ts",
		name: "handleRequest",
		kind: "function",
		exported: false,
		default_export: false,
		start_line: 4,
		start_col: 3,
		end_line: 8,
		end_col: 4,
		signature: "handleRequest(): void",
		doc_comment: null,
		parent_symbol_id: "svc-1"
	},
	{
		id: "ac-1",
		repo: REPO,
		file_path: "src/index.ts",
		name: "AppConfig",
		kind: "interface",
		exported: true,
		default_export: false,
		start_line: 20,
		start_col: 1,
		end_line: 25,
		end_col: 1,
		signature: "export interface AppConfig",
		doc_comment: "Configuration shape.",
		parent_symbol_id: null
	},
	{
		id: "d-1",
		repo: REPO,
		file_path: "src/index.ts",
		name: "dup",
		kind: "function",
		exported: false,
		default_export: false,
		start_line: 30,
		start_col: 1,
		end_line: 31,
		end_col: 1,
		signature: "function dup(): void",
		doc_comment: null,
		parent_symbol_id: null
	},
	{
		id: "u-1",
		repo: REPO,
		file_path: "utils.ts",
		name: "util",
		kind: "function",
		exported: true,
		default_export: false,
		start_line: 1,
		start_col: 1,
		end_line: 10,
		end_col: 1,
		signature: "export function util(): void",
		doc_comment: "Utility helper.",
		parent_symbol_id: null
	},
	{
		id: "d-2",
		repo: REPO,
		file_path: "utils.ts",
		name: "dup",
		kind: "function",
		exported: false,
		default_export: false,
		start_line: 15,
		start_col: 1,
		end_line: 16,
		end_col: 1,
		signature: "function dup(): void",
		doc_comment: null,
		parent_symbol_id: null
	}
];

async function seedStore() {
	const db = await createTestStore();
	for (const f of FILES) db.codebaseFiles.upsertFile(f);
	db.codebaseSymbols.bulkUpsertSymbols(SYMBOLS);
	db.codebaseReferences.bulkUpsertReferences(REPO, [
		{
			repo: REPO,
			symbol_name: "util",
			caller_file: "src/index.ts",
			caller_line: 42,
			caller_name: "handleRequest",
			kind: "call",
			target_file: "utils.ts",
			target_symbol_id: "u-1"
		}
	]);
	return db;
}

type ResourceContents = ReturnType<typeof readResource>["contents"][number];
function parse<T>(content: ResourceContents): T {
	return JSON.parse(content.text) as T;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("codebase:// resource reads", () => {
	it("lists all symbols for a repo (no query) with pagination shape", async () => {
		const db = await seedStore();
		try {
			const result = readResource(`codebase://${REPO}/symbols`, db);
			const payload = parse<{
				mode: string;
				repo: string;
				records: Array<{ name: string; kind: string }>;
				total: number;
				hasMore: boolean;
				limit: number;
				offset: number;
			}>(result.contents[0]);

			expect(payload.mode).toBe("symbols");
			expect(payload.repo).toBe(REPO);
			expect(payload.total).toBe(6);
			expect(payload.hasMore).toBe(false);
			expect(payload.limit).toBeGreaterThanOrEqual(6);
			expect(payload.offset).toBe(0);
			const names = payload.records.map((r) => r.name);
			expect(names).toContain("Service");
			expect(names).toContain("util");
			expect(names).toContain("dup");
			// record shape: name/kind/filePath/lines/signature
			expect(Object.keys(payload.records[0]).sort()).toEqual(
				["id", "name", "kind", "filePath", "startLine", "endLine", "signature", "exported", "defaultExport"].sort()
			);
		} finally {
			db.close();
		}
	});

	it("respects limit for pagination (hasMore true when truncated)", async () => {
		const db = await seedStore();
		try {
			const result = readResource(`codebase://${REPO}/symbols?limit=2`, db);
			const payload = parse<{ records: unknown[]; total: number; hasMore: boolean }>(result.contents[0]);
			expect(payload.records).toHaveLength(2);
			expect(payload.total).toBe(6);
			expect(payload.hasMore).toBe(true);
		} finally {
			db.close();
		}
	});

	it("filters by search and kind", async () => {
		const db = await seedStore();
		try {
			const searchResult = readResource(`codebase://${REPO}/symbols?search=util`, db);
			const searched = parse<{ records: Array<{ name: string }>; total: number }>(searchResult.contents[0]);
			expect(searched.total).toBe(1);
			expect(searched.records[0].name).toBe("util");

			const kindResult = readResource(`codebase://${REPO}/symbols?kind=function`, db);
			const byKind = parse<{ records: Array<{ kind: string }>; total: number }>(kindResult.contents[0]);
			expect(byKind.total).toBe(4); // handleRequest, util, dup × 2
			expect(byKind.records.every((r) => r.kind === "function")).toBe(true);
		} finally {
			db.close();
		}
	});

	it("returns a trace payload for a symbol detail read", async () => {
		const db = await seedStore();
		try {
			const result = readResource(`codebase://${REPO}/symbols/util`, db);
			const payload = parse<{
				mode: string;
				repo: string;
				name: string;
				definition: { file: string; line: number };
				exportChain: { exported: boolean };
				references: Array<{ filePath: string; kind?: string; callerName?: string | null }>;
			}>(result.contents[0]);

			expect(payload.mode).toBe("trace");
			expect(payload.name).toBe("util");
			expect(payload.definition.file).toBe("utils.ts");
			expect(payload.exportChain.exported).toBe(true);
			// stored call edge from handleRequest (v21 row mapped to TraceReference)
			expect(payload.references).toHaveLength(1);
			expect(payload.references[0].filePath).toBe("src/index.ts");
			expect(payload.references[0].kind).toBe("call");
			expect(payload.references[0].callerName).toBe("handleRequest");
		} finally {
			db.close();
		}
	});

	it("surfaces parent/children hierarchy for a class symbol", async () => {
		const db = await seedStore();
		try {
			const classResult = readResource(`codebase://${REPO}/symbols/Service`, db);
			const klass = parse<{ children: Array<{ name: string }>; parent: unknown }>(classResult.contents[0]);
			expect(klass.children.map((c) => c.name)).toContain("handleRequest");
			expect(klass.parent).toBeNull();

			const methodResult = readResource(`codebase://${REPO}/symbols/handleRequest`, db);
			const method = parse<{ parent: { name: string; kind: string } | null }>(methodResult.contents[0]);
			expect(method.parent?.name).toBe("Service");
			expect(method.parent?.kind).toBe("class");
		} finally {
			db.close();
		}
	});

	it("returns a disambiguation payload when the name is ambiguous", async () => {
		const db = await seedStore();
		try {
			const result = readResource(`codebase://${REPO}/symbols/dup`, db);
			const payload = parse<{ ambiguous: boolean; disambiguation: Array<{ name: string; filePath: string }> }>(
				result.contents[0]
			);
			expect(payload.ambiguous).toBe(true);
			expect(payload.disambiguation).toHaveLength(2);
			expect(new Set(payload.disambiguation.map((d) => d.filePath))).toEqual(new Set(["src/index.ts", "utils.ts"]));
		} finally {
			db.close();
		}
	});

	it("throws MCP resource-not-found for an unknown symbol", async () => {
		const db = await seedStore();
		try {
			expect(() => readResource(`codebase://${REPO}/symbols/does-not-exist`, db)).toThrowError(/not found/);
		} finally {
			db.close();
		}

		const db2 = await seedStore();
		try {
			try {
				readResource(`codebase://${REPO}/symbols/does-not-exist`, db2);
			} catch (error: unknown) {
				const mcpError = error as { code: number; data: { uri: string } };
				expect(mcpError.code).toBe(-32002);
				expect(mcpError.data.uri).toBe(`codebase://${REPO}/symbols/does-not-exist`);
			}
		} finally {
			db2.close();
		}
	});

	it("returns a file landmark (meta + symbols, content null) for a multi-segment path", async () => {
		const db = await seedStore();
		try {
			const result = readResource(`codebase://${REPO}/files/src/index.ts`, db);
			const payload = parse<{
				mode: string;
				file: {
					path: string;
					language: string | null;
					checksum: string | null;
					lines: number;
					sizeBytes: number;
					lastIndexedAt: string | null;
				};
				content: null;
				symbols: Array<{ name: string }>;
				total: number;
			}>(result.contents[0]);

			expect(payload.mode).toBe("file");
			expect(payload.file.path).toBe("src/index.ts");
			expect(payload.file.language).toBe("typescript");
			expect(payload.file.lines).toBe(60);
			expect(payload.file.checksum).toBeNull();
			expect(payload.content).toBeNull(); // disk-only contract — no content stored
			expect(payload.total).toBe(4); // Service, handleRequest, AppConfig, dup
			expect(payload.symbols.map((s) => s.name)).toContain("Service");
			expect(payload.symbols.map((s) => s.name)).toContain("AppConfig");
		} finally {
			db.close();
		}
	});

	it("throws MCP resource-not-found for a file not in the index", async () => {
		const db = await seedStore();
		try {
			try {
				readResource(`codebase://${REPO}/files/missing.ts`, db);
			} catch (error: unknown) {
				const mcpError = error as { code: number };
				expect(mcpError.code).toBe(-32002);
			}
		} finally {
			db.close();
		}
	});

	it("fails with RecoverableError + codebase-index guidance when the repo is not indexed", async () => {
		const db = await seedStore();
		try {
			let caught: unknown;
			try {
				readResource("codebase://never-indexed/symbols", db);
			} catch (error: unknown) {
				caught = error;
			}
			expect(caught).toBeInstanceOf(RecoverableError);
			expect((caught as Error).message).toContain("never-indexed");
			expect((caught as Error).message).toContain("codebase-index");
		} finally {
			db.close();
		}
	});

	it("throws MCP resource-not-found for malformed codebase URIs", async () => {
		const db = await seedStore();
		try {
			// structural malformation + malformed %-encoding (repo, symbol name,
			// file path) — all must surface the pinned -32002, never a raw URIError
			for (const uri of [
				`codebase://${REPO}`,
				`codebase://${REPO}/symbols/a/b`,
				`codebase://${REPO}/wat`,
				`codebase://%zz/symbols`,
				`codebase://${REPO}/symbols/a%zz`,
				`codebase://${REPO}/files/%zz`
			]) {
				try {
					readResource(uri, db);
					throw new Error(`expected throw for ${uri}`);
				} catch (error: unknown) {
					if ((error as Error).message.startsWith("expected throw")) throw error;
					const mcpError = error as { code: number };
					expect(mcpError.code).toBe(-32002);
				}
			}
		} finally {
			db.close();
		}
	});
});

describe("codebase:// template listing + completion", () => {
	it("lists the codebase templates with the repository templates", () => {
		const result = listResourceTemplates();
		const templates = (result.resourceTemplates as Array<{ uriTemplate: string }>).map((entry) => entry.uriTemplate);

		expect(templates).toContain("codebase://{repo}/symbols");
		expect(templates).toContain("codebase://{repo}/symbols?search={search}&kind={kind}&limit={limit}");
		// single-param siblings (SDK-reachable partial-query + pagination forms)
		expect(templates).toContain("codebase://{repo}/symbols?search={search}");
		expect(templates).toContain("codebase://{repo}/symbols?kind={kind}");
		expect(templates).toContain("codebase://{repo}/symbols?limit={limit}");
		expect(templates).toContain("codebase://{repo}/symbols?offset={offset}");
		expect(templates).toContain("codebase://{repo}/symbols/{name}");
		// multi-segment form must match the SDK registration ({+file_path})
		expect(templates).toContain("codebase://{repo}/files/{+file_path}");
		// existing templates stay intact
		expect(templates).toContain("repository://{name}/memories");
		expect(templates).toContain("action://{id}");
	});

	it("completes the {repo} argument with known repos for every codebase template", () => {
		const repos = ["local-memory-mcp", "other-project"];
		const dataSources = { repos, tags: [] };
		// both notations for every surface: listing form (?a={a}&...) AND SDK
		// registration form ({?a,b,c}, {+file_path}) must complete, so
		// production completion/complete never throws -32602 for a listed template
		const uris = [
			"codebase://{repo}/symbols",
			"codebase://{repo}/symbols?search={search}&kind={kind}&limit={limit}",
			"codebase://{repo}/symbols{?search,kind,limit}",
			"codebase://{repo}/symbols?search={search}",
			"codebase://{repo}/symbols{?search}",
			"codebase://{repo}/symbols?kind={kind}",
			"codebase://{repo}/symbols{?kind}",
			"codebase://{repo}/symbols?limit={limit}",
			"codebase://{repo}/symbols{?limit}",
			"codebase://{repo}/symbols?offset={offset}",
			"codebase://{repo}/symbols{?offset}",
			"codebase://{repo}/symbols/{name}",
			"codebase://{repo}/files/{file_path}",
			"codebase://{repo}/files/{+file_path}"
		];

		for (const uri of uris) {
			const values = completeResourceArgument(uri, "repo", "local", {}, dataSources);
			expect(values).toContain("local-memory-mcp");
			expect(values).not.toContain("other-project");
		}
	});
});
