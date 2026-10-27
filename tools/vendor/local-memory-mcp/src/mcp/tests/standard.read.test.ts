import { describe, it, expect, beforeEach, vi } from "vitest";
import { SQLiteStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { handleStandardWrite } from "../tools/standard.write";
import { handleStandardRead } from "../tools/standard.read";
import { McpResponse } from "../utils/mcp-response";
import type { VectorStore } from "../types";

// ─── standard-read coverage ───────────────────────────────────────────────
// Split out from standard.test.ts (the standard-read half of the CSL suite) to
// keep that file within the 500-line maintainability limit. The standard-delete
// half already lives in the companion standard.delete.test.ts, so it is not
// duplicated here. Setup mirrors the original: SQLiteStore(":memory") +
// StubVectorStore.

describe("CSL (Coding Standards Library) — standard-read", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(() => {
		db = new SQLiteStore(":memory:");
		vectors = new StubVectorStore(db);
	});

	// =========================================================================
	// standard-read — SEARCH mode
	// =========================================================================

	describe("standard-read — search", () => {
		beforeEach(async () => {
			await handleStandardWrite(
				{
					owner: "test",
					name: "React State Management",
					content: "Use Redux or Context API for state.",
					language: "typescript",
					stack: ["react"],
					tags: ["react", "state"],
					metadata: { source: "frontend-guide" },
					json: true
				},
				db,
				vectors
			);

			await handleStandardWrite(
				{
					owner: "test",
					name: "Node Error Handling",
					content: "Use try-catch with proper logging.",
					language: "typescript",
					stack: ["node", "express"],
					tags: ["node", "errors"],
					metadata: { source: "backend-guide" },
					json: true
				},
				db,
				vectors
			);

			await handleStandardWrite(
				{
					owner: "test",
					name: "Python Testing",
					content: "Use pytest for all test cases.",
					language: "python",
					stack: ["pytest"],
					tags: ["python", "testing"],
					metadata: { source: "qa-guide" },
					json: true
				},
				db,
				vectors
			);
		});

		it("returns relevant results for specific stacks", async () => {
			const result = (await handleStandardRead(
				{
					stack: ["react"],
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.schema).toBe("standard-read");
			expect(data.mode).toBe("list");
			expect(data.count).toBeGreaterThan(0);
			expect(data.standards.rows.find((row: any[]) => String(row[2]).includes("React"))).toBeDefined();
		});

		it("returns relevant results for specific languages", async () => {
			const result = (await handleStandardRead(
				{
					language: "python",
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.standards.rows.find((row: any[]) => row[4] === "python")).toBeDefined();
		});

		it("returns empty array for invalid language", async () => {
			const result = (await handleStandardRead(
				{
					language: "nonexistent-language-xyz",
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.standards.rows).toEqual([]);
			expect(data.count).toBe(0);
		});

		it("supports text search by query", async () => {
			const result = (await handleStandardRead(
				{
					query: "error",
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.count).toBeGreaterThan(0);
			expect(result.content?.[0]?.type).toBe("text");
			const text = result.content?.[0]?.type === "text" ? result.content[0].text : "";
			expect(text).toMatch(/^### Results: \d+ standards for "error" \(showing \d+\)$/m);
			expect(text).toMatch(/^\*\*[\w-]+ \(\d+\)\*\*$/m);
			expect(text).toMatch(/^#\d+ \S+ \[\d+\.\d+\] /m);
			expect(text).toContain("Use standard-read with code for full content.");
		});

		it("supports tag filtering", async () => {
			const result = (await handleStandardRead(
				{
					tags: ["testing"],
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.count).toBe(1);
			expect(data.standards.rows[0][2]).toBe("Python Testing");
		});

		it("can return vector-only matches when lexical overlap is weak", async () => {
			const vectorOnlyDb = new SQLiteStore(":memory:");
			const mockVectors: VectorStore = {
				upsert: vi.fn().mockResolvedValue(undefined),
				remove: vi.fn().mockResolvedValue(undefined),
				search: vi.fn().mockResolvedValue([])
			};

			const stored = (await handleStandardWrite(
				{
					owner: "test",
					name: "React Effects",
					content: "Prefer effect cleanup and isolate subscriptions.",
					language: "typescript",
					stack: ["react"],
					tags: ["react", "effects"],
					metadata: { source: "react-docs" },
					json: true
				},
				vectorOnlyDb,
				mockVectors
			)) as McpResponse;

			const standardId = (stored.structuredContent as any).standard.id;
			mockVectors.search = vi.fn().mockResolvedValue([{ id: standardId, score: 0.97 }]);

			const result = (await handleStandardRead(
				{
					query: "subscription teardown guidance",
					json: true
				},
				vectorOnlyDb,
				mockVectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.count).toBe(1);
			expect(data.results.rows[0][1]).toBe(standardId);
		});

		it("ranks exact keyword matches above generic matches and exposes confidence", async () => {
			const rankingDb = new SQLiteStore(":memory:");
			const mockVectors: VectorStore = {
				upsert: vi.fn().mockResolvedValue(undefined),
				remove: vi.fn().mockResolvedValue(undefined),
				search: vi.fn().mockResolvedValue([])
			};

			await handleStandardWrite(
				{
					owner: "test",
					name: "Laravel Service Provider Register Method Responsibility",
					content: "Use register() only for binding services into the container.",
					language: "php",
					stack: ["laravel"],
					tags: ["laravel", "providers"],
					metadata: { source: "laravel-docs" },
					json: true
				},
				rankingDb,
				mockVectors
			);

			await handleStandardWrite(
				{
					owner: "test",
					name: "Laravel Service Container Singleton vs Scoped Binding",
					content: "Use singleton() for app-wide reuse and scoped() for per-lifecycle bindings.",
					language: "php",
					stack: ["laravel"],
					tags: ["laravel", "container", "singleton", "scoped"],
					metadata: { source: "laravel-docs" },
					json: true
				},
				rankingDb,
				mockVectors
			);

			const result = (await handleStandardRead(
				{
					query: "Laravel Service Container Singleton vs Scoped Binding",
					json: true
				},
				rankingDb,
				mockVectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.schema).toBe("standard-read");
			expect(data.mode).toBe("search");
			expect(data.results.columns).toContain("confidence");
			expect(data.results.columns).toContain("matched_terms");
			expect(data.results.rows[0][2]).toBe("Laravel Service Container Singleton vs Scoped Binding");
			expect(["high", "medium"]).toContain(data.results.rows[0][7]);
			expect(String(data.results.rows[0][9])).toContain("singleton");
			expect(String(data.results.rows[0][9])).toContain("scoped");
			const text = result.content?.[0]?.type === "text" ? result.content[0].text : "";
			expect(text).toMatch(
				/^### Results: \d+ standards for "Laravel Service Container Singleton vs Scoped Binding" \(showing \d+\)$/m
			);
			expect(text).toMatch(/^\*\*[\w-]+ \(\d+\)\*\*$/m);
			expect(text).toMatch(/^#\d+ \S+ \[\d+\.\d+\] /m);
		});
	});

	// =========================================================================
	// standard-read — DETAIL mode
	// =========================================================================

	describe("standard-read — detail", () => {
		beforeEach(async () => {
			await handleStandardWrite(
				{
					owner: "test",
					name: "Test Detail Standard",
					content: "Detail mode test content.",
					language: "typescript",
					tags: ["detail", "test"],
					metadata: { source: "detail-test" },
					json: true
				},
				db,
				vectors
			);
		});

		it("retrieves a single standard by id", async () => {
			const all = db.standards.search({ limit: 10, offset: 0 });
			const standardId = all[0].id;

			const result = (await handleStandardRead(
				{
					id: standardId,
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.schema).toBe("standard-read");
			expect(data.mode).toBe("detail");
			expect(data.standard.id).toBe(standardId);
			expect(data.standard.title).toBe("Test Detail Standard");
		});

		it("retrieves a single standard by code", async () => {
			const all = db.standards.search({ limit: 10, offset: 0 });
			const standardCode = all[0].code;

			const result = (await handleStandardRead(
				{
					code: standardCode,
					owner: "test",
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.schema).toBe("standard-read");
			expect(data.mode).toBe("detail");
			expect(data.standard.code).toBe(standardCode);
		});

		it("retrieves multiple standards by ids", async () => {
			// Create a second standard
			await handleStandardWrite(
				{
					owner: "test",
					name: "Second Detail Standard",
					content: "Second detail content.",
					tags: ["detail"],
					metadata: { source: "detail-test" },
					json: true
				},
				db,
				vectors
			);

			const all = db.standards.search({ limit: 10, offset: 0 });
			const ids = all.map((s) => s.id);

			const result = (await handleStandardRead(
				{
					ids,
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.schema).toBe("standard-read");
			expect(data.mode).toBe("detail");
			expect(data.standards).toHaveLength(2);
			expect(data.count).toBe(2);
		});
	});

	// =========================================================================
	// standard-read — LIST mode
	// =========================================================================

	describe("standard-read — list", () => {
		it("lists all standards when no query or id is provided", async () => {
			// Insert 3 standards
			for (let i = 0; i < 3; i++) {
				await handleStandardWrite(
					{
						owner: "test",
						name: `List Standard ${i}`,
						content: `Content for list standard ${i}.`,
						tags: ["list-test"],
						metadata: { source: "list-test" },
						json: true
					},
					db,
					vectors
				);
			}

			const result = (await handleStandardRead(
				{
					limit: 10,
					offset: 0,
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.schema).toBe("standard-read");
			expect(data.mode).toBe("list");
			expect(data.count).toBe(3);
			expect(data.standards.columns).toContain("code");
			expect(data.standards.columns).toContain("title");
			expect(data.standards.rows).toHaveLength(3);
		});
	});
});
