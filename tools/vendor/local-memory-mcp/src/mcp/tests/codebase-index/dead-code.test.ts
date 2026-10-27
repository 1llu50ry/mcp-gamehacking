/**
 * Dead-code analysis tests (TASK-319).
 *
 * Covers analyzeDeadCode() end-to-end over an in-memory store + tmp-dir
 * fixtures: candidate selection (known unused fn), entry-point exclusion
 * (package.json bin/main/exports, shebang, public-API anchor), output caps,
 * hotspots ordering, and the language-honesty coverage report.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTestStore, SQLiteStore } from "../../storage/sqlite";
import type { CodebaseFile } from "../../types/codebase-file";
import type { CodebaseSymbolInsert } from "../../types/codebase-symbol";
import {
	analyzeDeadCode,
	classifyEntryPoint,
	extractManifestEntries,
	getRepoManifestEntryPaths,
	normalizeLangForEmission,
	readFileFirstLine,
	type DeadCodeBlock
} from "../../codebase-index/services/dead-code";
import { DEAD_CODE_HOTSPOTS_MAX, DEAD_CODE_SCAN_LIMIT, DEAD_CODE_UNREFERENCED_MAX } from "../../utils/constants";

const REPO = "dead-repo";

function makeFile(filePath: string, language: string = "typescript"): CodebaseFile {
	return {
		id: `f-${filePath.replace(/[^\w]/g, "-")}`,
		repo: REPO,
		file_path: filePath,
		language,
		checksum: "abc",
		lines: 20,
		size_bytes: 400,
		last_indexed_at: new Date().toISOString(),
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString()
	};
}

function makeSymbol(
	name: string,
	filePath: string,
	exported: boolean = false,
	parentSymbolId: string | null = null
): CodebaseSymbolInsert {
	return {
		repo: REPO,
		file_path: filePath,
		name,
		kind: "function",
		exported,
		default_export: false,
		start_line: 3,
		start_col: 0,
		parent_symbol_id: parentSymbolId
	};
}

let store: SQLiteStore;
let tmpDir: string;

beforeEach(async () => {
	store = await createTestStore();
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dead-code-test-"));
});

afterEach(() => {
	store.close();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Seed the standard mixed fixture: used + dead + public anchor + entry scripts. */
function seedBasicRepo(): CodebaseFile[] {
	const files = [makeFile("src/app.ts"), makeFile("src/util.ts"), makeFile("src/cli.ts"), makeFile("src/exec.ts")];
	for (const f of files) store.codebaseFiles.upsertFile(f);

	store.codebaseSymbols.bulkUpsertSymbols([
		makeSymbol("usedFn", "src/app.ts", true, null),
		makeSymbol("deadHelper", "src/app.ts", false, null),
		makeSymbol("PublicAnchor", "src/app.ts", true, null),
		makeSymbol("utilDead", "src/util.ts", false, null),
		makeSymbol("cliMain", "src/cli.ts", false, null),
		makeSymbol("execMain", "src/exec.ts", false, null)
	]);

	store.codebaseReferences.bulkUpsertReferences(REPO, [
		{ repo: REPO, symbol_name: "usedFn", caller_file: "src/app.ts", caller_line: 10, kind: "call" },
		{ repo: REPO, symbol_name: "usedFn", caller_file: "src/util.ts", caller_line: 4, kind: "call" },
		{ repo: REPO, symbol_name: "usedFn", caller_file: "src/cli.ts", caller_line: 1, kind: "import" }
	]);

	return files;
}

describe("normalizeLangForEmission", () => {
	it("maps discovery vocab to emitting registry keys", () => {
		expect(normalizeLangForEmission("typescript")).toBe("typescript");
		expect(normalizeLangForEmission("typescriptreact")).toBe("tsx");
		expect(normalizeLangForEmission("javascriptreact")).toBe("tsx");
		expect(normalizeLangForEmission("python")).toBe("python");
		expect(normalizeLangForEmission("go")).toBe("go");
	});

	it("returns null for non-emitting languages", () => {
		expect(normalizeLangForEmission("markdown")).toBeNull();
		expect(normalizeLangForEmission("dockerfile")).toBeNull();
		expect(normalizeLangForEmission("json")).toBeNull();
		expect(normalizeLangForEmission(null)).toBeNull();
	});
});

describe("extractManifestEntries", () => {
	it("handles bin string/object, main, browser and nested exports shapes", () => {
		const entries = extractManifestEntries({
			name: "pkg",
			main: "./dist/index.js",
			browser: { "./dist/index.js": "./src/browser.js", "some-module": false },
			bin: { "dead-cli": "./bin/cli.js" },
			exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" }, "./features": "./src/features.js" }
		});

		const paths = entries.map((e) => `${e.kind}:${e.path}`);
		expect(paths).toContain("bin:bin/cli.js");
		expect(paths).toContain("manifest:dist/index.js"); // value from exports "." import
		expect(paths).toContain("manifest:src/browser.js");
		expect(paths).toContain("manifest:src/features.js");
		expect(paths).toContain("manifest:dist/index.d.ts");
		// ./-prefix stripped; false browser remap dropped.
		expect(paths).not.toContain("manifest:some-module");
		expect(paths.some((p) => p.includes("./"))).toBe(false);
	});

	it("handles string bin and string exports", () => {
		const entries = extractManifestEntries({ bin: "./bin/script.js", exports: "./lib/index.js" });
		expect(entries).toEqual([
			{ path: "bin/script.js", kind: "bin" },
			{ path: "lib/index.js", kind: "manifest" }
		]);
	});

	it("returns empty for non-object or empty input", () => {
		expect(extractManifestEntries(null)).toEqual([]);
		expect(extractManifestEntries({})).toEqual([]);
		expect(extractManifestEntries(42)).toEqual([]);
	});
});

describe("readFileFirstLine + shebang classification", () => {
	it("reads only the first line of a file", () => {
		const file = path.join(tmpDir, "run.sh");
		fs.writeFileSync(file, "#!/usr/bin/env bash\nset -e\necho hi\n");
		expect(readFileFirstLine(file)).toBe("#!/usr/bin/env bash");
	});

	it("returns null for missing files (never fails analysis)", () => {
		expect(readFileFirstLine(path.join(tmpDir, "nope.ts"))).toBeNull();
	});

	it("classifies a shebang file as entry point via classifyEntryPoint", () => {
		fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
		fs.writeFileSync(path.join(tmpDir, "src", "exec.ts"), "#!/usr/bin/env node\nconsole.log(1);\n");
		store.codebaseSymbols.bulkUpsertSymbols([makeSymbol("execMain", "src/exec.ts", false, null)]);
		const sym = store.codebaseSymbols.getSymbolByName(REPO, "execMain");

		const tag = classifyEntryPoint(sym[0], [], tmpDir);
		expect(tag?.type).toBe("shebang");
		expect(tag?.reason).toContain("#!");
	});
});

describe("analyzeDeadCode — candidate selection", () => {
	it("flags only zero-reference top-level symbols as unreferenced (dead helper), used ones excluded", () => {
		const files = seedBasicRepo();

		const block = analyzeDeadCode(store, REPO, null, files);
		const names = block.unreferenced.map((u) => u.name);

		// usedFn has call+import refs → NOT a candidate.
		expect(names).not.toContain("usedFn");
		expect(names).toContain("deadHelper");
		expect(names).toContain("utilDead");
		expect(block.totals.dead).toBe(4); // deadHelper, utilDead, cliMain, execMain
	});

	it("treats a type-only referenced symbol as referenced — NOT dead (TASK-008 / issue #82)", () => {
		// The dead-code fix: a symbol used ONLY as a type annotation (kind
		// 'type', e.g. a DTO referenced from a function parameter/return) has a
		// reference row of kind 'type', so it must NOT appear as a dead-code
		// candidate. Pre-#82 the row set had no 'type' kind and this symbol
		// would have been flagged dead.
		const files = [makeFile("src/app.ts"), makeFile("src/dto.ts")];
		for (const f of files) store.codebaseFiles.upsertFile(f);

		store.codebaseSymbols.bulkUpsertSymbols([
			// NOT exported: an exported symbol with zero references is a
			// public-api anchor (entry point), not a dead-code candidate. This
			// test exercises the type-edge counting, so usedFn must be an
			// internal symbol to be evaluated.
			makeSymbol("usedFn", "src/app.ts", false, null),
			makeSymbol("CreateOrderDto", "src/dto.ts", true, null),
			makeSymbol("trulyDead", "src/app.ts", false, null)
		]);

		// One type edge to CreateOrderDto (parameter role) — the ONLY reference.
		store.codebaseReferences.bulkUpsertReferences(REPO, [
			{
				repo: REPO,
				symbol_name: "CreateOrderDto",
				caller_file: "src/app.ts",
				caller_line: 4,
				caller_name: "usedFn",
				kind: "type",
				role: "parameter"
			}
		]);

		const block = analyzeDeadCode(store, REPO, null, files);
		const names = block.unreferenced.map((u) => u.name);

		// Type-only referenced → excluded from candidates entirely.
		expect(names).not.toContain("CreateOrderDto");
		// usedFn is itself unreferenced by any OTHER symbol → still a candidate.
		expect(names).toContain("usedFn");
		expect(names).toContain("trulyDead");
		expect(block.totals.dead).toBe(2);

		// Hotspots reflect the type edge: CreateOrderDto has refCount 1 with
		// the per-kind breakdown showing type: 1 (visible in TRACE/dead-code).
		const dtoHotspot = block.hotspots.find((h) => h.name === "CreateOrderDto");
		expect(dtoHotspot).toBeDefined();
		expect(dtoHotspot!.refCount).toBe(1);
		expect(dtoHotspot!.topKinds).toEqual({ type: 1 });
	});

	it("orders output dead-first with entry anchors AFTER (public-api anchor tagged)", () => {
		const files = seedBasicRepo();

		const block = analyzeDeadCode(store, REPO, null, files);
		const unreferenced = block.unreferenced;

		// Truly dead first.
		const deadIdx = unreferenced.findIndex((u) => u.name === "deadHelper");
		const anchorIdx = unreferenced.findIndex((u) => u.name === "PublicAnchor");
		expect(deadIdx).toBeGreaterThanOrEqual(0);
		expect(anchorIdx).toBeGreaterThan(deadIdx);

		const anchor = unreferenced[anchorIdx];
		expect(anchor.entryPoint?.type).toBe("public-api");
		expect(anchor.entryPoint?.reason).toContain("public API");
		expect(anchor.kinds).toEqual({ call: 0, instantiation: 0, import: 0, extends: 0, implements: 0, type: 0 });
		// Untagged = truly dead.
		expect(unreferenced[deadIdx].entryPoint).toBeUndefined();
	});

	it("respects the UNREFERENCED cap with truthful totals", () => {
		const files = [makeFile("src/app.ts")];
		store.codebaseFiles.upsertFile(files[0]);
		store.codebaseSymbols.bulkUpsertSymbols([
			makeSymbol("d1", "src/app.ts", false, null),
			makeSymbol("d2", "src/app.ts", false, null),
			makeSymbol("d3", "src/app.ts", false, null),
			makeSymbol("d4", "src/app.ts", false, null),
			makeSymbol("d5", "src/app.ts", false, null)
		]);
		// One ref row so analysis is not gated by the zero-ref honesty check.
		store.codebaseReferences.bulkUpsertReferences(REPO, [
			{ repo: REPO, symbol_name: "live", caller_file: "src/app.ts", caller_line: 1, kind: "call" }
		]);

		const block = analyzeDeadCode(store, REPO, null, files, { unreferencedMax: 2 });
		expect(block.unreferenced.length).toBe(2);
		expect(block.totals.dead).toBe(5); // full count, never misled by the cap
		expect(block.totals.truncated).toBe(true);
	});
});

describe("analyzeDeadCode — entry-point exclusion", () => {
	it("excludes package.json bin + shebang files when repoPath is provided", () => {
		const files = seedBasicRepo();
		fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, "package.json"),
			JSON.stringify({ name: "fixture", bin: { "dead-cli": "cli.ts" }, main: "dist/index.js" })
		);
		fs.writeFileSync(path.join(tmpDir, "src", "exec.ts"), "#!/usr/bin/env node\nmain();\n");

		const block = analyzeDeadCode(store, REPO, tmpDir, files);

		const byName = new Map(block.unreferenced.map((u) => [u.name, u]));
		expect(byName.get("cliMain")?.entryPoint?.type).toBe("bin");
		expect(byName.get("execMain")?.entryPoint?.type).toBe("shebang");
		expect(byName.get("PublicAnchor")?.entryPoint?.type).toBe("public-api");

		// Only deadHelper + utilDead are truly dead now.
		expect(block.totals.dead).toBe(2);
		expect(block.totals.entryExcluded).toBe(3);
	});

	it("without repoPath everything internal is dead; manifest field unchanged (coverage note says why)", () => {
		const files = seedBasicRepo();
		const block = analyzeDeadCode(store, REPO, null, files);

		// cliMain/execMain cannot be excluded without disk access.
		expect(block.unreferenced.find((u) => u.name === "cliMain")?.entryPoint).toBeUndefined();
		expect(block.coverageNote).toContain("repoPath not provided");
	});

	it("invalid repoPath degrades to no entry exclusion (no crash)", () => {
		const files = seedBasicRepo();
		const block = analyzeDeadCode(store, REPO, path.join(tmpDir, "does-not-exist"), files);
		expect(block.coverageNote).not.toContain("repoPath not provided"); // provided (but unreadable) — silently no entries
		expect(block.totals.scanned).toBeGreaterThan(0);
	});
});

describe("analyzeDeadCode — hotspots", () => {
	it("orders hotspots by reference count with per-kind breakdown", () => {
		const files = seedBasicRepo();
		const block = analyzeDeadCode(store, REPO, null, files);

		expect(block.hotspots[0].name).toBe("usedFn");
		expect(block.hotspots[0].refCount).toBe(3);
		expect(block.hotspots[0].topKinds).toEqual({ call: 2, import: 1 });
		expect(block.hotspots[0].file_path).toBe("src/app.ts");
		expect(block.hotspots.length).toBeLessThanOrEqual(DEAD_CODE_HOTSPOTS_MAX);
	});

	it("skips stale ref targets (no current symbol row)", () => {
		const files = [makeFile("src/app.ts")];
		store.codebaseFiles.upsertFile(files[0]);
		store.codebaseReferences.bulkUpsertReferences(REPO, [
			{ repo: REPO, symbol_name: "removedSym", caller_file: "src/app.ts", caller_line: 1, kind: "call" }
		]);

		// No codebase_symbols rows → hotspots empty despite ref rows.
		const block = analyzeDeadCode(store, REPO, null, files);
		expect(block.hotspots).toEqual([]);
	});
});

describe("analyzeDeadCode — language honesty", () => {
	it("reports reliable vs unreliable languages and filters candidates", () => {
		const files = [
			makeFile("src/app.ts", "typescript"),
			makeFile("src/script.py", "python"),
			makeFile("notes.md", "markdown")
		];
		for (const f of files) store.codebaseFiles.upsertFile(f);

		store.codebaseSymbols.bulkUpsertSymbols([
			makeSymbol("tsDead", "src/app.ts", false, null),
			makeSymbol("pyDead", "src/script.py", false, null)
		]);
		// Only typescript emitted ref rows in this index.
		store.codebaseReferences.bulkUpsertReferences(REPO, [
			{ repo: REPO, symbol_name: "live", caller_file: "src/app.ts", caller_line: 1, kind: "call" }
		]);

		const block = analyzeDeadCode(store, REPO, null, files);

		expect(block.languageCoverage.reliable).toEqual(["typescript"]);
		expect(block.languageCoverage.unreliable).toContain("python");
		expect(block.languageCoverage.unreliable).toContain("markdown");

		// python candidate suppressed (declaration-only evidence) — no garbage.
		const names = block.unreferenced.map((u) => u.name);
		expect(names).toContain("tsDead");
		expect(names).not.toContain("pyDead");
	});

	it("suppresses ALL candidates when the index has zero reference rows", () => {
		const files = [makeFile("src/app.ts")];
		store.codebaseFiles.upsertFile(files[0]);
		store.codebaseSymbols.bulkUpsertSymbols([makeSymbol("looksDead", "src/app.ts", false, null)]);

		const block = analyzeDeadCode(store, REPO, null, files);

		expect(block.unreferenced).toEqual([]);
		expect(block.hotspots).toEqual([]);
		expect(block.languageCoverage.reliable).toEqual([]);
		expect(block.coverageNote).toContain("zero reference rows");
	});

	it("produces an empty block for an unindexed repo", () => {
		const block = analyzeDeadCode(store, "never-indexed", null, []);
		expect(block).toEqual<DeadCodeBlock>({
			unreferenced: [],
			hotspots: [],
			languageCoverage: { reliable: [], unreliable: [] },
			totals: { scanned: 0, dead: 0, entryExcluded: 0, truncated: false },
			coverageNote: expect.stringContaining("reliable reference emission: [none]")
		} as unknown as DeadCodeBlock);
	});
});

describe("analyzeDeadCode — SCAN_LIMIT truncation pre-language-filter (TASK-367)", () => {
	it("sets truncated=true when the first scanLimit top-level rows are non-emitting", () => {
		// 550 markdown top-level symbols in files lexically BEFORE src/*.ts
		// (docs/0000.md … docs/0549.md sort before src/app.ts) push the ONLY
		// typescript candidate past the SQL LIMIT 500 → the reliable-language
		// candidate universe is cut with zero scanned rows. An honest report
		// must still surface truncated=true: an empty list here reads "not
		// evaluated", never "no dead code".
		const mdCount = 550;
		const files: CodebaseFile[] = [];
		const symbols: CodebaseSymbolInsert[] = [];
		for (let i = 0; i < mdCount; i++) {
			const filePath = `docs/${String(i).padStart(4, "0")}.md`;
			files.push(makeFile(filePath, "markdown"));
			symbols.push(makeSymbol(`mdDoc${i}`, filePath, false, null));
		}
		files.push(makeFile("src/app.ts", "typescript"));
		symbols.push(makeSymbol("tsDead", "src/app.ts", false, null));
		for (const f of files) store.codebaseFiles.upsertFile(f);
		store.codebaseSymbols.bulkUpsertSymbols(symbols);
		// One typescript ref row — proves the emitter ran in THIS index.
		store.codebaseReferences.bulkUpsertReferences(REPO, [
			{ repo: REPO, symbol_name: "live", caller_file: "src/app.ts", caller_line: 1, kind: "call" }
		]);

		const block = analyzeDeadCode(store, REPO, null, files, { scanLimit: DEAD_CODE_SCAN_LIMIT });

		// The markdown candidates were skipped (declaration-only language) and
		// the typescript candidate was cut by the SQL LIMIT before evaluation.
		expect(block.languageCoverage.reliable).toEqual(["typescript"]);
		expect(block.totals.scanned).toBe(0);
		expect(block.unreferenced).toEqual([]);
		expect(block.totals.truncated).toBe(true);
	});
});

describe("getRepoManifestEntryPaths — mtime cache", () => {
	it("re-parses when package.json mtime changes", () => {
		const pkgPath = path.join(tmpDir, "package.json");
		fs.writeFileSync(pkgPath, JSON.stringify({ main: "./dist/a.js" }));
		expect(getRepoManifestEntryPaths(tmpDir).map((e) => e.path)).toContain("dist/a.js");

		// Same mtime → cache hit (no re-read).
		expect(getRepoManifestEntryPaths(tmpDir).map((e) => e.path)).toContain("dist/a.js");

		// Bump mtime + change content → fresh entries.
		fs.writeFileSync(pkgPath, JSON.stringify({ bin: { cli: "./bin/b.js" } }));
		const future = new Date(Date.now() + 10_000);
		fs.utimesSync(pkgPath, future, future);
		const updated = getRepoManifestEntryPaths(tmpDir).map((e) => `${e.kind}:${e.path}`);
		expect(updated).toContain("bin:bin/b.js");
		expect(updated).not.toContain("dist/a.js");
	});

	it("returns empty for a root without package.json", () => {
		expect(getRepoManifestEntryPaths(path.join(tmpDir, "no-pkg"))).toEqual([]);
	});
});

describe("DEAD_CODE constants", () => {
	it("use the proposed ~20/10 caps", () => {
		expect(DEAD_CODE_UNREFERENCED_MAX).toBe(20);
		expect(DEAD_CODE_HOTSPOTS_MAX).toBe(10);
	});
});
