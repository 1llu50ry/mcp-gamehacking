import { describe, it, expect, beforeEach } from "vitest";
import { SQLiteStore, createTestStore } from "../../storage/sqlite";
import { CodebaseReferenceEntity } from "../../entities/codebase-reference";

describe("CodebaseReference Entity", () => {
	let store: SQLiteStore;
	let entity: CodebaseReferenceEntity;

	beforeEach(async () => {
		store = await createTestStore();
		entity = store.codebaseReferences;
	});

	it("bulkUpsertReferences inserts refs and getReferencesBySymbol retrieves them", () => {
		const count = entity.bulkUpsertReferences("test-repo", [
			{
				repo: "test-repo",
				symbol_name: "connect",
				caller_file: "src/a.ts",
				caller_line: 12,
				caller_name: "init",
				kind: "call"
			},
			{
				repo: "test-repo",
				symbol_name: "connect",
				caller_file: "src/b.ts",
				caller_line: 3,
				caller_name: null,
				kind: "call"
			},
			{
				repo: "other-repo",
				symbol_name: "connect",
				caller_file: "src/c.ts",
				caller_line: 1,
				caller_name: null,
				kind: "import"
			}
		]);
		expect(count).toBe(3);

		const refs = entity.getReferencesBySymbol("test-repo", "connect");
		// Only test-repo rows, ordered by file then line.
		expect(refs.length).toBe(2);
		expect(refs[0].caller_file).toBe("src/a.ts");
		expect(refs[0].caller_line).toBe(12);
		expect(refs[0].caller_name).toBe("init");
		expect(refs[0].kind).toBe("call");
		expect(refs[1].caller_file).toBe("src/b.ts");

		// Unknown symbol / wrong repo → empty.
		expect(entity.getReferencesBySymbol("test-repo", "nope")).toEqual([]);
		expect(entity.getReferencesBySymbol("nope-repo", "connect")).toEqual([]);
	});

	it("bulkUpsertReferences round-trips v23 edge-target fields (target_file / target_symbol_id)", () => {
		// Heritage + cross-file import edges (Phase 1.1 / TASK-299): the new
		// target columns are written and read back for every reader.
		const count = entity.bulkUpsertReferences("test-repo", [
			{
				repo: "test-repo",
				symbol_name: "Base",
				caller_file: "src/derived.ts",
				caller_line: 1,
				caller_name: null,
				kind: "extends",
				target_file: "src/base.ts",
				target_symbol_id: "sym-base-1"
			},
			{
				repo: "test-repo",
				symbol_name: "Serializable",
				caller_file: "src/derived.ts",
				caller_line: 1,
				caller_name: null,
				kind: "implements",
				target_file: null,
				target_symbol_id: null
			},
			// Legacy v21-style insert (no target fields) → NULL, not undefined.
			{
				repo: "test-repo",
				symbol_name: "connect",
				caller_file: "src/a.ts",
				caller_line: 12,
				caller_name: "init",
				kind: "call"
			}
		]);
		expect(count).toBe(3);

		// getReferencesBySymbol returns the new kinds + targets typed.
		const extendsRefs = entity.getReferencesBySymbol("test-repo", "Base");
		expect(extendsRefs.length).toBe(1);
		expect(extendsRefs[0].kind).toBe("extends");
		expect(extendsRefs[0].target_file).toBe("src/base.ts");
		expect(extendsRefs[0].target_symbol_id).toBe("sym-base-1");
		expect(extendsRefs[0].caller_name).toBeNull();

		// Explicit NULL targets round-trip as null.
		const implementsRefs = entity.getReferencesBySymbol("test-repo", "Serializable");
		expect(implementsRefs.length).toBe(1);
		expect(implementsRefs[0].kind).toBe("implements");
		expect(implementsRefs[0].target_file).toBeNull();
		expect(implementsRefs[0].target_symbol_id).toBeNull();

		// Legacy insert → NULL targets (not undefined) — typed round-trip holds.
		const callRefs = entity.getReferencesBySymbol("test-repo", "connect");
		expect(callRefs.length).toBe(1);
		expect(callRefs[0].kind).toBe("call");
		expect(callRefs[0].target_file).toBeNull();
		expect(callRefs[0].target_symbol_id).toBeNull();

		// getReferencesByFile also returns the new fields (SELECT * path).
		const fileRefs = entity.getReferencesByFile("test-repo", "src/derived.ts");
		expect(fileRefs.length).toBe(2);
		expect(fileRefs[0].target_symbol_id).toBe("sym-base-1");
	});

	it("deleteReferencesByFile removes only that caller file's refs", () => {
		entity.bulkUpsertReferences("test-repo", [
			{ repo: "test-repo", symbol_name: "fx", caller_file: "src/remove.ts", caller_line: 1, kind: "call" },
			{ repo: "test-repo", symbol_name: "fx", caller_file: "src/remove.ts", caller_line: 9, kind: "call" },
			{ repo: "test-repo", symbol_name: "fx", caller_file: "src/keep.ts", caller_line: 2, kind: "call" }
		]);

		const deleted = entity.deleteReferencesByFile("test-repo", "src/remove.ts");
		expect(deleted).toBe(2);

		const remain = entity.getReferencesBySymbol("test-repo", "fx");
		expect(remain.length).toBe(1);
		expect(remain[0].caller_file).toBe("src/keep.ts");

		// Nonexistent file → 0.
		expect(entity.deleteReferencesByFile("test-repo", "nonexistent.ts")).toBe(0);
	});

	it("transferReferencesFilePath moves a caller file's refs to a new path", () => {
		entity.bulkUpsertReferences("test-repo", [
			{ repo: "test-repo", symbol_name: "fx", caller_file: "old.ts", caller_line: 1, kind: "call" }
		]);

		entity.transferReferencesFilePath("test-repo", "old.ts", "new.ts");

		const refs = entity.getReferencesBySymbol("test-repo", "fx");
		expect(refs.length).toBe(1);
		expect(refs[0].caller_file).toBe("new.ts");
	});

	it("getReferencesByFile returns refs for one caller file", () => {
		entity.bulkUpsertReferences("test-repo", [
			{ repo: "test-repo", symbol_name: "a", caller_file: "src/x.ts", caller_line: 5, kind: "call" },
			{ repo: "test-repo", symbol_name: "a", caller_file: "src/x.ts", caller_line: 1, kind: "call" },
			{ repo: "test-repo", symbol_name: "b", caller_file: "src/y.ts", caller_line: 1, kind: "instantiation" }
		]);

		const fileRefs = entity.getReferencesByFile("test-repo", "src/x.ts");
		expect(fileRefs.length).toBe(2);
		// Ordered by caller_line.
		expect(fileRefs[0].caller_line).toBe(1);
		expect(fileRefs[1].caller_line).toBe(5);
	});

	it("deleteReferencesByRepo removes all refs for the repo only", () => {
		entity.bulkUpsertReferences("del-repo", [
			{ repo: "del-repo", symbol_name: "x", caller_file: "s/a.ts", caller_line: 1, kind: "call" },
			{ repo: "del-repo", symbol_name: "y", caller_file: "s/b.ts", caller_line: 1, kind: "call" }
		]);
		entity.bulkUpsertReferences("keep-repo", [
			{ repo: "keep-repo", symbol_name: "z", caller_file: "s/c.ts", caller_line: 1, kind: "call" }
		]);

		expect(entity.deleteReferencesByRepo("del-repo")).toBe(2);
		expect(entity.getReferencesBySymbol("del-repo", "x")).toEqual([]);
		expect(entity.getReferencesBySymbol("keep-repo", "z").length).toBe(1);
	});

	// ── TASK-319: reference aggregation (dead-code candidates + hotspots) ──

	it("countReferencesBySymbol aggregates per-kind counts for a name set", () => {
		entity.bulkUpsertReferences("agg-repo", [
			{ repo: "agg-repo", symbol_name: "usedFn", caller_file: "src/a.ts", caller_line: 10, kind: "call" },
			{ repo: "agg-repo", symbol_name: "usedFn", caller_file: "src/b.ts", caller_line: 3, kind: "call" },
			{ repo: "agg-repo", symbol_name: "usedFn", caller_file: "src/c.ts", caller_line: 1, kind: "import" },
			{ repo: "agg-repo", symbol_name: "UsedClass", caller_file: "src/d.ts", caller_line: 2, kind: "instantiation" },
			{ repo: "agg-repo", symbol_name: "UsedClass", caller_file: "src/e.ts", caller_line: 4, kind: "extends" },
			{ repo: "other-repo", symbol_name: "usedFn", caller_file: "src/g.ts", caller_line: 1, kind: "call" }
		]);

		const counts = entity.countReferencesBySymbol("agg-repo", ["usedFn", "UsedClass", "deadFn", "missing"]);

		// usedFn: 2 call + 1 import (the other-repo row is scoped out).
		expect(counts.get("usedFn")?.total).toBe(3);
		expect(counts.get("usedFn")?.countsByKind).toEqual({ call: 2, import: 1 });

		// UsedClass: 1 instantiation + 1 extends (heritage counts too).
		expect(counts.get("UsedClass")?.total).toBe(2);
		expect(counts.get("UsedClass")?.countsByKind).toEqual({ instantiation: 1, extends: 1 });

		// deadFn: zero refs of ALL kinds → absent from the map (dead candidate).
		expect(counts.has("deadFn")).toBe(false);
		expect(counts.has("missing")).toBe(false);

		// Empty name set → empty map (no query, nothing returned).
		expect(entity.countReferencesBySymbol("agg-repo", []).size).toBe(0);
	});

	it("getTopReferencedSymbols orders by total ref count DESC with per-kind breakdown", () => {
		entity.bulkUpsertReferences("hot-repo", [
			{ repo: "hot-repo", symbol_name: "mid", caller_file: "src/a.ts", caller_line: 1, kind: "call" },
			{ repo: "hot-repo", symbol_name: "mid", caller_file: "src/b.ts", caller_line: 2, kind: "call" },
			{ repo: "hot-repo", symbol_name: "mid", caller_file: "src/c.ts", caller_line: 3, kind: "call" },
			{ repo: "hot-repo", symbol_name: "top", caller_file: "src/d.ts", caller_line: 1, kind: "call" },
			{ repo: "hot-repo", symbol_name: "top", caller_file: "src/e.ts", caller_line: 1, kind: "call" },
			{ repo: "hot-repo", symbol_name: "top", caller_file: "src/f.ts", caller_line: 1, kind: "call" },
			{ repo: "hot-repo", symbol_name: "top", caller_file: "src/g.ts", caller_line: 1, kind: "call" },
			{ repo: "hot-repo", symbol_name: "top", caller_file: "src/h.ts", caller_line: 1, kind: "import" },
			{ repo: "hot-repo", symbol_name: "low", caller_file: "src/i.ts", caller_line: 1, kind: "instantiation" }
		]);

		const top = entity.getTopReferencedSymbols("hot-repo", 2);

		expect(top.length).toBe(2);
		expect(top[0].symbol_name).toBe("top");
		expect(top[0].total).toBe(5);
		expect(top[0].countsByKind).toEqual({ call: 4, import: 1 });
		expect(top[1].symbol_name).toBe("mid");
		expect(top[1].total).toBe(3);

		// limit slices the tail.
		expect(entity.getTopReferencedSymbols("hot-repo", 10).length).toBe(3);
		// empty repo → empty.
		expect(entity.getTopReferencedSymbols("no-repo", 5)).toEqual([]);
	});

	it("countReferencesByRepo returns the repo-scoped row count (honesty gate)", () => {
		entity.bulkUpsertReferences("cnt-repo", [
			{ repo: "cnt-repo", symbol_name: "a", caller_file: "src/a.ts", caller_line: 1, kind: "call" },
			{ repo: "cnt-repo", symbol_name: "b", caller_file: "src/b.ts", caller_line: 1, kind: "call" },
			{ repo: "other", symbol_name: "a", caller_file: "src/x.ts", caller_line: 1, kind: "call" }
		]);

		expect(entity.countReferencesByRepo("cnt-repo")).toBe(2);
		expect(entity.countReferencesByRepo("other")).toBe(1);
		expect(entity.countReferencesByRepo("empty")).toBe(0);
	});

	it("getReferenceLanguagesByRepo returns caller languages with observed ref rows", () => {
		// Seed codebase_files so the JOIN resolves caller_file → language.
		store.codebaseFiles.upsertFile({
			repo: "lang-repo",
			file_path: "src/a.ts",
			language: "typescript",
			checksum: "c1",
			lines: 5,
			size_bytes: 10
		});
		store.codebaseFiles.upsertFile({
			repo: "lang-repo",
			file_path: "src/b.py",
			language: "python",
			checksum: "c2",
			lines: 5,
			size_bytes: 10
		});
		store.codebaseFiles.upsertFile({
			repo: "lang-repo",
			file_path: "notes.md",
			language: "markdown",
			checksum: "c3",
			lines: 5,
			size_bytes: 10
		});
		entity.bulkUpsertReferences("lang-repo", [
			{ repo: "lang-repo", symbol_name: "x", caller_file: "src/a.ts", caller_line: 1, kind: "call" },
			{ repo: "lang-repo", symbol_name: "x", caller_file: "src/b.py", caller_line: 2, kind: "call" }
		]);

		const langs = entity.getReferenceLanguagesByRepo("lang-repo");
		expect(langs).toEqual(["python", "typescript"]);
		// markdown has no reference rows → excluded (declaration-only).
		expect(langs).not.toContain("markdown");
		// unknown repo → empty.
		expect(entity.getReferenceLanguagesByRepo("never-indexed")).toEqual([]);
	});
});
