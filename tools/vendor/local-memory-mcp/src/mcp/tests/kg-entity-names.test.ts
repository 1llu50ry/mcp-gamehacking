/**
 * getEntityNamesByText — direct entity-level unit tests (OPT-PERF-04 NIT).
 *
 * Pins the FTS5 token-index lookup contract introduced by OPT-PERF-04 and
 * the LIMIT-bounded INSTR fallback when the index is absent:
 *
 *   - FTS MATCH + ORDER BY rank (bm25): the entity matching the most
 *     query tokens ranks first
 *   - KG_MAX_CONTEXT_ENTITIES (50) cap truncates the result set
 *   - no-index INSTR fallback is bounded by LIMIT (and repo-scoped)
 *   - results are scoped to the requesting repo
 *
 * Uses createTestStore (in-memory SQLite, migrations incl. v15 FTS index).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SQLiteStore, createTestStore } from "../storage/sqlite";
import { KG_MAX_CONTEXT_ENTITIES } from "../utils/constants";

let db: SQLiteStore;
const REPO = "repo-alpha";

beforeEach(async () => {
	db = await createTestStore();
});

afterEach(() => {
	db?.close();
});

function createEntity(name: string, repo: string = REPO): void {
	db.knowledgeGraph.createEntity({
		name,
		type: "service",
		description: null,
		repo,
		owner: "test",
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString()
	});
}

describe("getEntityNamesByText — FTS MATCH + ORDER BY rank", () => {
	it("returns only names whose tokens overlap the query text, ranked best-match first", () => {
		createEntity("Payment Service"); // matches "payment" AND "service"
		createEntity("Payment Gateway"); // matches "payment"
		createEntity("Auth Service"); //    matches "service"
		createEntity("UnrelatedThing"); //  matches nothing

		const result = db.knowledgeGraph.getEntityNamesByText(REPO, "payment service");

		// Token-boundary, case-insensitive overlap (FTS5 unicode61).
		expect(result).toEqual(expect.arrayContaining(["Payment Service", "Payment Gateway", "Auth Service"]));
		// The entity matching BOTH query tokens ranks first via bm25 ORDER BY rank.
		expect(result[0]).toBe("Payment Service");
		// Unrelated entity is excluded.
		expect(result).not.toContain("UnrelatedThing");
	});

	it("does not substring-match mid-word (token-boundary semantics)", () => {
		createEntity("Payment");
		// "paymentservice" is a single token — "payment service" (2 tokens) must
		// not match it as a contiguous substring (unlike the old INSTR rule).
		createEntity("paymentservice");

		const result = db.knowledgeGraph.getEntityNamesByText(REPO, "paymentservice");
		expect(result).toEqual(["paymentservice"]);
	});

	it("returns no results when the query has no alphanumeric tokens", () => {
		createEntity("Payment");
		expect(db.knowledgeGraph.getEntityNamesByText(REPO, "   !!! +++ ")).toEqual([]);
	});
});

describe("getEntityNamesByText — cap truncation", () => {
	it(`caps results at KG_MAX_CONTEXT_ENTITIES (${KG_MAX_CONTEXT_ENTITIES}) when many names match`, () => {
		// 60 entities all sharing the "item" token.
		for (let i = 0; i < 60; i++) {
			createEntity(`Item ${String(i).padStart(2, "0")}`);
		}

		const result = db.knowledgeGraph.getEntityNamesByText(REPO, "item");
		expect(result).toHaveLength(KG_MAX_CONTEXT_ENTITIES);
	});

	it("honors an explicit smaller limit", () => {
		for (let i = 0; i < 10; i++) {
			createEntity(`Item ${String(i).padStart(2, "0")}`);
		}
		expect(db.knowledgeGraph.getEntityNamesByText(REPO, "item", 3)).toHaveLength(3);
	});
});

describe("getEntityNamesByText — repo scoping", () => {
	it("returns only names from the requested repo", () => {
		// Identical entity names can exist across repositories since v33. This
		// uses distinct names sharing a token to prove both FTS and fallback
		// queries remain repository-scoped.
		createEntity("Payment Service", "repoA");
		createEntity("Payment Gateway", "repoA");
		createEntity("Payment Ledger", "repoB"); // same token, different name

		const result = db.knowledgeGraph.getEntityNamesByText("repoA", "payment");
		expect(result).toContain("Payment Service");
		expect(result).toContain("Payment Gateway");
		// The repoB row must be excluded even though its name token matches.
		expect(result).toHaveLength(2);
		expect(result).not.toContain("Payment Ledger");
	});
});

describe("getEntityNamesByText — no-index INSTR fallback", () => {
	function dropFtsIndex(): void {
		db.db.exec(`
			DROP TRIGGER IF EXISTS entity_names_fts_ai;
			DROP TRIGGER IF EXISTS entity_names_fts_au;
			DROP TRIGGER IF EXISTS entity_names_fts_ad;
			DROP TABLE IF EXISTS entity_names_fts;
		`);
	}

	it("falls back to a LIMIT-bounded INSTR scan when the FTS index is absent", () => {
		createEntity("Alpha");
		createEntity("Beta");
		createEntity("Gamma");
		createEntity("Delta");
		createEntity("Epsilon");
		dropFtsIndex();

		// Queries the entities table with LIMIT even when 100% match.
		const result = db.knowledgeGraph.getEntityNamesByText(REPO, "Alpha Beta Gamma Delta Epsilon", 3);
		expect(result).toHaveLength(3);
	});

	it("keeps the fallback repo-scoped", () => {
		// Same-token names in both repos (PK prevents identical names).
		createEntity("Alpha", "repoA");
		createEntity("Alpha Gateway", "repoB");
		dropFtsIndex();

		const result = db.knowledgeGraph.getEntityNamesByText("repoA", "Alpha", 5);
		expect(result).toEqual(["Alpha"]);
	});

	it("INSTR fallback is substring-based (retains old semantics when index missing)", () => {
		createEntity("Payment Service");
		dropFtsIndex();

		// INSTR is a contiguous substring match of the raw text — the name is a
		// substring of the text → matched (keyword boundary not required).
		const result = db.knowledgeGraph.getEntityNamesByText(REPO, "Check the Payment Service subsystem", 10);
		expect(result).toContain("Payment Service");
	});
});
