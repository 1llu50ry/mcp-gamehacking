import { describe, it, expect, beforeEach } from "vitest";
import { handleCodebaseRead } from "../../tools/codebase.read";
import { createTestStore } from "../../storage/sqlite.js";
import type { SQLiteStore } from "../../storage/sqlite.js";
import type { VectorStore } from "../../types.js";
import { collectRelatedTypes } from "../../codebase-index/services/trace-service.js";
import { formatRelatedTypeTree } from "../../tools/codebase-read/trace.js";
import type { CodebaseSymbol, CodebaseReference } from "../../types.js";

function noopVectorStore(): VectorStore {
	return {
		async upsert(): Promise<void> {},
		async remove(): Promise<void> {},
		async search(): Promise<[]> {
			return [];
		}
	};
}

/**
 * Seed a codebase_symbols row. Pre-assigned ids keep parent/edge wiring
 * deterministic (TASK-300 pattern used across the trace test suite).
 */
function seedSymbol(
	store: SQLiteStore,
	repo: string,
	overrides: {
		id?: string;
		file_path: string;
		name: string;
		kind?: string;
		exported?: boolean;
		default_export?: boolean;
		start_line?: number;
		start_col?: number;
		end_line?: number;
		end_col?: number;
		doc_comment?: string | null;
		signature?: string | null;
		parent_symbol_id?: string | null;
	}
): void {
	store.codebaseSymbols.bulkUpsertSymbols([
		{
			repo,
			file_path: overrides.file_path,
			name: overrides.name,
			kind: overrides.kind ?? "function",
			exported: overrides.exported ?? true,
			default_export: overrides.default_export ?? false,
			start_line: overrides.start_line ?? 1,
			start_col: overrides.start_col ?? 0,
			end_line: overrides.end_line ?? 1,
			end_col: overrides.end_col ?? 10,
			doc_comment: overrides.doc_comment ?? null,
			signature: overrides.signature ?? null,
			parent_symbol_id: overrides.parent_symbol_id ?? null,
			id: overrides.id
		}
	]);
}

/**
 * Seed one 'type' reference edge row. `targetSymbolId` / `targetFile` are
 * optional so tests can exercise the unresolved fallback path.
 */
function seedTypeEdge(
	store: SQLiteStore,
	repo: string,
	overrides: {
		symbol_name: string;
		caller_file: string;
		caller_line?: number;
		caller_name?: string | null;
		role?: string;
		target_file?: string | null;
		target_symbol_id?: string | null;
	}
): void {
	store.codebaseReferences.bulkUpsertReferences(repo, [
		{
			repo,
			symbol_name: overrides.symbol_name,
			caller_file: overrides.caller_file,
			caller_line: overrides.caller_line ?? 1,
			caller_name: overrides.caller_name ?? null,
			kind: "type",
			role: (overrides.role ?? "parameter") as "parameter",
			target_file: overrides.target_file ?? null,
			target_symbol_id: overrides.target_symbol_id ?? null
		}
	]);
}

function traceData(response: Awaited<ReturnType<typeof handleCodebaseRead>>): Record<string, unknown> {
	return response.structuredContent as Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════
// Pure unit — collectRelatedTypes (issue #84)
// ═══════════════════════════════════════════════════════════════════════

function makeSym(
	overrides: Partial<CodebaseSymbol> & Pick<CodebaseSymbol, "id" | "name" | "file_path">
): CodebaseSymbol {
	return {
		id: overrides.id,
		repo: "test-repo",
		name: overrides.name,
		file_path: overrides.file_path,
		kind: overrides.kind ?? "function",
		exported: overrides.exported ?? true,
		default_export: overrides.default_export ?? false,
		start_line: overrides.start_line ?? 1,
		start_col: overrides.start_col ?? 0,
		end_line: overrides.end_line ?? 1,
		end_col: overrides.end_col ?? 10,
		signature: overrides.signature ?? null,
		doc_comment: overrides.doc_comment ?? null,
		parent_symbol_id: overrides.parent_symbol_id ?? null,
		created_at: overrides.created_at ?? new Date().toISOString(),
		updated_at: overrides.updated_at ?? new Date().toISOString()
	};
}

function makeTypeRef(
	overrides: Partial<CodebaseReference> & Pick<CodebaseReference, "symbol_name" | "caller_file">
): CodebaseReference {
	return {
		id: overrides.id ?? "ref-1",
		repo: overrides.repo ?? "test-repo",
		symbol_name: overrides.symbol_name,
		caller_file: overrides.caller_file,
		caller_line: overrides.caller_line ?? 1,
		caller_name: overrides.caller_name ?? null,
		kind: overrides.kind ?? "type",
		target_file: overrides.target_file ?? null,
		target_symbol_id: overrides.target_symbol_id ?? null,
		role: overrides.role ?? "parameter",
		local_name: overrides.local_name ?? null,
		imported_name: overrides.imported_name ?? null,
		module_specifier: overrides.module_specifier ?? null,
		import_kind: overrides.import_kind ?? null,
		created_at: overrides.created_at ?? new Date().toISOString()
	};
}

describe("collectRelatedTypes (pure unit, issue #84)", () => {
	const root = makeSym({
		id: "root-1",
		name: "createOrder",
		file_path: "src/orders/order.service.ts",
		kind: "function"
	});
	const dto = makeSym({ id: "dto-1", name: "CreateOrderDto", file_path: "src/orders/dto.ts", kind: "interface" });
	const itemDto = makeSym({
		id: "item-1",
		name: "CreateOrderItemDto",
		file_path: "src/orders/dto.ts",
		kind: "interface"
	});
	const responseDto = makeSym({
		id: "resp-1",
		name: "OrderResponseDto",
		file_path: "src/orders/dto.ts",
		kind: "interface"
	});
	const symbols = [root, dto, itemDto, responseDto];

	it("returns direct related types (depth 1) with role metadata", () => {
		const refs = [
			makeTypeRef({
				symbol_name: "CreateOrderDto",
				caller_file: "src/orders/order.service.ts",
				caller_name: "createOrder",
				role: "parameter",
				target_file: "src/orders/dto.ts",
				target_symbol_id: "dto-1"
			}),
			makeTypeRef({
				symbol_name: "OrderResponseDto",
				caller_file: "src/orders/order.service.ts",
				caller_name: "createOrder",
				role: "return",
				target_file: "src/orders/dto.ts",
				target_symbol_id: "resp-1"
			})
		];

		const result = collectRelatedTypes(root, "test-repo", symbols, refs, 1);

		expect(result.edges).toHaveLength(2);
		expect(result.skippedUnresolved).toBe(0);

		const dtoEdge = result.edges.find((e) => e.targetSymbolId === "dto-1")!;
		expect(dtoEdge.targetName).toBe("CreateOrderDto");
		expect(dtoEdge.role).toBe("parameter");
		expect(dtoEdge.depth).toBe(1);
		expect(dtoEdge.fromSymbolId).toBe("root-1");
		expect(dtoEdge.fromName).toBe("createOrder");

		const respEdge = result.edges.find((e) => e.targetSymbolId === "resp-1")!;
		expect(respEdge.role).toBe("return");
		expect(respEdge.depth).toBe(1);
	});

	it("traverses transitively (depth > 1) following related types' own edges", () => {
		const refs = [
			// createOrder → CreateOrderDto (parameter)
			makeTypeRef({
				symbol_name: "CreateOrderDto",
				caller_file: "src/orders/order.service.ts",
				caller_name: "createOrder",
				role: "parameter",
				target_symbol_id: "dto-1"
			}),
			// CreateOrderDto → CreateOrderItemDto (property)
			makeTypeRef({
				symbol_name: "CreateOrderItemDto",
				caller_file: "src/orders/dto.ts",
				caller_name: "CreateOrderDto",
				role: "property",
				target_symbol_id: "item-1"
			})
		];

		// Depth 1: only the direct edge.
		const depth1 = collectRelatedTypes(root, "test-repo", symbols, refs, 1);
		expect(depth1.edges.map((e) => e.targetName)).toEqual(["CreateOrderDto"]);

		// Depth 2: transitive hop to CreateOrderItemDto at depth 2.
		const depth2 = collectRelatedTypes(root, "test-repo", symbols, refs, 2);
		expect(depth2.edges).toHaveLength(2);
		const item = depth2.edges.find((e) => e.targetName === "CreateOrderItemDto")!;
		expect(item.depth).toBe(2);
		expect(item.role).toBe("property");
		expect(item.fromSymbolId).toBe("dto-1");
		expect(item.fromName).toBe("CreateOrderDto");
	});

	it("terminates deterministically on cyclic graphs (A → B → A)", () => {
		const a = makeSym({ id: "a-1", name: "TypeA", file_path: "src/a.ts", kind: "interface" });
		const b = makeSym({ id: "b-1", name: "TypeB", file_path: "src/b.ts", kind: "interface" });
		const refs = [
			makeTypeRef({
				symbol_name: "TypeB",
				caller_file: "src/a.ts",
				caller_name: "TypeA",
				role: "property",
				target_symbol_id: "b-1"
			}),
			makeTypeRef({
				symbol_name: "TypeA",
				caller_file: "src/b.ts",
				caller_name: "TypeB",
				role: "property",
				target_symbol_id: "a-1"
			})
		];

		const result = collectRelatedTypes(a, "test-repo", [a, b], refs, 4);

		// Each symbol appears exactly once, at its shallowest depth.
		expect(result.edges).toHaveLength(1);
		expect(result.edges[0]!.targetSymbolId).toBe("b-1");
		expect(result.edges[0]!.depth).toBe(1);
	});

	it("dedupes repeated targets, keeping relation metadata from the first reach", () => {
		// createOrder references CreateOrderDto twice (parameter + a second
		// return-typed overload), plus OrderResponseDto.
		const refs = [
			makeTypeRef({
				symbol_name: "CreateOrderDto",
				caller_file: "src/orders/order.service.ts",
				caller_name: "createOrder",
				role: "parameter",
				target_symbol_id: "dto-1"
			}),
			makeTypeRef({
				symbol_name: "CreateOrderDto",
				caller_file: "src/orders/order.service.ts",
				caller_name: "createOrder",
				role: "return",
				target_symbol_id: "dto-1"
			}),
			makeTypeRef({
				symbol_name: "OrderResponseDto",
				caller_file: "src/orders/order.service.ts",
				caller_name: "createOrder",
				role: "return",
				target_symbol_id: "resp-1"
			})
		];

		const result = collectRelatedTypes(root, "test-repo", symbols, refs, 1);

		// One edge per unique target — CreateOrderDto reported once.
		expect(result.edges).toHaveLength(2);
		const dtoEdge = result.edges.find((e) => e.targetSymbolId === "dto-1")!;
		expect(dtoEdge.role).toBe("parameter");
		expect(dtoEdge.depth).toBe(1);
	});

	it("skips unresolved targets without failing the traversal", () => {
		const refs = [
			// Resolvable via target_symbol_id.
			makeTypeRef({
				symbol_name: "CreateOrderDto",
				caller_file: "src/orders/order.service.ts",
				caller_name: "createOrder",
				role: "parameter",
				target_symbol_id: "dto-1"
			}),
			// No target info and no matching symbol anywhere.
			makeTypeRef({
				symbol_name: "GhostType",
				caller_file: "src/orders/order.service.ts",
				caller_name: "createOrder",
				role: "return",
				target_file: null,
				target_symbol_id: null
			})
		];

		const result = collectRelatedTypes(root, "test-repo", symbols, refs, 1);

		expect(result.edges).toHaveLength(1);
		expect(result.edges[0]!.targetName).toBe("CreateOrderDto");
		expect(result.skippedUnresolved).toBe(1);
	});

	it("falls back to name-based resolution when target_symbol_id is absent", () => {
		const refs = [
			makeTypeRef({
				symbol_name: "CreateOrderDto",
				caller_file: "src/orders/order.service.ts",
				caller_name: "createOrder",
				role: "parameter",
				target_file: "src/orders/dto.ts",
				target_symbol_id: null
			})
		];

		const result = collectRelatedTypes(root, "test-repo", symbols, refs, 1);

		expect(result.edges).toHaveLength(1);
		expect(result.edges[0]!.targetSymbolId).toBe("dto-1");
		expect(result.edges[0]!.targetName).toBe("CreateOrderDto");
	});

	it("respects the maxDepth bound (1..4)", () => {
		// Chain: A → B → C → D → E (each hop is one level deeper).
		const chainSymbols = [root, dto, itemDto, responseDto].concat(
			makeSym({ id: "e-1", name: "LevelE", file_path: "src/orders/dto.ts", kind: "interface" })
		);
		const chain = [
			makeTypeRef({
				symbol_name: "CreateOrderDto",
				caller_file: "src/orders/order.service.ts",
				caller_name: "createOrder",
				role: "parameter",
				target_symbol_id: "dto-1"
			}),
			makeTypeRef({
				symbol_name: "CreateOrderItemDto",
				caller_file: "src/orders/dto.ts",
				caller_name: "CreateOrderDto",
				role: "property",
				target_symbol_id: "item-1"
			}),
			makeTypeRef({
				symbol_name: "OrderResponseDto",
				caller_file: "src/orders/dto.ts",
				caller_name: "CreateOrderItemDto",
				role: "union",
				target_symbol_id: "resp-1"
			}),
			makeTypeRef({
				symbol_name: "LevelE",
				caller_file: "src/orders/dto.ts",
				caller_name: "OrderResponseDto",
				role: "property",
				target_symbol_id: "e-1"
			})
		];

		const result = collectRelatedTypes(root, "test-repo", chainSymbols, chain, 3);
		// Root(1) → DTO(2) → Item(3) → Response(3?) — wait: chain is
		// createOrder→DTO (d1), DTO→Item (d2), Item→Response (d3), Response→E (d4).
		// maxDepth=3 must NOT reach LevelE (depth 4).
		expect(result.edges.some((e) => e.targetName === "LevelE")).toBe(false);
		expect(result.edges.find((e) => e.targetName === "OrderResponseDto")!.depth).toBe(3);
	});
});

describe("formatRelatedTypeTree (issue #84)", () => {
	it("renders the issue's createOrder example shape", () => {
		const edges = [
			{
				targetSymbolId: "dto-1",
				targetName: "CreateOrderDto",
				targetFile: "src/orders/dto.ts",
				targetKind: "interface",
				role: "parameter" as const,
				depth: 1,
				fromName: "createOrder",
				fromSymbolId: "root-1",
				line: 1
			},
			{
				targetSymbolId: "item-1",
				targetName: "CreateOrderItemDto",
				targetFile: "src/orders/dto.ts",
				targetKind: "interface",
				role: "property" as const,
				depth: 2,
				fromName: "CreateOrderDto",
				fromSymbolId: "dto-1",
				line: 1
			},
			{
				targetSymbolId: "resp-1",
				targetName: "OrderResponseDto",
				targetFile: "src/orders/dto.ts",
				targetKind: "interface",
				role: "return" as const,
				depth: 1,
				fromName: "createOrder",
				fromSymbolId: "root-1",
				line: 1
			}
		];

		const tree = formatRelatedTypeTree("createOrder", edges);
		expect(tree).toContain("createOrder");
		expect(tree).toContain("├─ parameter → CreateOrderDto");
		expect(tree).toContain("└─ return → OrderResponseDto");
		// Depth-2 edge nested under CreateOrderDto's line (with trunk `│`).
		expect(tree).toContain("│  └─ property → CreateOrderItemDto [d=2]");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// Integration — handleCodebaseRead TRACE mode with includeRelatedTypes
// ═══════════════════════════════════════════════════════════════════════

describe("handleCodebaseRead (trace mode + related types, issue #84)", () => {
	let store: SQLiteStore;
	let vectors: VectorStore;
	const repo = "test-repo";

	beforeEach(async () => {
		store = await createTestStore();
		vectors = noopVectorStore();
	});

	it("omits relatedTypes when includeRelatedTypes is not set (backward compatible)", async () => {
		seedSymbol(store, repo, {
			id: "root-1",
			file_path: "src/orders/order.service.ts",
			name: "createOrder",
			kind: "function",
			start_line: 10,
			end_line: 20
		});
		seedSymbol(store, repo, {
			id: "dto-1",
			file_path: "src/orders/dto.ts",
			name: "CreateOrderDto",
			kind: "interface",
			start_line: 5
		});
		seedTypeEdge(store, repo, {
			symbol_name: "CreateOrderDto",
			caller_file: "src/orders/order.service.ts",
			caller_name: "createOrder",
			role: "parameter",
			target_file: "src/orders/dto.ts",
			target_symbol_id: "dto-1"
		});

		const response = await handleCodebaseRead(
			{ name: "createOrder", repo, owner: "vheins", json: true },
			store,
			vectors
		);
		const data = traceData(response);

		expect(data.error).toBeUndefined();
		expect(data.relatedTypes).toBeUndefined();
		expect(data.relatedTypesSkippedUnresolved).toBeUndefined();
	});

	it("returns direct related types with relation metadata (depth 1)", async () => {
		seedSymbol(store, repo, {
			id: "root-1",
			file_path: "src/orders/order.service.ts",
			name: "createOrder",
			kind: "function",
			start_line: 10,
			end_line: 20
		});
		seedSymbol(store, repo, {
			id: "dto-1",
			file_path: "src/orders/dto.ts",
			name: "CreateOrderDto",
			kind: "interface",
			start_line: 5
		});
		seedSymbol(store, repo, {
			id: "resp-1",
			file_path: "src/orders/dto.ts",
			name: "OrderResponseDto",
			kind: "interface",
			start_line: 12
		});
		seedTypeEdge(store, repo, {
			symbol_name: "CreateOrderDto",
			caller_file: "src/orders/order.service.ts",
			caller_name: "createOrder",
			role: "parameter",
			target_file: "src/orders/dto.ts",
			target_symbol_id: "dto-1"
		});
		seedTypeEdge(store, repo, {
			symbol_name: "OrderResponseDto",
			caller_file: "src/orders/order.service.ts",
			caller_name: "createOrder",
			role: "return",
			target_file: "src/orders/dto.ts",
			target_symbol_id: "resp-1"
		});

		const response = await handleCodebaseRead(
			{ name: "createOrder", repo, owner: "vheins", json: true, includeRelatedTypes: true },
			store,
			vectors
		);
		const data = traceData(response);

		expect(data.error).toBeUndefined();
		const edges = data.relatedTypes as Array<Record<string, unknown>>;
		expect(edges).toHaveLength(2);

		const dtoEdge = edges.find((e) => e.targetName === "CreateOrderDto")!;
		expect(dtoEdge.role).toBe("parameter");
		expect(dtoEdge.depth).toBe(1);
		expect(dtoEdge.targetSymbolId).toBe("dto-1");
		expect(dtoEdge.targetFile).toBe("src/orders/dto.ts");
		expect(dtoEdge.targetKind).toBe("interface");
		expect(dtoEdge.fromName).toBe("createOrder");

		expect(data.relatedTypesSkippedUnresolved).toBe(0);

		// Markdown surface shows the tree.
		const { getPrimaryTextContent } = await import("../../utils/mcp-response.js");
		expect(getPrimaryTextContent(response)).toContain("### Related Types");
		expect(getPrimaryTextContent(response)).toContain("parameter → CreateOrderDto");
		expect(getPrimaryTextContent(response)).toContain("return → OrderResponseDto");
	});

	it("traverses transitively when relationDepth > 1", async () => {
		seedSymbol(store, repo, {
			id: "root-1",
			file_path: "src/orders/order.service.ts",
			name: "createOrder",
			kind: "function",
			start_line: 10,
			end_line: 20
		});
		seedSymbol(store, repo, {
			id: "dto-1",
			file_path: "src/orders/dto.ts",
			name: "CreateOrderDto",
			kind: "interface",
			start_line: 5
		});
		seedSymbol(store, repo, {
			id: "item-1",
			file_path: "src/orders/dto.ts",
			name: "CreateOrderItemDto",
			kind: "interface",
			start_line: 8
		});
		seedTypeEdge(store, repo, {
			symbol_name: "CreateOrderDto",
			caller_file: "src/orders/order.service.ts",
			caller_name: "createOrder",
			role: "parameter",
			target_file: "src/orders/dto.ts",
			target_symbol_id: "dto-1"
		});
		seedTypeEdge(store, repo, {
			symbol_name: "CreateOrderItemDto",
			caller_file: "src/orders/dto.ts",
			caller_name: "CreateOrderDto",
			role: "property",
			target_file: "src/orders/dto.ts",
			target_symbol_id: "item-1"
		});

		const response = await handleCodebaseRead(
			{ name: "createOrder", repo, owner: "vheins", json: true, includeRelatedTypes: true, relationDepth: 2 },
			store,
			vectors
		);
		const data = traceData(response);

		expect(data.error).toBeUndefined();
		const edges = data.relatedTypes as Array<Record<string, unknown>>;
		expect(edges).toHaveLength(2);

		const itemEdge = edges.find((e) => e.targetName === "CreateOrderItemDto")!;
		expect(itemEdge.role).toBe("property");
		expect(itemEdge.depth).toBe(2);
		expect(itemEdge.fromName).toBe("CreateOrderDto");
	});

	it("handles cyclic graphs deterministically end-to-end", async () => {
		seedSymbol(store, repo, {
			id: "a-1",
			file_path: "src/a.ts",
			name: "TypeA",
			kind: "interface",
			start_line: 1
		});
		seedSymbol(store, repo, {
			id: "b-1",
			file_path: "src/b.ts",
			name: "TypeB",
			kind: "interface",
			start_line: 1
		});
		seedTypeEdge(store, repo, {
			symbol_name: "TypeB",
			caller_file: "src/a.ts",
			caller_name: "TypeA",
			role: "property",
			target_file: "src/b.ts",
			target_symbol_id: "b-1"
		});
		seedTypeEdge(store, repo, {
			symbol_name: "TypeA",
			caller_file: "src/b.ts",
			caller_name: "TypeB",
			role: "property",
			target_file: "src/a.ts",
			target_symbol_id: "a-1"
		});

		const response = await handleCodebaseRead(
			{ name: "TypeA", repo, owner: "vheins", json: true, includeRelatedTypes: true, relationDepth: 4 },
			store,
			vectors
		);
		const data = traceData(response);

		expect(data.error).toBeUndefined();
		const edges = data.relatedTypes as Array<Record<string, unknown>>;
		expect(edges).toHaveLength(1);
		expect(edges[0]!.targetName).toBe("TypeB");
		expect(edges[0]!.depth).toBe(1);
	});

	it("does not fail the whole TRACE request when targets are unresolved", async () => {
		seedSymbol(store, repo, {
			id: "root-1",
			file_path: "src/orders/order.service.ts",
			name: "createOrder",
			kind: "function",
			start_line: 10,
			end_line: 20
		});
		// A type edge with NO target info and no matching symbol anywhere.
		seedTypeEdge(store, repo, {
			symbol_name: "GhostType",
			caller_file: "src/orders/order.service.ts",
			caller_name: "createOrder",
			role: "return",
			target_file: null,
			target_symbol_id: null
		});

		const response = await handleCodebaseRead(
			{ name: "createOrder", repo, owner: "vheins", json: true, includeRelatedTypes: true },
			store,
			vectors
		);
		const data = traceData(response);

		expect(data.error).toBeUndefined();
		expect((data.symbol as Record<string, unknown>).name).toBe("createOrder");
		expect(data.relatedTypes).toEqual([]);
		expect(data.relatedTypesSkippedUnresolved).toBe(1);
	});

	it("validates relationDepth bounds (1..4)", async () => {
		seedSymbol(store, repo, {
			id: "root-1",
			file_path: "src/a.ts",
			name: "root",
			kind: "function",
			start_line: 1
		});

		// Out-of-range relationDepth is a schema violation — the ZodError
		// surfaces from CodebaseReadSchema.parse before any response is built.
		await expect(
			handleCodebaseRead(
				{ name: "root", repo, owner: "vheins", json: true, includeRelatedTypes: true, relationDepth: 5 },
				store,
				vectors
			)
		).rejects.toThrow(/relationDepth/);
		await expect(
			handleCodebaseRead(
				{ name: "root", repo, owner: "vheins", json: true, includeRelatedTypes: true, relationDepth: 0 },
				store,
				vectors
			)
		).rejects.toThrow(/relationDepth/);
	});
});
