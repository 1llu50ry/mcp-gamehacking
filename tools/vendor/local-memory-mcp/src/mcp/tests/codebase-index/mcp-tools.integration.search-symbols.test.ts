import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { handleCodebaseRead } from "../../tools/codebase.read";
import { REPO, data, setupIntegrationFixture } from "./mcp-tools.integration.shared.js";
import type { SQLiteStore } from "../../storage/sqlite.js";
import type { VectorStore } from "../../types.js";

let store: SQLiteStore;
let vectors: VectorStore;

beforeAll(async () => {
	const fixture = await setupIntegrationFixture();
	store = fixture.store;
	vectors = fixture.vectors;
});

afterAll(() => {
	store.close();
});

describe("handleCodebaseRead (search_symbols mode)", () => {
	it("returns correct symbol for exact name match", async () => {
		const resp = await handleCodebaseRead(
			{ owner: "vheins", json: true, query: "initializeApp", repo: REPO },
			store,
			vectors
		);
		const d = data(resp);
		const symbols = d.symbols as Array<Record<string, unknown>>;

		expect(symbols.length).toBe(1);
		expect(symbols[0].name).toBe("initializeApp");
		expect(symbols[0].kind).toBe("function");
		expect(symbols[0].rankTier).toBe(1); // RankTier.Exact
	});

	it("returns multiple ranked results for prefix query", async () => {
		const resp = await handleCodebaseRead({ owner: "vheins", json: true, query: "App", repo: REPO }, store, vectors);
		const d = data(resp);
		const symbols = d.symbols as Array<Record<string, unknown>>;

		// Should match: AppConfig, Application (prefix match)
		expect(symbols.length).toBeGreaterThanOrEqual(2);

		// Exact matches (Application, AppConfig) should be top-tier
		const names = symbols.map((s) => s.name);
		expect(names).toContain("Application");
		expect(names).toContain("AppConfig");

		const appResult = symbols.find((s) => s.name === "Application");
		expect(appResult).toBeDefined();
		expect(appResult!.rankTier).toBeLessThanOrEqual(3); // Exact or Prefix
	});

	it("kind filter returns only matching kind", async () => {
		const resp = await handleCodebaseRead(
			{ owner: "vheins", json: true, query: "form", repo: REPO, kind: "function" },
			store,
			vectors
		);
		const d = data(resp);
		const symbols = d.symbols as Array<Record<string, unknown>>;

		expect(symbols.length).toBeGreaterThanOrEqual(1);
		for (const s of symbols) {
			expect(s.kind).toBe("function");
		}
	});

	it("returns empty result for non-existent symbol", async () => {
		const resp = await handleCodebaseRead(
			{ owner: "vheins", json: true, query: "zzzNonexistentSymbol", repo: REPO },
			store,
			vectors
		);
		const d = data(resp);

		expect(d.symbols).toEqual([]);
		expect(d.total).toBe(0);
		expect(d.hasMore).toBe(false);
	});

	it("pagination: limit + offset works correctly", async () => {
		// Get page 1: limit 3
		const page1 = await handleCodebaseRead(
			{ owner: "vheins", json: true, query: "a", repo: REPO, limit: 3, offset: 0 },
			store,
			vectors
		);
		const d1 = data(page1);
		const symbols1 = d1.symbols as Array<Record<string, unknown>>;
		expect(symbols1.length).toBeLessThanOrEqual(3);

		// Get page 2: offset 3, limit 3
		const page2 = await handleCodebaseRead(
			{ owner: "vheins", json: true, query: "a", repo: REPO, limit: 3, offset: 3 },
			store,
			vectors
		);
		const d2 = data(page2);
		const symbols2 = d2.symbols as Array<Record<string, unknown>>;
		expect(symbols2.length).toBeLessThanOrEqual(3);

		// Pages should not overlap
		const page1Names = new Set(symbols1.map((s) => s.id));
		const page2Names = symbols2.map((s) => s.id);
		for (const id of page2Names) {
			expect(page1Names.has(id)).toBe(false);
		}

		// Both pages should share the same total
		expect(d1.total).toBe(d2.total);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// codebase-read: file mode (via filePath)
// ═══════════════════════════════════════════════════════════════════════
