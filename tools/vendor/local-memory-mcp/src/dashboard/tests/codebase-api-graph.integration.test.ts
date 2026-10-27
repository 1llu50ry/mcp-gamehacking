/**
 * Codebase API Integration Tests — symbols & graph module.
 *
 * Split from codebase-api.integration.test.ts (TASK-428). The shared
 * `vi.mock("../../dashboard/lib/context", ...)`, helpers and seed fixtures
 * live in ./codebase-api.shared; the index/metadata/search and file-content
 * modules live in their own files. Tests run against an in-memory SQLiteStore.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	seedCallersRepo,
	seedDuplicateRepo,
	seedGraphRepo,
	seedHeritageRepo,
	startCodebaseServer
} from "./codebase-api.shared";

describe("Codebase API: symbols & graph", () => {
	let baseUrl: string;
	let closeServer: () => Promise<void>;

	beforeAll(async () => {
		const server = await startCodebaseServer();
		baseUrl = server.baseUrl;
		closeServer = server.close;
	});

	afterAll(async () => {
		await closeServer();
	});

	describe("symbol-callers", () => {
		// Seed runs ONCE (bulkUpsertSymbols is a plain INSERT — re-seeding would
		// violate the id PK); the kind-filter and 404 tests share the fixture.
		beforeAll(seedCallersRepo);

		it("returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/symbol/callers?name=startServer`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_REPO");
		});

		it("returns 400 when name is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/symbol/callers?repo=test-owner/callers-repo`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_NAME");
		});

		it("returns caller/callee pairs grouped by caller symbol", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/symbol/callers?repo=test-owner/callers-repo&name=startServer`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.symbol.name).toBe("startServer");
			expect(body.symbol.kind).toBe("Function");
			expect(body.total).toBe(2);
			expect(body.pairs).toHaveLength(2);
			expect(body.pairs[0].caller).toEqual({ name: "invoke", filePath: "src/callers.ts", line: 6 });
			expect(body.pairs[0].callee).toEqual({ name: "startServer", filePath: "src/target.ts" });
			expect(body.pairs[0].kind).toBe("call");
			// Grouped by caller symbol, caller kind resolved from codebase_symbols.
			expect(body.groupedByCaller).toHaveLength(1);
			expect(body.groupedByCaller[0].caller).toEqual({ name: "invoke", filePath: "src/callers.ts", kind: "Function" });
			expect(body.groupedByCaller[0].count).toBe(2);
		});

		it("filters pairs by reference kind", async () => {
			const res = await fetch(
				`${baseUrl}/api/codebase/symbol/callers?repo=test-owner/callers-repo&name=startServer&kind=call`
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.total).toBe(1);
			expect(body.pairs[0].kind).toBe("call");
		});

		it("returns 404 for an unknown symbol", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/symbol/callers?repo=test-owner/callers-repo&name=TotallyMadeUp`);
			expect(res.status).toBe(404);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("SYMBOL_NOT_FOUND");
		});
	});

	describe("symbol-callers disambiguation (TASK-373)", () => {
		// Seed runs ONCE (bulkUpsertSymbols is a plain INSERT — re-seeding
		// would violate the id PK).
		beforeAll(seedDuplicateRepo);

		it("returns 409 AMBIGUOUS_SYMBOL for duplicate names without filePath", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/symbol/callers?repo=test-owner/dup-repo&name=handleInit`);
			expect(res.status).toBe(409);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("AMBIGUOUS_SYMBOL");
			// Candidates listed deterministically (file_path:start_line).
			expect(body.error).toContain("src/a.ts:1");
			expect(body.error).toContain("src/b.ts:1");
		});

		it("scopes the symbol AND its pairs by filePath (src/a.ts)", async () => {
			const res = await fetch(
				`${baseUrl}/api/codebase/symbol/callers?repo=test-owner/dup-repo&name=handleInit&filePath=src/a.ts`
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.symbol.filePath).toBe("src/a.ts");
			// Pairs are scoped to the chosen definition too — the drilldown
			// node and its edges describe the SAME symbol.
			expect(body.total).toBe(1);
			expect(body.pairs[0].callee).toEqual({ name: "handleInit", filePath: "src/a.ts" });
		});

		it("scopes the symbol AND its pairs by filePath (src/b.ts)", async () => {
			const res = await fetch(
				`${baseUrl}/api/codebase/symbol/callers?repo=test-owner/dup-repo&name=handleInit&filePath=src/b.ts`
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.symbol.filePath).toBe("src/b.ts");
			expect(body.total).toBe(1);
			expect(body.pairs[0].callee).toEqual({ name: "handleInit", filePath: "src/b.ts" });
		});

		it("returns 404 when filePath has no symbol of that name", async () => {
			const res = await fetch(
				`${baseUrl}/api/codebase/symbol/callers?repo=test-owner/dup-repo&name=handleInit&filePath=src/nope.ts`
			);
			expect(res.status).toBe(404);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("SYMBOL_NOT_FOUND");
		});
	});

	describe("code-graph", () => {
		// Seed runs ONCE (bulkUpsertSymbols is a plain INSERT — re-seeding
		// would violate the id PK); the kind-filter tests share the fixture.
		beforeAll(seedGraphRepo);

		it("returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/graph`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_REPO");
		});

		it("returns 404 for an empty (unindexed) repo", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/graph?repo=test-owner/no-index-repo`);
			expect(res.status).toBe(404);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("REPO_NOT_INDEXED");
		});

		it("returns 400 for an invalid kind", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/graph?repo=test-owner/graph-repo&kind=bogus`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("INVALID_GRAPH_KIND");
		});

		it("returns degree-ranked nodes and call + co_defined edges", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/graph?repo=test-owner/graph-repo`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.nodes).toHaveLength(3);
			for (const node of body.nodes) {
				expect(node.id).toMatch(/^sym-/);
				expect(node.name).toBeDefined();
				expect(node.kind).toBeDefined();
				expect(node.filePath).toBeDefined();
				expect(typeof node.size).toBe("number");
				expect(typeof node.degree).toBe("number");
			}
			// Alpha←Gamma (call), Gamma←Beta (call), Alpha→Beta (co_defined).
			expect(body.edges).toHaveLength(3);
			const relationTypes = (body.edges as Array<{ relation_type: string }>).map((e) => e.relation_type).sort();
			expect(relationTypes).toEqual(["call", "call", "co_defined"]);
			for (const edge of body.edges) {
				expect(typeof edge.source).toBe("string");
				expect(typeof edge.target).toBe("string");
			}
			// All three symbols have reference degrees (Gamma=2, Alpha=1, Beta=1)
			// — none isolated.
			expect(body.truncated).toBe(false);
		});

		it("filters edges by kind=call", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/graph?repo=test-owner/graph-repo&kind=call`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.edges).toHaveLength(2);
			expect(body.edges.every((e: any) => e.relation_type === "call")).toBe(true);
		});

		it("filters edges by kind=import", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/graph?repo=test-owner/graph-repo&kind=import`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			// No import rows seeded — graph still shows the node universe
			// (file-order fallback when no edge-family degrees exist).
			expect(body.edges).toHaveLength(0);
			expect(body.nodes).toHaveLength(3);
		});

		it("filters edges by kind=co_defined", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/graph?repo=test-owner/graph-repo&kind=co_defined`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.edges).toHaveLength(1);
			expect(body.edges[0].relation_type).toBe("co_defined");
		});

		it("caps edges at CODE_GRAPH_MAX_EDGES and reports truncated", async () => {
			// CODE_GRAPH_MAX_EDGES is overridden to 10 for this file. A single
			// file with 12 symbols yields 11 co_defined edges > cap.
			const { db } = await import("../../dashboard/lib/context");
			db.codebaseFiles.upsertFile({
				repo: "graph-cap-repo",
				file_path: "src/big.ts",
				language: "typescript",
				checksum: "cap1",
				lines: 100,
				size_bytes: 400
			});
			db.codebaseSymbols.bulkUpsertSymbols(
				Array.from({ length: 12 }, (_, i) => ({
					id: `cap-sym-${i}`,
					repo: "graph-cap-repo",
					file_path: "src/big.ts",
					name: `Sym${i}`,
					kind: "Function",
					exported: true,
					default_export: false,
					start_line: i * 5 + 1,
					start_col: 0,
					end_line: i * 5 + 5,
					end_col: 1
				}))
			);

			const res = await fetch(`${baseUrl}/api/codebase/graph?repo=test-owner/graph-cap-repo`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.edges).toHaveLength(10);
			expect(body.truncated).toBe(true);
			expect(body.stats.edgeCap).toBe(10);
			expect(body.stats.totalSymbols).toBe(12);
		});
	});

	describe("code-graph heritage/import (caller_name null → span fallback, TASK-374)", () => {
		// Seed runs ONCE (bulkUpsertSymbols is a plain INSERT — re-seeding
		// would violate the id PK).
		beforeAll(seedHeritageRepo);

		it("resolves extends + module-scope import edges by span", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/graph?repo=test-owner/heritage-repo`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			// 2 reference edges (extends + import) + 1 same-file co_defined
			// chain (ChildService→NestedConfig).
			expect(body.edges).toHaveLength(3);
			const relationTypes = (body.edges as Array<{ relation_type: string }>).map((e) => e.relation_type).sort();
			expect(relationTypes).toEqual(["co_defined", "extends", "import"]);

			// extends: innermost symbol containing caller_line 7 = NestedConfig
			// (7-10 wins over the enclosing ChildService 5-30).
			const extendsEdge = (body.edges as any[]).find((e) => e.relation_type === "extends");
			expect(extendsEdge.source).toBe("sym-her-nested");
			expect(extendsEdge.target).toBe("sym-her-base");

			// import: caller_line 2 has no containing span → first top-level
			// symbol of src/child.ts = ChildService.
			const importEdge = (body.edges as any[]).find((e) => e.relation_type === "import");
			expect(importEdge.source).toBe("sym-her-child");
			expect(importEdge.target).toBe("sym-her-logger");
		});

		it("surfaces the module-scope import edge under kind=import", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/graph?repo=test-owner/heritage-repo&kind=import`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.edges).toHaveLength(1);
			expect(body.edges[0]).toEqual({
				source: "sym-her-child",
				target: "sym-her-logger",
				relation_type: "import"
			});
		});
	});
});
