import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { saveCodebaseRelations, observationText } from "../tools/kg-archivist";
import { createTestStore, SQLiteStore } from "../storage/sqlite";

// ---------------------------------------------------------------------------
// saveCodebaseRelations (TASK-293)
// ---------------------------------------------------------------------------

describe("KG Archivist — saveCodebaseRelations (TASK-293)", () => {
	let db: SQLiteStore;

	beforeEach(async () => {
		db = await createTestStore();
	});

	afterEach(() => {
		db.close();
	});

	function count(sql: string, params: unknown[] = []): number {
		return (db.db.prepare(sql).get(...params) as { cnt: number }).cnt;
	}

	it("creates symbol entities (type = kind) + reference edges for one indexed file", async () => {
		const repo = "kg-test";
		const filePath = "src/order.ts";

		db.codebaseFiles.upsertFile({ repo, file_path: filePath, language: "typescript" });
		db.codebaseSymbols.bulkUpsertSymbols([
			{ repo, file_path: filePath, name: "OrderService", kind: "class" },
			{ repo, file_path: filePath, name: "computeTotal", kind: "function" }
		]);
		db.codebaseReferences.bulkUpsertReferences(repo, [
			{
				repo,
				symbol_name: "computeTotal",
				caller_file: filePath,
				caller_line: 5,
				caller_name: "OrderService",
				kind: "call"
			},
			{ repo, symbol_name: "ExternalDep", caller_file: filePath, caller_line: 9, caller_name: null, kind: "import" }
		]);

		await saveCodebaseRelations({ filePath, owner: "test", repo }, db);

		// Symbol entities typed by the symbol kind, observed under the shared
		// codebase observation text (same as saveExtractions').
		const obsText = observationText("codebase", filePath);
		expect(count("SELECT COUNT(*) as cnt FROM entities WHERE name = 'OrderService' AND type = 'class'")).toBe(1);
		expect(count("SELECT COUNT(*) as cnt FROM entities WHERE name = 'computeTotal' AND type = 'function'")).toBe(1);
		expect(count("SELECT COUNT(*) as cnt FROM observations WHERE observation = ?", [obsText])).toBeGreaterThanOrEqual(
			2
		);

		// caller_name → referenced symbol edge, relation_type = ref kind.
		const callRel = db.db
			.prepare("SELECT relation_type FROM relations WHERE from_entity = 'OrderService' AND to_entity = 'computeTotal'")
			.get() as { relation_type: string } | undefined;
		expect(callRel).toBeDefined();
		expect(callRel!.relation_type).toBe("call");

		// caller_name NULL → the file path is the from endpoint.
		const importRel = db.db
			.prepare("SELECT relation_type FROM relations WHERE from_entity = ? AND to_entity = 'ExternalDep'")
			.get(filePath) as { relation_type: string } | undefined;
		expect(importRel).toBeDefined();
		expect(importRel!.relation_type).toBe("import");
	});

	it("resolves the referenced symbol's type via name lookup (v23 target support)", async () => {
		const repo = "kg-test";
		const callerFile = "src/derived.ts";
		const targetFile = "src/base.ts";

		db.codebaseFiles.upsertFile({ repo, file_path: callerFile, language: "typescript" });
		db.codebaseSymbols.bulkUpsertSymbols([
			{ repo, file_path: callerFile, name: "Derived", kind: "class" },
			// The referenced symbol lives in ANOTHER file — name-based
			// resolution (ADR-002) lets the writer type it as its kind.
			{ repo, file_path: targetFile, name: "Base", kind: "interface" }
		]);
		db.codebaseReferences.bulkUpsertReferences(repo, [
			{
				repo,
				symbol_name: "Base",
				caller_file: callerFile,
				caller_line: 1,
				caller_name: "Derived",
				kind: "extends",
				target_file: targetFile,
				target_symbol_id: "target-base-1"
			}
		]);

		await saveCodebaseRelations({ filePath: callerFile, owner: "test", repo }, db);

		// The edge exists with the heritage kind, and the endpoint upsert
		// types the referenced symbol by its resolved kind (the relations
		// table itself stores no endpoint type columns).
		const rel = db.db
			.prepare("SELECT relation_type FROM relations WHERE from_entity = 'Derived' AND to_entity = 'Base'")
			.get() as { relation_type: string } | undefined;
		expect(rel).toBeDefined();
		expect(rel!.relation_type).toBe("extends");
		expect(count("SELECT COUNT(*) as cnt FROM entities WHERE name = 'Base' AND type = 'interface'")).toBe(1);
	});

	it("emits the file-path→symbol edge for a reference-only file (no symbols, caller_name NULL)", async () => {
		const repo = "kg-test";
		const filePath = "src/entry.ts";

		// Reference-only file: zero extracted symbols, but one call-site row
		// with caller_name NULL (entry-point / side-effect-import / setup
		// file). The enqueue gate (indexing-writer.ts:245
		// `(symbols && symbols.length > 0) || (refs && refs.length > 0)`)
		// enqueues these files, so the relation writer must still emit the
		// caller edge with the FILE PATH as the from endpoint — the standalone
		// symbols===0 early-return previously dropped it silently (TASK-339 /
		// review F2).
		db.codebaseFiles.upsertFile({ repo, file_path: filePath, language: "typescript" });
		db.codebaseReferences.bulkUpsertReferences(repo, [
			{
				repo,
				symbol_name: "initializeApp",
				caller_file: filePath,
				caller_line: 1,
				caller_name: null,
				kind: "call"
			}
		]);

		await saveCodebaseRelations({ filePath, owner: "test", repo }, db);

		// No symbol entities (the file declares none) — but the caller edge
		// exists with the file path as its from endpoint, relation_type = the
		// ref kind.
		const rel = db.db
			.prepare("SELECT relation_type FROM relations WHERE from_entity = ? AND to_entity = 'initializeApp'")
			.get(filePath) as { relation_type: string } | undefined;
		expect(rel).toBeDefined();
		expect(rel!.relation_type).toBe("call");

		// ensureRelation upserts both endpoints: the file-path endpoint is
		// typed by the writer's fromType fallback ('symbol'), and the
		// referenced name is typed via lookup (unresolved here → 'symbol').
		expect(count("SELECT COUNT(*) as cnt FROM entities WHERE name = ?", [filePath])).toBe(1);
		expect(count("SELECT COUNT(*) as cnt FROM entities WHERE name = 'initializeApp'")).toBe(1);
	});

	it("is a no-op for an unknown file or a file with neither symbols nor references", async () => {
		const repo = "kg-test";

		await saveCodebaseRelations({ filePath: "src/ghost.ts", owner: "test", repo }, db);
		expect(count("SELECT COUNT(*) as cnt FROM entities")).toBe(0);
		expect(count("SELECT COUNT(*) as cnt FROM observations")).toBe(0);

		// File exists but declares no symbols AND has no reference rows —
		// both sources empty → nothing to link (a file without symbols but
		// WITH refs is NOT a no-op; covered by the ref-only test above).
		db.codebaseFiles.upsertFile({ repo, file_path: "src/empty.ts", language: "typescript" });
		await saveCodebaseRelations({ filePath: "src/empty.ts", owner: "test", repo }, db);
		expect(count("SELECT COUNT(*) as cnt FROM entities")).toBe(0);
		expect(count("SELECT COUNT(*) as cnt FROM observations")).toBe(0);
	});
});
