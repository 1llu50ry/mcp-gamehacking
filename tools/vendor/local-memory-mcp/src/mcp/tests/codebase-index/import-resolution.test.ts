import { describe, expect, it } from "vitest";
import type { CodebaseSymbol } from "../../types";
import {
	parseTsconfigJson5,
	resolveImport,
	resolveModuleToFile,
	findExportTarget,
	stripJson5CommentsAndTrailingCommas
} from "../../codebase-index/parser/import-resolution";

/**
 * Unit tests for the import-resolution module (TASK-009 / issue #83).
 *
 * Pure functions over the indexed-file set + symbol surface — no DB, no WASM.
 * Acceptance criteria pinned here:
 *   - `import { User as DomainUser } from './user'` → DomainUser ↦ User
 *     (src/domain/user.ts exported symbol)
 *   - relative imports keep resolving (default + named + aliased)
 *   - tsconfig baseUrl/paths aliases (`@/…`) resolve
 *   - namespace imports resolve to the FILE with a null symbol
 *   - index/barrel resolution (`./domain` → ./domain/index.ts)
 *   - unresolved modules stay VISIBLE with null targets (never dropped)
 */

// ── Fixtures ──────────────────────────────────────────────────────────────

const INDEXED_FILES: ReadonlySet<string> = new Set([
	"src/domain/user.ts",
	"src/domain/index.ts",
	"src/domain/user.js",
	"src/domain/entity.ts",
	"src/app.ts",
	"src/shared/helper.ts",
	"src/lib/utils.ts",
	"src/features/orders/service.ts",
	"src/components/Button.tsx"
]);

function makeSymbol(
	filePath: string,
	name: string,
	exported: boolean,
	id: string,
	defaultExport = false
): CodebaseSymbol {
	return {
		id,
		repo: "test-repo",
		file_path: filePath,
		name,
		kind: "class",
		exported,
		default_export: defaultExport,
		start_line: 1,
		start_col: 1,
		end_line: 1,
		end_col: 1,
		signature: "",
		doc_comment: null,
		parent_symbol_id: null,
		created_at: "",
		updated_at: ""
	};
}

function symbolsByFile(...symbols: CodebaseSymbol[]): Map<string, CodebaseSymbol[]> {
	const map = new Map<string, CodebaseSymbol[]>();
	for (const s of symbols) {
		const arr = map.get(s.file_path) ?? [];
		arr.push(s);
		map.set(s.file_path, arr);
	}
	return map;
}

// A user.ts with an exported `User` class + a default export.
const USER_FILE_SYMBOLS = symbolsByFile(
	makeSymbol("src/domain/user.ts", "User", true, "sym-user"),
	makeSymbol("src/domain/user.ts", "UserRepository", true, "sym-user-repo"),
	makeSymbol("src/domain/user.ts", "createUser", true, "sym-create-user")
);

const TS_CONFIG_PATHS = parseTsconfigJson5(`
{
  // path alias comment
  "compilerOptions": {
    "baseUrl": "src",
    "paths": {
      "@/*": ["*"],
      "@domain/*": ["domain/*"],
    },
  },
}
`);

// ── tsconfig JSON5 parsing ────────────────────────────────────────────────

describe("parseTsconfigJson5", () => {
	it("parses comments + trailing commas and sorts paths longest-first", () => {
		const cfg = parseTsconfigJson5(`
			{
				// line comment
				/* block comment */
				"compilerOptions": {
					"baseUrl": "./src",
					"paths": {
						"@/*": ["*"],
						"@domain/*": ["domain/*"],
						"@lib": ["lib/index.ts"],
					},
				},
			}
		`);
		expect(cfg).not.toBeNull();
		expect(cfg!.baseUrl).toBe("./src");
		// Longest pattern first: '@domain/*' (10) before '@/*' (4) before '@lib' (4) — ties keep insertion order.
		expect(cfg!.patterns.map((p) => p.pattern)).toEqual(["@domain/*", "@lib", "@/*"]);
	});

	it("returns null for unparseable input (graceful degradation)", () => {
		expect(parseTsconfigJson5("not json {")).toBeNull();
		expect(parseTsconfigJson5("")).toBeNull();
	});

	it("handles string literals containing comment-like text and trailing commas", () => {
		const cfg = parseTsconfigJson5(`{ "compilerOptions": { "baseUrl": "src//x", "paths": { "a": ["b"] } } }`);
		expect(cfg).not.toBeNull();
		expect(cfg!.baseUrl).toBe("src//x");
		expect(stripJson5CommentsAndTrailingCommas('{"a": "x/*y*/z",}')).toBe('{"a": "x/*y*/z"}');
	});
});

// ── Module → file resolution ──────────────────────────────────────────────

describe("resolveModuleToFile", () => {
	it("resolves relative specifiers with extension appending", () => {
		expect(resolveModuleToFile("./entity", "src/domain/user.ts", INDEXED_FILES, null)).toBe("src/domain/entity.ts");
	});

	it("resolves relative specifiers with an explicit extension", () => {
		expect(resolveModuleToFile("./user.ts", "src/domain/entity.ts", INDEXED_FILES, null)).toBe("src/domain/user.ts");
		expect(resolveModuleToFile("./user.js", "src/domain/entity.ts", INDEXED_FILES, null)).toBe("src/domain/user.js");
	});

	it("resolves parent-relative specifiers", () => {
		expect(resolveModuleToFile("../../shared/helper", "src/features/orders/service.ts", INDEXED_FILES, null)).toBe(
			"src/shared/helper.ts"
		);
	});

	it("resolves directory imports via index/barrel files", () => {
		expect(resolveModuleToFile("./domain", "src/app.ts", INDEXED_FILES, null)).toBe("src/domain/index.ts");
	});

	it("resolves tsconfig paths aliases against baseUrl (with wildcard substitution)", () => {
		expect(resolveModuleToFile("@/domain/user", "src/app.ts", INDEXED_FILES, TS_CONFIG_PATHS)).toBe(
			"src/domain/user.ts"
		);
		expect(resolveModuleToFile("@domain/user", "src/app.ts", INDEXED_FILES, TS_CONFIG_PATHS)).toBe(
			"src/domain/user.ts"
		);
	});

	it("returns null for unknown relative specifiers (unresolved stays null)", () => {
		expect(resolveModuleToFile("./missing", "src/app.ts", INDEXED_FILES, null)).toBeNull();
		expect(resolveModuleToFile("../../nope", "src/app.ts", INDEXED_FILES, null)).toBeNull();
	});

	it("returns null for relative specifiers with no caller file (visitor-only)", () => {
		expect(resolveModuleToFile("./user", "", INDEXED_FILES, null)).toBeNull();
	});

	it("returns null for aliased specifiers with no tsconfig", () => {
		expect(resolveModuleToFile("@/domain/user", "src/app.ts", INDEXED_FILES, null)).toBeNull();
	});
});

// ── File → exported symbol ────────────────────────────────────────────────

describe("findExportTarget", () => {
	const byFile = symbolsByFile(
		makeSymbol("src/domain/user.ts", "User", true, "sym-user"),
		makeSymbol("src/domain/user.ts", "UserRepository", true, "sym-user-repo"),
		makeSymbol("src/domain/user.ts", "User", false, "sym-user-internal"),
		makeSymbol("src/domain/user.ts", "createUser", true, "sym-create-user")
	);

	it("maps a named import to the exported symbol", () => {
		expect(findExportTarget("src/domain/user.ts", "User", byFile)).toEqual({
			targetFile: "src/domain/user.ts",
			targetSymbolId: "sym-user"
		});
	});

	it("does NOT match unexported same-name symbols (import contract)", () => {
		// Two `User` symbols exist: one exported (sym-user), one internal.
		// findExportTarget picks the exported one — never the internal.
		const target = findExportTarget("src/domain/user.ts", "User", byFile);
		expect(target?.targetSymbolId).toBe("sym-user");
	});

	it("maps a default import to the default-exported symbol", () => {
		const withDefault = symbolsByFile(
			makeSymbol("src/domain/user.ts", "User", true, "sym-user"),
			makeSymbol("src/domain/user.ts", "User", false, "sym-user-def", true)
		);
		expect(findExportTarget("src/domain/user.ts", "default", withDefault)?.targetSymbolId).toBe("sym-user-def");
	});

	it("returns file-only resolution (null symbol) for namespace/side-effect imports", () => {
		expect(findExportTarget("src/domain/user.ts", null, byFile)).toEqual({
			targetFile: "src/domain/user.ts",
			targetSymbolId: null
		});
	});

	it("returns file-only resolution when the imported name is not exported there", () => {
		expect(findExportTarget("src/domain/user.ts", "Ghost", byFile)).toEqual({
			targetFile: "src/domain/user.ts",
			targetSymbolId: null
		});
	});

	it("returns file-only resolution for files with no indexed symbols", () => {
		expect(findExportTarget("src/empty.ts", "User", new Map())).toEqual({
			targetFile: "src/empty.ts",
			targetSymbolId: null
		});
	});
});

// ── Composite resolveImport ───────────────────────────────────────────────

describe("resolveImport", () => {
	it("resolves a named alias to its canonical file + symbol (acceptance: DomainUser → User)", () => {
		// `import { User as DomainUser } from '@/domain/user'` in src/app.ts:
		// the path alias resolves the module, the imported name 'User' maps to
		// the exported symbol in src/domain/user.ts.
		const res = resolveImport(
			"@/domain/user",
			"src/app.ts",
			INDEXED_FILES,
			USER_FILE_SYMBOLS,
			TS_CONFIG_PATHS,
			"User" // importedName as written in the module
		);
		expect(res).toEqual({ targetFile: "src/domain/user.ts", targetSymbolId: "sym-user" });
	});

	it("resolves a relative named import from the caller's directory", () => {
		const res = resolveImport("./user", "src/domain/entity.ts", INDEXED_FILES, USER_FILE_SYMBOLS, null, "User");
		expect(res).toEqual({ targetFile: "src/domain/user.ts", targetSymbolId: "sym-user" });
	});

	it("resolves a default import to the default export", () => {
		const withDefault = symbolsByFile(
			makeSymbol("src/domain/user.ts", "User", true, "sym-user"),
			makeSymbol("src/domain/user.ts", "User", false, "sym-user-def", true)
		);
		const res = resolveImport("@/domain/user", "src/app.ts", INDEXED_FILES, withDefault, TS_CONFIG_PATHS, "default");
		expect(res).toEqual({ targetFile: "src/domain/user.ts", targetSymbolId: "sym-user-def" });
	});

	it("resolves a path alias (baseUrl/paths) to the canonical file + symbol", () => {
		const res = resolveImport("@/domain/user", "src/app.ts", INDEXED_FILES, USER_FILE_SYMBOLS, TS_CONFIG_PATHS, "User");
		expect(res).toEqual({ targetFile: "src/domain/user.ts", targetSymbolId: "sym-user" });
	});

	it("resolves a namespace import to the FILE only (null symbol)", () => {
		const res = resolveImport(
			"@/domain/user",
			"src/app.ts",
			INDEXED_FILES,
			USER_FILE_SYMBOLS,
			TS_CONFIG_PATHS,
			null // namespace/side-effect → file-only
		);
		expect(res).toEqual({ targetFile: "src/domain/user.ts", targetSymbolId: null });
	});

	it("resolves a barrel import through the index file", () => {
		const withBarrel = symbolsByFile(makeSymbol("src/domain/index.ts", "User", true, "sym-user-re-export"));
		const res = resolveImport("./domain", "src/app.ts", INDEXED_FILES, withBarrel, null, "User");
		expect(res).toEqual({ targetFile: "src/domain/index.ts", targetSymbolId: "sym-user-re-export" });
	});

	it("preserves unresolved imports with null targets (never dropped)", () => {
		const res = resolveImport("./ghost-module", "src/app.ts", INDEXED_FILES, USER_FILE_SYMBOLS, null, "User");
		expect(res).toEqual({ targetFile: null, targetSymbolId: null });
	});

	it("resolves the module but leaves the symbol null when the name is not exported there", () => {
		const res = resolveImport(
			"@/domain/user",
			"src/app.ts",
			INDEXED_FILES,
			USER_FILE_SYMBOLS,
			TS_CONFIG_PATHS,
			"MissingSymbol"
		);
		expect(res).toEqual({ targetFile: "src/domain/user.ts", targetSymbolId: null });
	});

	it("never throws for empty / garbage input", () => {
		expect(() => resolveImport("", "src/app.ts", INDEXED_FILES, USER_FILE_SYMBOLS, null, "User")).not.toThrow();
		expect(resolveImport("", "src/app.ts", INDEXED_FILES, USER_FILE_SYMBOLS, null, "User")).toEqual({
			targetFile: null,
			targetSymbolId: null
		});
	});
});
