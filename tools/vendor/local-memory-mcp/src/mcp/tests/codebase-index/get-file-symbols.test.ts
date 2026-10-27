/**
 * codebase-read File Mode Tests.
 *
 * Tests handleCodebaseRead with filePath parameter (file mode),
 * covering positive paths, error cases, and ordering.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { handleCodebaseRead } from "../../tools/codebase.read";
import { createTestStore, SQLiteStore } from "../../storage/sqlite";
import { VectorStore } from "../../types";

// ── No-op vector store ──────────────────────────────────────────────────

function noopVectorStore(): VectorStore {
	return {
		async upsert(): Promise<void> {},
		async remove(): Promise<void> {},
		async search(): Promise<[]> {
			return [];
		}
	};
}

// ── Helpers ─────────────────────────────────────────────────────────────

function seedFile(store: SQLiteStore, repo: string, filePath: string): void {
	store.codebaseFiles.upsertFile({
		repo,
		file_path: filePath,
		language: "typescript",
		checksum: "abc123",
		lines: 200,
		size_bytes: 4096
	});
}

function seedSymbols(
	store: SQLiteStore,
	symbols: Array<{
		repo: string;
		file_path: string;
		name: string;
		kind: string;
		exported?: boolean;
		start_line?: number;
		end_line?: number;
		doc_comment?: string;
		signature?: string;
		parent_symbol_id?: string;
	}>
): void {
	store.codebaseSymbols.bulkUpsertSymbols(symbols);
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("handleCodebaseRead (file mode)", () => {
	let store: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(async () => {
		store = await createTestStore();
		vectors = noopVectorStore();
	});

	it("returns symbols for a known file in declaration order", async () => {
		const repo = "test-repo";
		const filePath = "src/services/order.ts";

		seedFile(store, repo, filePath);
		seedSymbols(store, [
			{
				repo,
				file_path: filePath,
				name: "OrderService",
				kind: "class",
				exported: true,
				start_line: 10,
				end_line: 120,
				doc_comment: "Handles order lifecycle",
				signature: "class OrderService"
			},
			{
				repo,
				file_path: filePath,
				name: "calculateTotal",
				kind: "function",
				exported: false,
				start_line: 45,
				end_line: 78,
				doc_comment: "Calculates total amount",
				signature: "function calculateTotal(items: Item[]): number"
			},
			{
				repo,
				file_path: filePath,
				name: "TAX_RATE",
				kind: "constant",
				exported: true,
				start_line: 5,
				end_line: 5,
				signature: "TAX_RATE = 0.15"
			}
		]);

		const response = await handleCodebaseRead({ owner: "vheins", json: true, repo, filePath }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.file).toBeDefined();
		expect((data.file as Record<string, unknown>).path).toBe(filePath);
		expect((data.file as Record<string, unknown>).language).toBe("typescript");
		expect((data.file as Record<string, unknown>).checksum).toBe("abc123");
		expect((data.file as Record<string, unknown>).lines).toBe(200);
		expect((data.file as Record<string, unknown>).sizeBytes).toBe(4096);
		expect((data.file as Record<string, unknown>).lastIndexedAt).toBeTruthy();

		expect(data.total).toBe(3);

		const symbols = data.symbols as Array<Record<string, unknown>>;
		expect(symbols.length).toBe(3);

		// Symbols must be in declaration order (by start_line)
		expect(symbols[0].name).toBe("TAX_RATE");
		expect(symbols[0].start_line).toBe(5);
		expect(symbols[1].name).toBe("OrderService");
		expect(symbols[1].start_line).toBe(10);
		expect(symbols[2].name).toBe("calculateTotal");
		expect(symbols[2].start_line).toBe(45);

		// Verify all symbol fields present
		const firstSym = symbols[0];
		expect(firstSym.id).toBeTruthy();
		expect(firstSym.repo).toBe(repo);
		expect(firstSym.file_path).toBe(filePath);
		expect(firstSym.name).toBe("TAX_RATE");
		expect(firstSym.kind).toBe("constant");
		expect(firstSym.exported).toBe(true);
		expect(firstSym.default_export).toBe(false);
		expect(firstSym.signature).toBe("TAX_RATE = 0.15");
	});

	it("returns error for a non-indexed file", async () => {
		const repo = "test-repo";
		const filePath = "src/ghost.ts";

		const response = await handleCodebaseRead({ owner: "vheins", json: true, repo, filePath }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toBe("File not indexed. Run index_repository first.");
		expect(data.code).toBe("FILE_NOT_INDEXED");
	});

	it("returns error for a file in a different repo", async () => {
		const repoA = "repo-a";
		const repoB = "repo-b";
		const filePath = "src/shared.ts";

		seedFile(store, repoA, filePath);
		seedSymbols(store, [
			{ repo: repoA, file_path: filePath, name: "sharedFn", kind: "function", start_line: 1, end_line: 5 }
		]);

		const response = await handleCodebaseRead({ owner: "vheins", json: true, repo: repoB, filePath }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.error).toBe("File not indexed. Run index_repository first.");
		expect(data.code).toBe("FILE_NOT_INDEXED");
	});

	it("returns symbols with parent_symbol_id for nested declarations", async () => {
		const repo = "test-repo";
		const filePath = "src/container.ts";

		seedFile(store, repo, filePath);
		seedSymbols(store, [
			{
				repo,
				file_path: filePath,
				name: "Container",
				kind: "class",
				exported: true,
				start_line: 1,
				end_line: 50
			}
		]);

		// Fetch the parent symbol ID to reference it
		const parentSymbols = store.codebaseSymbols.getSymbolsByFile(repo, filePath);
		const parentId = parentSymbols[0].id;

		seedSymbols(store, [
			{
				repo,
				file_path: filePath,
				name: "resolve",
				kind: "method",
				start_line: 10,
				end_line: 20,
				parent_symbol_id: parentId,
				signature: "resolve<T>(token: string): T"
			}
		]);

		const response = await handleCodebaseRead({ owner: "vheins", json: true, repo, filePath }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.total).toBe(2);

		const symbols = data.symbols as Array<Record<string, unknown>>;
		expect(symbols[0].name).toBe("Container");
		expect(symbols[0].parent_symbol_id).toBeNull();

		expect(symbols[1].name).toBe("resolve");
		expect(symbols[1].kind).toBe("method");
		expect(symbols[1].parent_symbol_id).toBe(parentId);
		expect(symbols[1].signature).toBe("resolve<T>(token: string): T");
	});

	it("returns empty symbols array for file with no symbols", async () => {
		const repo = "test-repo";
		const filePath = "src/empty.ts";

		seedFile(store, repo, filePath);

		const response = await handleCodebaseRead({ owner: "vheins", json: true, repo, filePath }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.file).toBeDefined();
		expect(data.total).toBe(0);
		expect(data.symbols).toEqual([]);
	});

	it("returns REPO_REQUIRED structured response on missing repo param", async () => {
		const response = await handleCodebaseRead({ owner: "vheins", json: true, filePath: "src/test.ts" }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.code).toBe("REPO_REQUIRED");
		expect(String(data.error)).toMatch(/repo/i);
	});

	it("returns REPO_REQUIRED structured response on missing filePath param", async () => {
		// Without filePath, it falls into status mode (no error), but with filePath it's file mode.
		// File mode without repo returns a structured REPO_REQUIRED response.
		const response = await handleCodebaseRead({ owner: "vheins", json: true, filePath: "src/test.ts" }, store, vectors);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.code).toBe("REPO_REQUIRED");
		expect(String(data.error)).toMatch(/repo/i);
	});

	it("throws on empty repo", async () => {
		await expect(
			handleCodebaseRead({ owner: "vheins", json: true, repo: "", filePath: "src/test.ts" }, store, vectors)
		).rejects.toThrow();
	});

	it("falls back to architecture mode when filePath is empty", async () => {
		const response = await handleCodebaseRead(
			{ owner: "vheins", json: true, repo: "test-repo", filePath: "" },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;
		expect(data.mode).toBe("architecture");
	});

	it("FILE text includes doc_comment suffix and omits it when absent (TASK-460)", async () => {
		const { getPrimaryTextContent } = await import("../../utils/mcp-response.js");
		const repo = "doc-file-repo";
		const filePath = "src/docced.ts";
		seedFile(store, repo, filePath);
		seedSymbols(store, [
			{
				repo,
				file_path: filePath,
				name: "doccedFn",
				kind: "function",
				start_line: 1,
				end_line: 5,
				doc_comment: "Does the thing"
			},
			{ repo, file_path: filePath, name: "plainFn", kind: "function", start_line: 10, end_line: 12 }
		]);
		const res = await handleCodebaseRead({ owner: "vheins", json: true, repo, filePath }, store, vectors);
		const text = getPrimaryTextContent(res);
		expect(text).toMatch(/doccedFn/);
		expect(text).toMatch(/Does the thing/);
		// plainFn line must not have a trailing " — " doc suffix after its entry
		expect(text).toMatch(/plainFn/);
		const plainLine = text.split("\n").find((l) => l.includes("plainFn")) ?? "";
		expect(plainLine).not.toMatch(/ — /);
	});
});
