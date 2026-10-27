/**
 * Architecture Service Tests.
 *
 * Tests buildArchitecture() for directory tree construction,
 * depth limiting, language breakdown, and top-level exports.
 */

import { describe, it, expect } from "vitest";
import { buildArchitecture, buildArchitectureFromData } from "../../codebase-index/services/architecture-service";
import type { DeadCodeBlock } from "../../codebase-index/services/dead-code";
import type { CodebaseFile } from "../../types/codebase-file";
import type { CodebaseSymbol } from "../../types/codebase-symbol";

// ── Test helpers ──────────────────────────────────────────────────────

function makeFile(filePath: string, language: string = "typescript"): CodebaseFile {
	return {
		id: `id-${filePath.replace(/[/.]/g, "-")}`,
		repo: "test/repo",
		file_path: filePath,
		language,
		checksum: "abc123",
		lines: 50,
		size_bytes: 1024,
		last_indexed_at: new Date().toISOString(),
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString()
	};
}

function makeSymbol(
	name: string,
	kind: string,
	filePath: string,
	exported: boolean = false,
	parentSymbolId: string | null = null
): CodebaseSymbol {
	return {
		id: `sym-${name}-${Math.random().toString(36).slice(2, 6)}`,
		repo: "test/repo",
		file_path: filePath,
		name,
		kind,
		exported,
		default_export: false,
		start_line: 1,
		start_col: 0,
		end_line: 1,
		end_col: 10,
		signature: null,
		doc_comment: null,
		parent_symbol_id: parentSymbolId,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString()
	};
}

// ── Tests ────────────────────────────────────────────────────────────

describe("buildArchitecture", () => {
	it("builds a directory tree from flat file list", () => {
		const files: CodebaseFile[] = [
			makeFile("src/index.ts"),
			makeFile("src/utils/helper.ts"),
			makeFile("src/components/Button.tsx", "typescriptreact"),
			makeFile("README.md", "markdown")
		];

		const result = buildArchitecture(files, [], 3);

		// Root should be a directory
		expect(result.root.type).toBe("directory");
		expect(result.root.children).toBeDefined();
		expect(result.root.children!.length).toBeGreaterThan(0);

		// Should have "src" and "README.md" at top level
		const children = result.root.children!;
		const srcDir = children.find((c) => c.name === "src");
		expect(srcDir).toBeDefined();
		expect(srcDir!.type).toBe("directory");

		const readme = children.find((c) => c.name === "README.md");
		expect(readme).toBeDefined();
		expect(readme!.type).toBe("file");

		// "src" should contain "utils", "components", and "index.ts"
		expect(srcDir!.children).toBeDefined();
		const srcChildren = srcDir!.children!;
		expect(srcChildren.some((c) => c.name === "utils" && c.type === "directory")).toBe(true);
		expect(srcChildren.some((c) => c.name === "components" && c.type === "directory")).toBe(true);
		expect(srcChildren.some((c) => c.name === "index.ts" && c.type === "file")).toBe(true);
	});

	it("respects depth limit by collapsing deeper nodes", () => {
		const files: CodebaseFile[] = [makeFile("a/b/c/d/deep.ts"), makeFile("a/b/shallow.ts")];

		// depth=2: root (0) → a (1) → b (2) — at b, deeper nodes collapse
		const result = buildArchitecture(files, [], 2);

		const rootChildren = result.root.children!;
		expect(rootChildren.length).toBe(1);
		const a = rootChildren[0];
		expect(a.name).toBe("a");
		expect(a.type).toBe("directory");

		const aChildren = a.children!;
		// b should be in a's children
		const b = aChildren.find((c) => c.name === "b");
		expect(b).toBeDefined();
		expect(b!.type).toBe("directory");

		// Inside b (at depth 2), "c" should be collapsed with hasMoreFiles
		const bChildren = b!.children!;
		expect(bChildren.length).toBeGreaterThan(0);

		// c should be a collapsed directory node with hasMoreFiles
		const c = bChildren.find((c) => c.name === "c");
		expect(c).toBeDefined();
		expect(c!.type).toBe("directory");
		expect(c!.hasMoreFiles).toBe(true);
	});

	it("computes accurate language breakdown", () => {
		const files: CodebaseFile[] = [
			makeFile("a.ts", "typescript"),
			makeFile("b.ts", "typescript"),
			makeFile("c.py", "python"),
			makeFile("d.go", "go"),
			makeFile("e.go", "go"),
			makeFile("f.go", "go")
		];

		const result = buildArchitecture(files, [], 3);

		expect(result.summary.languageBreakdown).toEqual({
			typescript: 2,
			python: 1,
			go: 3
		});
	});

	it("returns files with null language under 'unknown'", () => {
		const files: CodebaseFile[] = [makeFile("a.txt", null as unknown as string), makeFile("b.ts", "typescript")];
		// Set language to null for the first file
		files[0].language = null;

		const result = buildArchitecture(files, [], 3);

		expect(result.summary.languageBreakdown.unknown).toBe(1);
		expect(result.summary.languageBreakdown.typescript).toBe(1);
	});

	it("identifies top-level exports (exported symbols with no parent)", () => {
		const symbols: CodebaseSymbol[] = [
			makeSymbol("Internal", "function", "src/a.ts", false, null),
			makeSymbol("Exported", "function", "src/a.ts", true, null),
			makeSymbol("Nested", "function", "src/a.ts", true, "parent-id"),
			makeSymbol("AlsoExported", "class", "src/b.ts", true, null)
		];

		const result = buildArchitecture([makeFile("src/a.ts"), makeFile("src/b.ts")], symbols, 3);

		const topExports = result.summary.topLevelExports;
		expect(topExports.length).toBe(2);
		expect(topExports.map((s) => s.name)).toContain("Exported");
		expect(topExports.map((s) => s.name)).toContain("AlsoExported");
		expect(topExports.map((s) => s.name)).not.toContain("Internal");
		expect(topExports.map((s) => s.name)).not.toContain("Nested");
	});

	it("returns empty structure for empty repo", () => {
		const result = buildArchitecture([], [], 3);

		expect(result.root.type).toBe("directory");
		expect(result.root.children).toBeDefined();
		expect(result.root.children!.length).toBe(0);
		expect(result.summary.totalFiles).toBe(0);
		expect(result.summary.totalSymbols).toBe(0);
		expect(Object.keys(result.summary.languageBreakdown).length).toBe(0);
		expect(result.summary.topLevelExports.length).toBe(0);
	});

	it("summarizes symbol counts correctly at depth boundaries", () => {
		const files: CodebaseFile[] = [makeFile("pkg/sub/deep.ts"), makeFile("pkg/sub/deeper.ts")];
		const symbols: CodebaseSymbol[] = [
			makeSymbol("fnA", "function", "pkg/sub/deep.ts", true, null),
			makeSymbol("fnB", "function", "pkg/sub/deeper.ts", false, null),
			makeSymbol("clsA", "class", "pkg/sub/deep.ts", false, null)
		];

		// depth=1: root (0) → pkg (1) — pkg expanded; sub is collapsed inside pkg
		const result = buildArchitecture(files, symbols, 1);

		const pkg = result.root.children!.find((c) => c.name === "pkg");
		expect(pkg).toBeDefined();
		expect(pkg!.type).toBe("directory");

		// "sub" should be a collapsed directory under pkg with aggregated symbol counts
		const sub = pkg!.children!.find((c) => c.name === "sub");
		expect(sub).toBeDefined();
		expect(sub!.type).toBe("directory");
		expect(sub!.hasMoreFiles).toBe(true);
		expect(sub!.symbolCounts).toBeDefined();
		expect(sub!.symbolCounts!.function).toBe(2);
		expect(sub!.symbolCounts!.class).toBe(1);
	});

	it("respects topLevelExportsLimit", () => {
		const symbols: CodebaseSymbol[] = [];
		for (let i = 0; i < 10; i++) {
			symbols.push(makeSymbol(`Export${i}`, "function", "src/a.ts", true, null));
		}

		const result = buildArchitecture([makeFile("src/a.ts")], symbols, 3, 3);

		expect(result.summary.topLevelExports.length).toBe(3);
	});

	it("sets correct summary counts", () => {
		const files: CodebaseFile[] = [makeFile("a.ts"), makeFile("b.ts"), makeFile("c.ts")];
		const symbols: CodebaseSymbol[] = [
			makeSymbol("fn1", "function", "a.ts", false, null),
			makeSymbol("fn2", "function", "a.ts", false, null),
			makeSymbol("fn3", "function", "b.ts", false, null),
			makeSymbol("fn4", "function", "c.ts", false, null),
			makeSymbol("fn5", "function", "c.ts", false, null)
		];

		const result = buildArchitecture(files, symbols, 3);

		expect(result.summary.totalFiles).toBe(3);
		expect(result.summary.totalSymbols).toBe(5);
	});

	it("handles includeSymbolCounts false by using empty symbols", () => {
		// The handler already controls this — test the service directly
		const files: CodebaseFile[] = [makeFile("a.ts"), makeFile("b.ts")];

		const result = buildArchitecture(files, [], 3);

		expect(result.summary.totalSymbols).toBe(0);
		expect(result.summary.topLevelExports).toEqual([]);
	});

	it("strips leading slashes from file paths", () => {
		const files: CodebaseFile[] = [makeFile("/src/app.ts"), makeFile("src/lib.ts")];

		const result = buildArchitecture(files, [], 3);

		const srcChildren = result.root.children!;
		expect(srcChildren.length).toBe(1);
		expect(srcChildren[0].name).toBe("src");
	});
});

// ── TASK-319: deadCode block passthrough ───────────────────────────────

describe("buildArchitecture deadCode passthrough (TASK-319)", () => {
	const deadCodeBlock: DeadCodeBlock = {
		unreferenced: [],
		hotspots: [],
		languageCoverage: { reliable: ["typescript"], unreliable: [] },
		totals: { scanned: 0, dead: 0, entryExcluded: 0, truncated: false },
		coverageNote: "test block"
	};

	it("buildArchitectureFromData attaches the block when provided", () => {
		const result = buildArchitectureFromData(
			[makeFile("src/a.ts")],
			{ totalSymbols: 0, symbolCountsByFile: new Map(), topLevelExports: [] },
			3,
			deadCodeBlock
		);

		expect(result.deadCode).toBe(deadCodeBlock);
		expect(result.summary.totalFiles).toBe(1); // architecture output unchanged
	});

	it("buildArchitecture (legacy) passes the block through", () => {
		const result = buildArchitecture([makeFile("a.ts")], [], 3, 50, deadCodeBlock);
		expect(result.deadCode).toBe(deadCodeBlock);
	});

	it("omits deadCode when not provided — legacy output unchanged", () => {
		const result = buildArchitecture([makeFile("a.ts")], [], 3);
		expect(result.deadCode).toBeUndefined();
	});
});

// ── TASK-460 doc_comment via architecture handler (ARCH text surface) ──

describe("ARCHITECTURE doc_comment text surface (TASK-460)", () => {
	it("ARCH text includes Top Exports doc lines for docced exports and omits undocced", async () => {
		const { handleCodebaseRead } = await import("../../tools/codebase.read.js");
		const { createTestStore } = await import("../../storage/sqlite.js");
		const { getPrimaryTextContent } = await import("../../utils/mcp-response.js");
		const store = await createTestStore();
		const vectors = {
			async upsert(): Promise<void> {},
			async remove(): Promise<void> {},
			async search(): Promise<[]> {
				return [];
			}
		};
		const repo = "arch-doc-test";
		store.codebaseFiles.upsertFile({ repo, file_path: "src/a.ts", language: "typescript", lines: 10, size_bytes: 100 });
		store.codebaseSymbols.bulkUpsertSymbols([
			{
				repo,
				file_path: "src/a.ts",
				name: "DoccedExport",
				kind: "function",
				exported: true,
				start_line: 1,
				doc_comment: "Does the docced thing"
			},
			{ repo, file_path: "src/a.ts", name: "PlainExport", kind: "function", exported: true, start_line: 5 }
		]);
		const res = await handleCodebaseRead(
			{ repo, owner: "vheins", json: true, includeSymbolCounts: true },
			store as unknown as never,
			vectors as never
		);
		const text = getPrimaryTextContent(res);
		expect(text).toMatch(/DoccedExport/);
		expect(text).toMatch(/Does the docced thing/);
		// PlainExport has no doc_comment — its export line must not carry a " — " doc suffix
		const plainLine = text.split("\n").find((l) => l.includes("PlainExport")) ?? "";
		// PlainExport may appear in counts without a doc-labeled export line — if it does appear there its line has no suffix
		if (plainLine) expect(plainLine).not.toMatch(/ — /);
		store.close();
	});

	it("long doc_comment is truncated with ellipsis (~120 chars) for compact tree mode", async () => {
		const { formatDocComment } = await import("../../utils/doc-comment-format.js");
		const long = "A".repeat(300);
		const out = formatDocComment(long, 120);
		expect(out).not.toBeNull();
		expect(out!.length).toBeLessThanOrEqual(120);
		expect(out!.endsWith("…")).toBe(true);
	});
});
