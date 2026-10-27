/**
 * codebase-read search_symbols Mode Tests.
 *
 * Tests the handleCodebaseRead handler with single-term query (search_symbols mode)
 * covering exact match, prefix search, kind filter, repo scope, pagination,
 * min-length requirement, non-existent symbols, and exported-only filter.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleCodebaseRead } from "../../tools/codebase.read";
import { createTestStore, SQLiteStore } from "../../storage/sqlite";
import { VectorStore } from "../../types";

// ── Helpers ──────────────────────────────────────────────────────────────

function noopVectorStore(): VectorStore {
	return {
		async upsert(): Promise<void> {},
		async remove(): Promise<void> {},
		async search(): Promise<[]> {
			return [];
		}
	};
}

/** Insert test symbols that exercise all ranking tiers and filter combinations. */
function seedSymbols(store: SQLiteStore): void {
	store.codebaseSymbols.bulkUpsertSymbols([
		// Tier 1: exact match candidate
		{
			repo: "test-repo",
			file_path: "src/core.ts",
			name: "createUser",
			kind: "function",
			exported: true,
			start_line: 10,
			doc_comment: "Creates a new user"
		},
		// Tier 3: prefix match
		{
			repo: "test-repo",
			file_path: "src/core.ts",
			name: "createAccount",
			kind: "function",
			exported: true,
			start_line: 30,
			doc_comment: "Creates an account"
		},
		// Tier 4: substring (contains "User" somewhere)
		{
			repo: "test-repo",
			file_path: "src/utils.ts",
			name: "deleteUser",
			kind: "function",
			exported: true,
			start_line: 5,
			doc_comment: "Deletes a user"
		},
		// Tier 5: FTS5/doc_comment match
		{
			repo: "test-repo",
			file_path: "src/helpers.ts",
			name: "processRequest",
			kind: "function",
			exported: false,
			start_line: 1,
			doc_comment: "Processes user input safely"
		},
		// Non-exported
		{
			repo: "test-repo",
			file_path: "src/internal.ts",
			name: "internalHelper",
			kind: "function",
			exported: false,
			start_line: 1
		},
		// class kind
		{
			repo: "test-repo",
			file_path: "src/models.ts",
			name: "UserModel",
			kind: "class",
			exported: true,
			start_line: 1,
			doc_comment: "User database model"
		},
		// interface kind
		{
			repo: "test-repo",
			file_path: "src/types.ts",
			name: "UserConfig",
			kind: "interface",
			exported: true,
			start_line: 1,
			doc_comment: "Configuration for user"
		},
		// Different repo
		{
			repo: "other-repo",
			file_path: "src/main.ts",
			name: "createUser",
			kind: "function",
			exported: true,
			start_line: 1,
			doc_comment: "Create user in other repo"
		}
	]);
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("handleCodebaseRead (search_symbols mode)", () => {
	let store: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(async () => {
		store = await createTestStore();
		vectors = noopVectorStore();
		seedSymbols(store);
	});

	afterEach(() => {
		store.close();
	});

	it("returns exact match when searching by exact name", async () => {
		const response = await handleCodebaseRead(
			{ query: "createUser", repo: "test-repo", owner: "vheins", json: true },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;
		const symbols = data.symbols as Array<Record<string, unknown>>;

		expect(data.total as number).toBeGreaterThanOrEqual(1);
		// Exact matches should appear first
		expect(symbols[0].name).toBe("createUser");
		expect(symbols[0].rankTier).toBe(1); // Tier.Exact
		expect(typeof symbols[0].score).toBe("number");
	});

	it("returns prefix-ranked results for partial name search", async () => {
		const response = await handleCodebaseRead(
			{ query: "create", repo: "test-repo", owner: "vheins", json: true },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;
		const symbols = data.symbols as Array<Record<string, unknown>>;

		expect(data.total as number).toBeGreaterThanOrEqual(2);
		expect(symbols[0].name).toBe("createAccount");
		expect(symbols[1].name).toBe("createUser");
	});

	it("filters by kind", async () => {
		const response = await handleCodebaseRead(
			{ query: "User", repo: "test-repo", owner: "vheins", json: true, kind: "class" },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;
		const symbols = data.symbols as Array<Record<string, unknown>>;

		expect(symbols.length).toBe(1);
		expect(symbols[0].name).toBe("UserModel");
		expect(symbols[0].kind).toBe("class");
	});

	it("scopes results to the specified repo", async () => {
		const response = await handleCodebaseRead(
			{ query: "createUser", repo: "other-repo", owner: "vheins", json: true },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;
		const symbols = data.symbols as Array<Record<string, unknown>>;

		expect(data.total as number).toBe(1);
		expect(symbols[0].repo).toBe("other-repo");
	});

	it("returns empty for queries under 2 characters", async () => {
		const response = await handleCodebaseRead(
			{ query: "c", repo: "test-repo", owner: "vheins", json: true },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;
		const symbols = data.symbols as Array<Record<string, unknown>>;

		expect(data.total as number).toBe(0);
		expect(symbols.length).toBe(0);
	});

	it("routes an empty query string to architecture mode", async () => {
		const response = await handleCodebaseRead(
			{ query: "", repo: "test-repo", owner: "vheins", json: true },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.mode).toBe("architecture");
		expect(data.summary).toBeDefined();
	});

	it("supports pagination with offset and limit", async () => {
		const response = await handleCodebaseRead(
			{ query: "User", repo: "test-repo", owner: "vheins", json: true, limit: 2, offset: 1 },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;
		const symbols = data.symbols as Array<Record<string, unknown>>;

		expect(symbols.length).toBeLessThanOrEqual(2);
		expect(data.hasMore as boolean).toBe(true);
		expect(data.offset as number).toBe(1);
		expect(data.limit as number).toBe(2);

		// Second page should start at offset 3
		const response2 = await handleCodebaseRead(
			{ query: "User", repo: "test-repo", owner: "vheins", json: true, limit: 2, offset: 3 },
			store,
			vectors
		);
		const data2 = response2.structuredContent as Record<string, unknown>;
		const symbols2 = data2.symbols as Array<Record<string, unknown>>;

		// Ensure no overlap between pages
		const page1Names = symbols.map((s: Record<string, unknown>) => s.name);
		const page2Names = symbols2.map((s: Record<string, unknown>) => s.name);
		for (const name of page2Names) {
			expect(page1Names).not.toContain(name);
		}
		// Page 2 should tell us there are no more results
		expect(data2.hasMore as boolean).toBe(false);
	});

	it("returns empty result for non-existent symbol", async () => {
		const response = await handleCodebaseRead(
			{ query: "NonExistentSymbol", repo: "test-repo", owner: "vheins", json: true },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.total as number).toBe(0);
		expect((data.symbols as Array<unknown>).length).toBe(0);
		expect(data.hasMore as boolean).toBe(false);
	});

	it("filters by exportedOnly", async () => {
		const response = await handleCodebaseRead(
			{ query: "Process", repo: "test-repo", owner: "vheins", json: true, exportedOnly: true },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;
		const symbols = data.symbols as Array<Record<string, unknown>>;

		// processRequest is NOT exported, so it should be filtered out
		for (const sym of symbols) {
			expect(sym.exported).toBe(true);
		}
	});

	it("searches across repos when `repos` is provided without `repo`", async () => {
		const response = await handleCodebaseRead(
			{ query: "createUser", repos: ["test-repo", "other-repo"], owner: "vheins", json: true },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;
		const symbols = data.symbols as Array<Record<string, unknown>>;

		// createUser exists in both fixture repos — both must be surfaced with
		// their `repo` field intact (issue #67 cross-repo search).
		expect(data.total as number).toBeGreaterThanOrEqual(2);
		const repos = new Set(symbols.map((s) => s.repo));
		expect(repos.has("test-repo")).toBe(true);
		expect(repos.has("other-repo")).toBe(true);
		for (const sym of symbols) {
			expect(["test-repo", "other-repo"]).toContain(sym.repo);
		}
	});

	it("rejects SEARCH when both `repo` and `repos` are absent (cross-tenant guard)", async () => {
		const response = await handleCodebaseRead({ query: "createUser", owner: "vheins", json: true }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.code).toBe("REPO_REQUIRED");
		expect(String(data.error)).toMatch(/repo.*repos/i);
	});

	it("keeps single-repo search working (backward compat) and lets `repos` win over `repo`", async () => {
		// `repo` alone still scopes to one repo (backward compatible).
		const single = await handleCodebaseRead(
			{ query: "createUser", repo: "test-repo", owner: "vheins", json: true },
			store,
			vectors
		);
		const singleData = single.structuredContent as Record<string, unknown>;
		const singleSymbols = singleData.symbols as Array<Record<string, unknown>>;
		expect(singleSymbols.length).toBeGreaterThanOrEqual(1);
		for (const sym of singleSymbols) {
			expect(sym.repo).toBe("test-repo");
		}

		// When both are provided, `repos` governs — a session-injected `repo`
		// must not narrow an explicit cross-repo scope.
		const both = await handleCodebaseRead(
			{ query: "createUser", repo: "test-repo", repos: ["other-repo"], owner: "vheins", json: true },
			store,
			vectors
		);
		const bothData = both.structuredContent as Record<string, unknown>;
		const bothSymbols = bothData.symbols as Array<Record<string, unknown>>;
		expect(bothSymbols.length).toBeGreaterThanOrEqual(1);
		for (const sym of bothSymbols) {
			expect(sym.repo).toBe("other-repo");
		}
	});

	it("SEARCH text includes doc_comment per match and omits it when absent (TASK-460)", async () => {
		const { getPrimaryTextContent } = await import("../../utils/mcp-response.js");
		const res = await handleCodebaseRead(
			{ query: "createUser", repo: "test-repo", owner: "vheins", json: true },
			store,
			vectors
		);
		const text = getPrimaryTextContent(res);
		// createUser has doc_comment "Creates a new user" — surfaced as suffix in text lines.
		expect(text).toMatch(/Creates a new user/);
		// internalHelper has no doc_comment — its SEARCH line must not have " — " suffix.
		const internalRes = await handleCodebaseRead(
			{ query: "internalHelper", repo: "test-repo", owner: "vheins", json: true },
			store,
			vectors
		);
		const internalText = getPrimaryTextContent(internalRes);
		const line = internalText.split("\n").find((l) => l.includes("internalHelper")) ?? "";
		expect(line).not.toMatch(/ — /);
	});
});
