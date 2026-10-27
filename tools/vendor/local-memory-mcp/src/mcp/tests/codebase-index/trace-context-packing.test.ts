import { describe, it, expect, beforeEach } from "vitest";
import { handleCodebaseRead } from "../../tools/codebase.read";
import { createTestStore } from "../../storage/sqlite.js";
import type { SQLiteStore } from "../../storage/sqlite.js";
import type { VectorStore } from "../../types.js";
import { packContext, estimateSymbolTokens } from "../../codebase-index/services/trace-service.js";
import { formatContextPack } from "../../tools/codebase-read/trace.js";
import type { CodebaseSymbol, CodebaseReference } from "../../types.js";

/**
 * Token-budgeted graph context packing (issue #85).
 *
 * Mirrors the trace-related-types test conventions (pure-unit on the packer
 * with seeded symbol/reference arrays, plus end-to-end via handleCodebaseRead
 * on an in-memory store). Partitioned by Vitest project; no jsdom.
 */

function noopVectorStore(): VectorStore {
	return {
		async upsert(): Promise<void> {},
		async remove(): Promise<void> {},
		async search(): Promise<[]> {
			return [];
		}
	};
}

function seedSymbol(
	store: SQLiteStore,
	repo: string,
	overrides: {
		id?: string;
		file_path: string;
		name: string;
		kind?: string;
		exported?: boolean;
		start_line?: number;
		signature?: string | null;
	}
): void {
	store.codebaseSymbols.bulkUpsertSymbols([
		{
			repo,
			file_path: overrides.file_path,
			name: overrides.name,
			kind: overrides.kind ?? "function",
			exported: overrides.exported ?? true,
			default_export: false,
			start_line: overrides.start_line ?? 1,
			start_col: 0,
			end_line: overrides.start_line ?? 1,
			end_col: 10,
			doc_comment: null,
			signature: overrides.signature ?? null,
			parent_symbol_id: null,
			id: overrides.id
		}
	]);
}

function seedRef(
	store: SQLiteStore,
	repo: string,
	overrides: {
		symbol_name: string;
		caller_file: string;
		caller_line?: number;
		caller_name?: string | null;
		kind?: string;
		role?: string;
		target_file?: string | null;
		target_symbol_id?: string | null;
		module_specifier?: string | null;
	}
): void {
	store.codebaseReferences.bulkUpsertReferences(repo, [
		{
			repo,
			symbol_name: overrides.symbol_name,
			caller_file: overrides.caller_file,
			caller_line: overrides.caller_line ?? 1,
			caller_name: overrides.caller_name ?? null,
			kind: overrides.kind ?? "type",
			role: (overrides.role ?? "parameter") as "parameter",
			target_file: overrides.target_file ?? null,
			target_symbol_id: overrides.target_symbol_id ?? null,
			local_name: null,
			imported_name: null,
			module_specifier: overrides.module_specifier ?? null,
			import_kind: null
		}
	]);
}

function traceData(response: Awaited<ReturnType<typeof handleCodebaseRead>>): Record<string, unknown> {
	return response.structuredContent as Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure unit — packContext (issue #85)
// ═══════════════════════════════════════════════════════════════════════════

function makeSym(
	overrides: Partial<CodebaseSymbol> & Pick<CodebaseSymbol, "id" | "name" | "file_path">
): CodebaseSymbol {
	return {
		id: overrides.id,
		repo: overrides.repo ?? "test-repo",
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

function makeRef(
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

describe("packContext (pure unit, issue #85)", () => {
	const root = makeSym({
		id: "root-1",
		name: "createOrder",
		file_path: "src/orders/order.service.ts",
		kind: "function",
		signature: "createOrder(dto: CreateOrderDto): OrderResponseDto",
		start_line: 5
	});
	// Tier 2 candidates — the root's direct type deps (parameter/return).
	const dto = makeSym({
		id: "dto-1",
		name: "CreateOrderDto",
		file_path: "src/orders/dto.ts",
		kind: "interface",
		signature: "interface CreateOrderDto",
		start_line: 1
	});
	const resp = makeSym({
		id: "resp-1",
		name: "OrderResponseDto",
		file_path: "src/orders/dto.ts",
		kind: "interface",
		signature: "interface OrderResponseDto",
		start_line: 2
	});
	// Tier 3 candidate — a transitive type dep of `dto`.
	const item = makeSym({
		id: "item-1",
		name: "CreateOrderItemDto",
		file_path: "src/orders/dto.ts",
		kind: "interface",
		signature: "interface CreateOrderItemDto",
		start_line: 3
	});
	// Tier 4 candidate — a called function.
	const helper = makeSym({
		id: "helper-1",
		name: "priceLookup",
		file_path: "src/orders/pricing.ts",
		kind: "function",
		signature: "function priceLookup()",
		start_line: 1
	});
	// Tier 5 candidate — an import-only relationship.
	const impSym = makeSym({
		id: "imp-1",
		name: "CurrencyCode",
		file_path: "src/shared/currency.ts",
		kind: "enum",
		signature: "enum CurrencyCode",
		start_line: 1
	});
	const symbols = [root, dto, resp, item, helper, impSym];

	// Edge fixtures documented in the packer: a 'type' edge's caller site is
	// (caller_file, caller_name) matching the SOURCE symbol, and its target is
	// resolved by target_symbol_id when set.
	const rootOutgoing: CodebaseReference[] = [
		makeRef({
			symbol_name: "CreateOrderDto",
			caller_file: "src/orders/order.service.ts",
			caller_name: "createOrder",
			role: "parameter",
			kind: "type",
			target_file: "src/orders/dto.ts",
			target_symbol_id: "dto-1"
		}),
		makeRef({
			symbol_name: "OrderResponseDto",
			caller_file: "src/orders/order.service.ts",
			caller_name: "createOrder",
			role: "return",
			kind: "type",
			target_file: "src/orders/dto.ts",
			target_symbol_id: "resp-1"
		}),
		makeRef({
			symbol_name: "priceLookup",
			caller_file: "src/orders/order.service.ts",
			caller_name: "createOrder",
			kind: "call",
			target_file: "src/orders/pricing.ts",
			target_symbol_id: "helper-1"
		}),
		makeRef({
			symbol_name: "CurrencyCode",
			caller_file: "src/orders/order.service.ts",
			caller_name: "createOrder",
			kind: "import",
			target_file: "src/shared/currency.ts",
			target_symbol_id: "imp-1",
			module_specifier: "@/shared/currency"
		})
	];
	// A transitive 'type' dep of dto → item (depth 2 from root).
	const dtoOutgoing: CodebaseReference[] = [
		makeRef({
			symbol_name: "CreateOrderItemDto",
			caller_file: "src/orders/dto.ts",
			caller_name: "CreateOrderDto",
			role: "property",
			kind: "type",
			target_file: "src/orders/dto.ts",
			target_symbol_id: "item-1"
		})
	];
	// A duplicate path: helper also gets reached via a redundant alias edge, and
	// there is a cycle dto → item → dto. Neither must duplicate context.
	const itemOutgoing: CodebaseReference[] = [
		makeRef({
			symbol_name: "CreateOrderDto",
			caller_file: "src/orders/dto.ts",
			caller_name: "CreateOrderItemDto",
			role: "generic",
			kind: "type",
			target_file: "src/orders/dto.ts",
			target_symbol_id: "dto-1"
		})
	];

	// A large-budget pack that admits everything (no cap) — used to verify tier
	// ordering and dedup deterministically.
	function packAll(budget: number, maxDepth = 3) {
		return packContext(
			root,
			"test-repo",
			symbols,
			[...rootOutgoing, ...dtoOutgoing, ...itemOutgoing],
			budget,
			maxDepth
		);
	}

	it("ranks tiers in order: root, api(direct types), direct, calls, imports", () => {
		const result = packAll(10_000);
		// All six symbols fit comfortably → the exact tier order is observable.
		const order = result.items.map((i) => i.tier);
		expect(order[0]).toBe("root");
		// Two direct type deps (tier 2) come before the transitive dep, the call,
		// and the import.
		expect(order.filter((t) => t === "api").length).toBe(2);
		expect(order.filter((t) => t === "direct").length).toBe(1);
		expect(order.filter((t) => t === "calls").length).toBe(1);
		expect(order.filter((t) => t === "imports").length).toBe(1);
		const firstApi = order.indexOf("api");
		const directIdx = order.indexOf("direct");
		const callsIdx = order.indexOf("calls");
		const importsIdx = order.indexOf("imports");
		expect(firstApi).toBeLessThan(directIdx);
		expect(directIdx).toBeLessThan(callsIdx);
		expect(callsIdx).toBeLessThan(importsIdx);
	});

	it("includes the root first and always includes it even when its own estimate exceeds a tiny budget", () => {
		const result = packContext(root, "test-repo", symbols, rootOutgoing, 256, 2);
		expect(result.items[0].tier).toBe("root");
		expect(result.items[0].symbolId).toBe("root-1");
		// A 256-token floor is lower than any single symbol estimate, so nothing
		// but the root can fit — but the root is never dropped.
		expect(result.items).toHaveLength(1);
		expect(result.estimatedTokens).toBeGreaterThan(0);
	});

	it("stops packing at the token budget and reports excluded counts", () => {
		// Budget just large enough for the root + one api dep. Everything else
		// must be excluded (capped=true).
		const singleDepBudget = estimateSymbolTokens(root) + estimateSymbolTokens(dto);
		const result = packAll(singleDepBudget, 3);
		expect(result.capped).toBe(true);
		expect(result.estimatedTokens).toBeLessThanOrEqual(singleDepBudget);
		// Root + dto packed at most (dto is the first api dep by deterministic
		// order). It may or may not include the second api dep depending on
		// exact estimates — but it must NOT include any tier-3/4/5 symbol.
		const tiersUsed = result.items.map((i) => i.tier);
		expect(tiersUsed.includes("direct")).toBe(false);
		expect(tiersUsed.includes("calls")).toBe(false);
		expect(tiersUsed.includes("imports")).toBe(false);
		// Excluded accounting: at least one candidate was seen and cut.
		const totalExcluded = Object.values(result.tiers).reduce((s, t) => s + t.excludedSymbols, 0);
		expect(totalExcluded).toBeGreaterThan(0);
	});

	it("is deterministic for identical inputs", () => {
		const a = packAll(10_000);
		const b = packAll(10_000);
		expect(a.items).toEqual(b.items);
		expect(a.edges).toEqual(b.edges);
		expect(a.estimatedTokens).toBe(b.estimatedTokens);
		expect(a.tiers).toEqual(b.tiers);
	});

	it("does not duplicate symbols or edges across cycles and duplicate graph paths", () => {
		const result = packAll(10_000);
		// Every symbol id appears exactly once.
		const ids = result.items.map((i) => i.symbolId);
		expect(new Set(ids).size).toBe(ids.length);
		// The cycle dto→item→dto and the duplicate helper path must not emit a
		// duplicated edge key.
		const edgeKeys = result.edges.map((e) => `${e.kind}|${e.fromSymbolId}|${e.toSymbolId}`);
		expect(new Set(edgeKeys).size).toBe(edgeKeys.length);
		// dto is packed at its highest (api) tier, item at direct.
		expect(result.items.find((i) => i.symbolId === "dto-1")!.tier).toBe("api");
		expect(result.items.find((i) => i.symbolId === "item-1")!.tier).toBe("direct");
	});

	it("estimates tokens deterministically with a count-based heuristic", () => {
		// Same input → same estimate; larger signature → larger estimate.
		expect(estimateSymbolTokens(dto)).toBe(estimateSymbolTokens(dto));
		const big = makeSym({
			id: "big-1",
			name: "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz",
			file_path: "src/x.ts",
			signature: "function abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz(x: string): string"
		});
		expect(estimateSymbolTokens(big)).toBeGreaterThan(estimateSymbolTokens(dto));
		expect(estimateSymbolTokens(dto)).toBeGreaterThan(0);
	});

	it("returns tier breakdown metadata (per-tier included/excluded/edges)", () => {
		const result = packAll(singleDepBudgetFor(root, dto));
		const tiers = result.tiers;
		expect(tiers.root.includedSymbols).toBe(1);
		// Root + at least one api dep consumed the budget → other tiers have
		// candidates but cut them; at least the accounting object exists for all.
		for (const name of ["root", "api", "direct", "calls", "imports"] as const) {
			expect(tiers[name]).toBeTruthy();
			expect(typeof tiers[name].includedSymbols).toBe("number");
			expect(typeof tiers[name].excludedSymbols).toBe("number");
			expect(typeof tiers[name].includedEdges).toBe("number");
		}
		// Sum of included symbols across tiers equals items.length.
		const totalIncluded = Object.values(tiers).reduce((s, t) => s + t.includedSymbols, 0);
		expect(totalIncluded).toBe(result.items.length);
	});

	function singleDepBudgetFor(a: CodebaseSymbol, b: CodebaseSymbol): number {
		return estimateSymbolTokens(a) + estimateSymbolTokens(b);
	}
});

// ═══════════════════════════════════════════════════════════════════════════
// End-to-end — handleCodebaseRead TRACE with contextBudget (issue #85)
// ═══════════════════════════════════════════════════════════════════════════

describe("handleCodebaseRead TRACE with contextBudget (issue #85)", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;
	const repo = "test-repo";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = noopVectorStore();
		seedSymbol(db, repo, { id: "root-1", file_path: "src/a.ts", name: "alpha", kind: "function", start_line: 5 });
		seedSymbol(db, repo, {
			id: "t1-1",
			file_path: "src/types.ts",
			name: "AlphaType",
			kind: "interface",
			start_line: 2
		});
		seedSymbol(db, repo, {
			id: "t2-1",
			file_path: "src/types.ts",
			name: "BetaType",
			kind: "interface",
			start_line: 3
		});
		seedRef(db, repo, {
			symbol_name: "AlphaType",
			caller_file: "src/a.ts",
			caller_name: "alpha",
			role: "return",
			kind: "type",
			target_file: "src/types.ts",
			target_symbol_id: "t1-1"
		});
		seedRef(db, repo, {
			symbol_name: "BetaType",
			caller_file: "src/a.ts",
			caller_name: "alpha",
			role: "parameter",
			kind: "type",
			target_file: "src/types.ts",
			target_symbol_id: "t2-1"
		});
	});

	it("returns an empty contextPack when the flag is omitted (backward compatible)", async () => {
		const res = await handleCodebaseRead({ name: "alpha", repo, owner: "vheins", json: true }, db, vectors);
		expect(traceData(res).contextPack).toBeUndefined();
	});

	it("packs within budget and exposes items + tier metadata in the response", async () => {
		const res = await handleCodebaseRead(
			{
				name: "alpha",
				repo,
				owner: "vheins",
				json: true,
				contextBudget: 10_000,
				includeRelatedTypes: true,
				relationDepth: 1
			},
			db,
			vectors
		);
		const data = traceData(res);
		const pack = data.contextPack as {
			items: Array<{ symbolId: string; tier: string }>;
			estimatedTokens: number;
			capped: boolean;
			tiers: Record<string, unknown>;
		};
		expect(pack).toBeTruthy();
		expect(pack.items.length).toBeGreaterThan(0);
		// Root is always packed first.
		expect(pack.items[0].symbolId).toBe("root-1");
		expect(pack.items[0].tier).toBe("root");
		expect(pack.estimatedTokens).toBeGreaterThan(0);
		expect(pack.tiers).toBeTruthy();
	});

	it("excludes low-tier candidates when the budget is tight", async () => {
		const res = await handleCodebaseRead(
			{ name: "alpha", repo, owner: "vheins", json: true, contextBudget: 256 }, // below any single-symbol estimate → only root fits
			db,
			vectors
		);
		const pack = traceData(res).contextPack as {
			items: Array<{ symbolId: string }>;
			capped: boolean;
		};
		expect(pack.items).toHaveLength(1);
		expect(pack.items[0].symbolId).toBe("root-1");
		expect(pack.capped).toBe(true);
	});

	it("rejects an out-of-range contextBudget before any trace runs", async () => {
		await expect(
			handleCodebaseRead({ name: "alpha", repo, owner: "vheins", json: true, contextBudget: 100 }, db, vectors) // < 256
		).rejects.toThrow();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// formatContextPack (issue #85)
// ═══════════════════════════════════════════════════════════════════════════

describe("formatContextPack", () => {
	it("renders the pack summary with items and tier accounting", () => {
		const root = makeSym({ id: "r", name: "root", file_path: "src/r.ts", kind: "function" });
		const dto = makeSym({ id: "d", name: "D", file_path: "src/d.ts", kind: "interface" });
		const result = packContext(
			root,
			"test-repo",
			[root, dto],
			[
				makeRef({
					symbol_name: "D",
					caller_file: "src/r.ts",
					caller_name: "root",
					role: "parameter",
					kind: "type",
					target_symbol_id: "d",
					target_file: "src/d.ts"
				})
			],
			10_000,
			1
		);
		const text = formatContextPack(result);
		expect(text).toContain("Context Pack");
		expect(text).toContain("root");
		expect(text).toContain("D");
		expect(text).toContain("Estimated:");
		expect(text).toContain("Tiers:");
	});
});
