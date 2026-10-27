import { describe, it, expect, beforeEach } from "vitest";
import { handleCodebaseRead } from "../../tools/codebase.read";
import { createTestStore } from "../../storage/sqlite.js";
import type { SQLiteStore } from "../../storage/sqlite.js";
import type { VectorStore } from "../../types.js";

function noopVectorStore(): VectorStore {
	return {
		async upsert(): Promise<void> {},
		async remove(): Promise<void> {},
		async search(): Promise<[]> {
			return [];
		}
	};
}

function seedSymbols(
	store: SQLiteStore,
	symbols: Array<{
		id?: string;
		repo: string;
		file_path: string;
		name: string;
		kind: string;
		exported?: boolean;
		default_export?: boolean;
		start_line?: number;
		start_col?: number;
		end_line?: number;
		end_col?: number;
		doc_comment?: string;
		signature?: string;
		parent_symbol_id?: string;
	}>
): void {
	store.codebaseSymbols.bulkUpsertSymbols(symbols);
}

describe("handleCodebaseRead (trace mode)", () => {
	let store: SQLiteStore;
	let vectors: VectorStore;
	const repo = "test-repo";

	beforeEach(async () => {
		store = await createTestStore();
		vectors = noopVectorStore();
	});

	it("returns definition for a known symbol", async () => {
		seedSymbols(store, [
			{
				repo,
				file_path: "src/services/auth.ts",
				name: "authenticate",
				kind: "function",
				exported: true,
				default_export: false,
				start_line: 42,
				start_col: 0,
				end_line: 55,
				end_col: 1,
				signature: "function authenticate(token: string): User"
			}
		]);

		const response = await handleCodebaseRead(
			{ name: "authenticate", repo, owner: "vheins", json: true },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toBeUndefined();
		expect(data.symbol).toBeDefined();
		expect((data.symbol as Record<string, unknown>).name).toBe("authenticate");
		expect(data.definition).toEqual({
			file: "src/services/auth.ts",
			line: 42,
			column: 0,
			endLine: 55,
			endColumn: 1
		});
		expect(data.exportChain).toEqual({
			exported: true,
			defaultExport: false
		});
	});

	it("returns disambiguation for ambiguous names", async () => {
		seedSymbols(store, [
			{
				repo,
				file_path: "src/services/auth.ts",
				name: "authenticate",
				kind: "function",
				exported: true,
				start_line: 42,
				start_col: 0,
				doc_comment: "Authenticate a user token"
			},
			{
				repo,
				file_path: "src/legacy/auth.ts",
				name: "authenticate",
				kind: "function",
				exported: false,
				start_line: 10,
				start_col: 0,
				doc_comment: "Legacy authentication"
			}
		]);

		const response = await handleCodebaseRead(
			{ name: "authenticate", repo, owner: "vheins", json: true },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toBeDefined();
		expect(data.code).toBe("AMBIGUOUS_SYMBOL");

		const disamb = data.disambiguation as Array<Record<string, unknown>>;
		expect(disamb.length).toBe(2);
		expect(disamb.map((s) => s.file)).toContain("src/services/auth.ts");
		expect(disamb.map((s) => s.file)).toContain("src/legacy/auth.ts");
	});

	it("returns error for non-existent symbol", async () => {
		seedSymbols(store, [
			{
				repo,
				file_path: "src/services/auth.ts",
				name: "authenticate",
				kind: "function",
				start_line: 42,
				start_col: 0
			}
		]);

		const response = await handleCodebaseRead(
			{ name: "nonexistent", repo, owner: "vheins", json: true },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toContain("nonexistent");
		expect(data.code).toBe("SYMBOL_NOT_FOUND");
	});

	it("references included when flag is true", async () => {
		seedSymbols(store, [
			{
				repo,
				file_path: "src/services/auth.ts",
				name: "authenticate",
				kind: "function",
				exported: true,
				start_line: 42,
				start_col: 0,
				doc_comment: "Main authentication function"
			},
			{
				repo,
				file_path: "src/middleware/auth-middleware.ts",
				name: "authMiddleware",
				kind: "function",
				start_line: 15,
				start_col: 0,
				doc_comment: "Middleware that uses authenticate for request validation"
			},
			{
				repo,
				file_path: "src/services/session.ts",
				name: "refreshSession",
				kind: "function",
				start_line: 80,
				start_col: 0,
				signature: "function refreshSession(auth: typeof authenticate)"
			}
		]);

		const response = await handleCodebaseRead(
			{ name: "authenticate", repo, owner: "vheins", json: true, includeReferences: true },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toBeUndefined();
		expect(data.symbol).toBeDefined();

		const refs = data.references as Array<Record<string, unknown>>;
		expect(refs.length).toBeGreaterThanOrEqual(1);

		// At least one reference from auth-middleware.ts doc comment
		const middlewareRef = refs.find((r) => r.filePath === "src/middleware/auth-middleware.ts");
		expect(middlewareRef).toBeDefined();
		expect(middlewareRef!.context).toContain("authenticate");
	});

	it("references excluded when flag is false", async () => {
		seedSymbols(store, [
			{
				repo,
				file_path: "src/services/auth.ts",
				name: "authenticate",
				kind: "function",
				exported: true,
				start_line: 42,
				start_col: 0,
				doc_comment: "Main authentication function"
			},
			{
				repo,
				file_path: "src/middleware/auth-middleware.ts",
				name: "authMiddleware",
				kind: "function",
				start_line: 15,
				start_col: 0,
				doc_comment: "Middleware that uses authenticate for request validation"
			}
		]);

		const response = await handleCodebaseRead(
			{ name: "authenticate", repo, owner: "vheins", json: true, includeReferences: false },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toBeUndefined();
		expect(data.symbol).toBeDefined();

		const refs = data.references as Array<unknown>;
		expect(refs).toEqual([]);
	});

	// ══════════════════════════════════════════════════════════════════
	// Table-backed call-site references (TASK-236 / issue #64)
	// ══════════════════════════════════════════════════════════════════

	it("returns stored call-site references alongside the definition", async () => {
		// Definition seeded in codebase_symbols.
		seedSymbols(store, [
			{
				repo,
				file_path: "src/services/auth.ts",
				name: "authenticate",
				kind: "function",
				exported: true,
				start_line: 42,
				start_col: 0,
				end_line: 55,
				end_col: 1,
				signature: "function authenticate(token: string): User"
			}
		]);

		// Two call sites stored in codebase_references via the parse pipeline.
		store.codebaseReferences.bulkUpsertReferences(repo, [
			{
				repo,
				symbol_name: "authenticate",
				caller_file: "src/middleware/guard.ts",
				caller_line: 14,
				caller_name: "guardRequest",
				kind: "call"
			},
			{
				repo,
				symbol_name: "authenticate",
				caller_file: "src/services/session.ts",
				caller_line: 88,
				caller_name: "refreshSession",
				kind: "call"
			}
		]);

		const response = await handleCodebaseRead(
			{ name: "authenticate", repo, owner: "vheins", json: true, includeReferences: true },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toBeUndefined();
		expect((data.symbol as Record<string, unknown>).name).toBe("authenticate");
		expect(data.definition).toMatchObject({ file: "src/services/auth.ts", line: 42 });

		const refs = data.references as Array<Record<string, unknown>>;
		// Exactly the two stored call sites (definition excluded from references).
		expect(refs.map((r) => r.filePath).sort()).toEqual(["src/middleware/guard.ts", "src/services/session.ts"]);
		const guard = refs.find((r) => r.filePath === "src/middleware/guard.ts")!;
		expect(guard.startLine).toBe(14);
		expect(guard.kind).toBe("call");
		expect(guard.callerName).toBe("guardRequest");
	});

	it("surfaces hierarchy (parent + children) in trace mode (TASK-300)", async () => {
		// Pipeline-shaped seed: class + methods linked via pre-assigned ids.
		seedSymbols(store, [
			{
				id: "user-service-1",
				repo,
				file_path: "src/services/user.service.ts",
				name: "UserService",
				kind: "class",
				exported: true,
				start_line: 5,
				end_line: 60
			},
			{
				id: "user-service-create",
				repo,
				file_path: "src/services/user.service.ts",
				name: "createUser",
				kind: "method",
				start_line: 10,
				end_line: 22,
				parent_symbol_id: "user-service-1"
			},
			{
				id: "user-service-delete",
				repo,
				file_path: "src/services/user.service.ts",
				name: "deleteUser",
				kind: "method",
				start_line: 30,
				end_line: 42,
				parent_symbol_id: "user-service-1"
			}
		]);

		// Class trace → children list.
		const classResponse = await handleCodebaseRead(
			{ name: "UserService", repo, owner: "vheins", json: true },
			store,
			vectors
		);
		const classData = classResponse.structuredContent as Record<string, unknown>;
		expect(classData.error).toBeUndefined();
		expect(classData.parent).toBeNull();
		const children = classData.children as Array<Record<string, unknown>>;
		expect(children.map((c) => c.name).sort()).toEqual(["createUser", "deleteUser"]);

		// Method trace → parent descriptor.
		const methodResponse = await handleCodebaseRead(
			{ name: "createUser", repo, owner: "vheins", json: true },
			store,
			vectors
		);
		const methodData = methodResponse.structuredContent as Record<string, unknown>;
		expect(methodData.error).toBeUndefined();
		expect(methodData.parent).toEqual({
			id: "user-service-1",
			name: "UserService",
			kind: "class",
			filePath: "src/services/user.service.ts",
			line: 5
		});
		expect(methodData.children).toEqual([]);
	});

	// ── TASK-460 doc_comment text surface ──────────────────────────────

	it("TRACE text includes doc_comment for the symbol (and omits when null)", async () => {
		const { getPrimaryTextContent } = await import("../../utils/mcp-response.js");
		seedSymbols(store, [
			{
				repo,
				file_path: "src/docs/docced.ts",
				name: "doccedFn",
				kind: "function",
				exported: true,
				start_line: 1,
				start_col: 0,
				doc_comment: "Does the docced thing.\n@param x the input",
				signature: "function doccedFn(x: string)"
			},
			{
				repo,
				file_path: "src/docs/nodoc.ts",
				name: "nodocFn",
				kind: "function",
				exported: true,
				start_line: 10,
				start_col: 0,
				doc_comment: undefined,
				signature: "function nodocFn()"
			}
		]);
		const docced = await handleCodebaseRead({ name: "doccedFn", repo, owner: "vheins", json: true }, store, vectors);
		expect(getPrimaryTextContent(docced)).toMatch(/Doc:/);
		expect(getPrimaryTextContent(docced)).toMatch(/Does the docced thing/);

		const nodoc = await handleCodebaseRead({ name: "nodocFn", repo, owner: "vheins", json: true }, store, vectors);
		expect(getPrimaryTextContent(nodoc)).not.toMatch(/Doc:/);
	});
});
