import { describe, it, expect, beforeEach } from "vitest";
import { SQLiteStore, createTestStore } from "../../storage/sqlite";
import { CodebaseSymbolEntity } from "../../entities/codebase-symbol";

describe("CodebaseSymbol FTS5 search", () => {
	let store: SQLiteStore;
	let entity: CodebaseSymbolEntity;

	beforeEach(async () => {
		store = await createTestStore();
		entity = store.codebaseSymbols;
	});

	it("searchSymbols ranks via FTS5 BM25 rank (FTS5 primary), not LIKE name order", () => {
		// Regression proof that the FTS5 path is *primary* (issue #61). Both the
		// FTS5 tier (tryFtsSearch -> ORDER BY rank) and the LIKE fallback
		// (likeSearch -> ORDER BY cs.name ASC) match all three symbols via
		// doc_comment. BM25 ranks the highest term-frequency doc first, so the
		// returned order is omegaHandler (5x) -> midHandler (2x) -> alphaHandler
		// (1x). The LIKE fallback would instead order alphabetically:
		// alphaHandler -> midHandler -> omegaHandler. Asserting the BM25 order
		// proves the FTS5 tier ran and its results were served without falling
		// back to LIKE.
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/omega.ts",
				name: "omegaHandler",
				kind: "function",
				doc_comment: "process process process process process"
			},
			{
				repo: "test-repo",
				file_path: "src/mid.ts",
				name: "midHandler",
				kind: "function",
				doc_comment: "process process"
			},
			{
				repo: "test-repo",
				file_path: "src/alpha.ts",
				name: "alphaHandler",
				kind: "function",
				doc_comment: "process"
			}
		]);

		const result = entity.searchSymbols({
			query: "process",
			repo: "test-repo",
			limit: 10
		});

		expect(result.symbols.length).toBe(3);
		expect(result.total).toBe(3);
		expect(result.symbols.map((s) => s.name)).toEqual(["omegaHandler", "midHandler", "alphaHandler"]);
	});
});
