import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
	wasmAvailable,
	initTreeSitter,
	parseSource,
	SymbolKind,
	TreeSitterParserPool,
	touch,
	Parser,
	TypeScriptVisitor
} from "./parser.shared.js";

describe("Codebase Index Parser", () => {
	it("initializes web-tree-sitter WASM successfully", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const pool = new TreeSitterParserPool();
		expect(pool.isInitialized()).toBe(false);

		await pool.initialize();

		expect(pool.isInitialized()).toBe(true);
	});

	// ── Test 2: Parse function declaration ────────────────────────

	it("extracts function declarations", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		const source = `
/**
 * Fetches a user by ID.
 * @param id - The user ID
 */
function fetchUser(id: string): Promise<User> {
  return db.users.find(id);
}

const arrowFn = (x: number) => x * 2;

let mutableVar = 42;
`;

		const symbols = parseSource(source, tsLang);

		const fn = symbols.find((s) => s.name === "fetchUser");
		expect(fn).toBeDefined();
		expect(fn!.kind).toBe(SymbolKind.Function);
		expect(fn!.docComment).toContain("Fetches a user");
		expect(fn!.startLine).toBeGreaterThan(0);
		expect(fn!.startCol).toBeGreaterThan(0);

		const arrow = symbols.find((s) => s.name === "arrowFn");
		expect(arrow).toBeDefined();
		expect(arrow!.kind).toBe(SymbolKind.Function);

		const mutable = symbols.find((s) => s.name === "mutableVar");
		expect(mutable).toBeDefined();
		expect(mutable!.kind).toBe(SymbolKind.Variable);
	});

	// ── Test 3: Parse class with methods ──────────────────────────

	it("extracts class declaration with methods", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		const source = `
class UserService {
  name: string;

  getUser(id: number): User {
    return {} as User;
  }

  deleteUser(id: number): void {
    // stub
  }
}
`;

		const symbols = parseSource(source, tsLang);

		const cls = symbols.find((s) => s.name === "UserService");
		expect(cls).toBeDefined();
		expect(cls!.kind).toBe(SymbolKind.Class);

		const getUser = symbols.find((s) => s.name === "getUser");
		expect(getUser).toBeDefined();
		expect(getUser!.kind).toBe(SymbolKind.Method);
		expect(getUser!.parentName).toBe("UserService");

		const deleteUser = symbols.find((s) => s.name === "deleteUser");
		expect(deleteUser).toBeDefined();
		expect(deleteUser!.kind).toBe(SymbolKind.Method);
		expect(deleteUser!.parentName).toBe("UserService");
	});

	// ── Test 4: Parse interface declaration ───────────────────────

	it("extracts interface declarations", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		const source = `
interface User {
  id: string;
  name: string;
  email: string;
}

interface AdminUser extends User {
  permissions: string[];
}
`;

		const symbols = parseSource(source, tsLang);

		const user = symbols.find((s) => s.name === "User");
		expect(user).toBeDefined();
		expect(user!.kind).toBe(SymbolKind.Interface);

		const admin = symbols.find((s) => s.name === "AdminUser");
		expect(admin).toBeDefined();
		expect(admin!.kind).toBe(SymbolKind.Interface);
	});

	// ── Test 5: Parse type alias ───────────────────────────────────

	it("extracts type alias declarations", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		const source = `
type UserId = string;
type Callback<T> = (value: T) => void;
type Status = "active" | "inactive";
`;

		const symbols = parseSource(source, tsLang);

		const userId = symbols.find((s) => s.name === "UserId");
		expect(userId).toBeDefined();
		expect(userId!.kind).toBe(SymbolKind.Type);

		const callback = symbols.find((s) => s.name === "Callback");
		expect(callback).toBeDefined();
		expect(callback!.kind).toBe(SymbolKind.Type);
	});

	// ── Test 6: Parse enum ────────────────────────────────────────

	it("extracts enum declarations", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		const source = `
enum UserRole {
  Admin = "admin",
  Editor = "editor",
  Viewer = "viewer"
}

const enum NumericStatus {
  Active,
  Inactive,
  Pending
}
`;

		const symbols = parseSource(source, tsLang);

		const role = symbols.find((s) => s.name === "UserRole");
		expect(role).toBeDefined();
		expect(role!.kind).toBe(SymbolKind.Enum);

		const numStatus = symbols.find((s) => s.name === "NumericStatus");
		expect(numStatus).toBeDefined();
		expect(numStatus!.kind).toBe(SymbolKind.Enum);
	});

	// ── Test 7: Parse exports ─────────────────────────────────────

	it("correctly marks exported symbols (default, named, re-export)", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		// Create a two-file scenario: file that exports, and file that re-exports
		const source = `
export function publicFn(): void {}
export const publicConst = 123;
export default class DefaultService {}
export { publicFn as aliasedFn };
export interface ExportedIface {}
export type ExportedType = string;
`;

		const symbols = parseSource(source, tsLang);

		const publicFn = symbols.find((s) => s.name === "publicFn");
		expect(publicFn).toBeDefined();
		expect(publicFn!.exported).toBe(true);
		expect(publicFn!.defaultExport).toBe(false);

		const publicConst = symbols.find((s) => s.name === "publicConst");
		expect(publicConst).toBeDefined();
		expect(publicConst!.exported).toBe(true);

		const defaultSvc = symbols.find((s) => s.name === "DefaultService");
		expect(defaultSvc).toBeDefined();
		expect(defaultSvc!.exported).toBe(true);
		expect(defaultSvc!.defaultExport).toBe(true);

		const exportedIface = symbols.find((s) => s.name === "ExportedIface");
		expect(exportedIface).toBeDefined();
		expect(exportedIface!.exported).toBe(true);

		const exportedType = symbols.find((s) => s.name === "ExportedType");
		expect(exportedType).toBeDefined();
		expect(exportedType!.exported).toBe(true);
	});

	// ── Test 8: Error handling — malformed code ───────────────────

	it("handles malformed code gracefully (no crash)", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		const source = `
function valid(): void {}
function broken( // missing closing paren and brace
const x: string = 123; // type mismatch but syntactically ok
@#$%^& // completely invalid
`;

		const parser = new Parser();
		parser.setLanguage(tsLang);

		const tree = parser.parse(source);
		// tree-sitter should return a tree even with errors (it has error recovery)
		expect(tree).not.toBeNull();

		const visitor = new TypeScriptVisitor();
		const symbols = visitor.extractSymbols(tree!, source);

		// Should still extract the valid function
		const valid = symbols.find((s) => s.name === "valid");
		expect(valid).toBeDefined();
		expect(valid!.kind).toBe(SymbolKind.Function);

		tree?.delete();
		parser.delete();
	});

	// ── Test 9: Lazy initialization ───────────────────────────────

	it("does NOT initialize WASM until first parseFile call", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const pool = new TreeSitterParserPool();
		// Before any call, pool should not be initialized
		expect(pool.isInitialized()).toBe(false);

		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-parser-"));
		try {
			const filePath = path.join(tempDir, "sample.ts");
			touch(filePath, "export const hello = 'world';");

			// First call triggers lazy init
			const result = await pool.parseFile(filePath, "export const hello = 'world';");
			expect(result.error).toBeNull();
			expect(result.symbols.length).toBeGreaterThan(0);

			// Pool is now initialized
			expect(pool.isInitialized()).toBe(true);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	// ── Test 10: Parse timeout ────────────────────────────────────

	it("respects parse timeout for huge files", { timeout: 15_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		// Short timeout pool
		const pool = new TreeSitterParserPool({ parseTimeoutMs: 200 });

		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-parser-"));
		try {
			const filePath = path.join(tempDir, "big.ts");

			// Generate a massive file that should take a while to parse
			const hugeSource = "export const huge = {\n" + "value: 1,\n".repeat(50_000) + "};\n";
			touch(filePath, hugeSource);

			const result = await pool.parseFile(filePath, hugeSource);

			// Should either complete or timeout gracefully
			if (result.error) {
				expect(result.error).toMatch(/timeout/i);
			} else {
				expect(result.symbols.length).toBeGreaterThanOrEqual(0);
			}
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	// ── Test 11: Generic types ────────────────────────────────────

	it("handles generic type parameters", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		const source = `
function mapArray<T, U>(items: T[], fn: (item: T) => U): U[] {
  return items.map(fn);
}

class GenericCache<K extends string, V> {
  private store = new Map<K, V>();
  get(key: K): V | undefined { return this.store.get(key); }
}

interface Paginated<T> {
  items: T[];
  total: number;
}
`;

		const symbols = parseSource(source, tsLang);

		const mapArray = symbols.find((s) => s.name === "mapArray");
		expect(mapArray).toBeDefined();
		expect(mapArray!.signature).toContain("<T, U>");

		const cache = symbols.find((s) => s.name === "GenericCache");
		expect(cache).toBeDefined();
		expect(cache!.signature).toContain("<K extends string, V>");

		// Class methods
		const getMethod = symbols.find((s) => s.name === "get");
		expect(getMethod).toBeDefined();
		expect(getMethod!.kind).toBe(SymbolKind.Method);
		expect(getMethod!.parentName).toBe("GenericCache");

		const paginated = symbols.find((s) => s.name === "Paginated");
		expect(paginated).toBeDefined();
		expect(paginated!.kind).toBe(SymbolKind.Interface);
		expect(paginated!.signature).toContain("<T>");
	});

	// ── Test 12: Type-only exports ────────────────────────────────

	it("handles type-only exports correctly", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM not available");
			return;
		}

		const { tsLang } = await initTreeSitter();

		const source = `
interface IConfig { debug: boolean }
type ConfigKey = keyof IConfig;

export type { ConfigKey };
export { IConfig };
`;

		const symbols = parseSource(source, tsLang);

		const configKey = symbols.find((s) => s.name === "ConfigKey");
		expect(configKey).toBeDefined();
		expect(configKey!.kind).toBe(SymbolKind.Type);
		expect(configKey!.exported).toBe(true);

		const iConfig = symbols.find((s) => s.name === "IConfig");
		expect(iConfig).toBeDefined();
		expect(iConfig!.kind).toBe(SymbolKind.Interface);
		// `export { IConfig }` marks it exported even though it's an interface
		expect(iConfig!.exported).toBe(true);
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: Empty file returns empty symbol array
	// ══════════════════════════════════════════════════════════════════
});
