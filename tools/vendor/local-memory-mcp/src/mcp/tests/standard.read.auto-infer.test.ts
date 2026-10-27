import { describe, it, expect, beforeEach } from "vitest";
import { SQLiteStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { handleStandardWrite } from "../tools/standard.write";
import { handleStandardRead } from "../tools/standard.read";
import type { VectorStore } from "../types";

// ─── standard-read auto-infer mode detection ──────────────────────────────
// Split out from standard.read.test.ts to keep that file within the 500-line
// maintainability limit. Setup mirrors the original: SQLiteStore(":memory") +
// StubVectorStore.

describe("CSL (Coding Standards Library) — standard-read auto-infer", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(() => {
		db = new SQLiteStore(":memory:");
		vectors = new StubVectorStore(db);
	});

	beforeEach(async () => {
		await handleStandardWrite(
			{
				owner: "test",
				repo: "auto-infer-repo",
				name: "Auto Infer Standard",
				content: "Content for auto-infer testing.",
				language: "typescript",
				stack: ["node"],
				tags: ["auto-infer"],
				metadata: { source: "auto-infer-test" },
				json: true
			},
			db,
			vectors
		);
	});

	it("standard-read auto-infers DETAIL when id is present", async () => {
		const entry = db.standards.search({ repo: "auto-infer-repo", limit: 1, offset: 0 })[0];
		expect(entry).toBeDefined();

		const result = (await handleStandardRead(
			{ id: entry.id, owner: "test", repo: "auto-infer-repo", json: true },
			db,
			vectors
		)) as any;
		expect(result.structuredContent.schema).toBe("standard-read");
		expect(result.structuredContent.mode).toBe("detail");
		expect(result.structuredContent.standard.id).toBe(entry.id);
	});

	it("standard-read auto-infers DETAIL when code is present", async () => {
		const entry = db.standards.search({ repo: "auto-infer-repo", limit: 1, offset: 0 })[0];
		expect(entry).toBeDefined();
		expect(entry.code).toBeDefined();

		const result = (await handleStandardRead(
			{ code: entry.code, owner: "test", repo: "auto-infer-repo", json: true },
			db,
			vectors
		)) as any;
		expect(result.structuredContent.schema).toBe("standard-read");
		expect(result.structuredContent.mode).toBe("detail");
		expect(result.structuredContent.standard.code).toBe(entry.code);
	});

	it("standard-read auto-infers SEARCH when query is present", async () => {
		const result = (await handleStandardRead(
			{ query: "auto-infer", owner: "test", repo: "auto-infer-repo", json: true },
			db,
			vectors
		)) as any;
		expect(result.structuredContent.schema).toBe("standard-read");
		expect(result.structuredContent.count).toBeGreaterThanOrEqual(1);
	});

	it("standard-read auto-infers DETAIL when code is present alongside an empty query", async () => {
		const entry = db.standards.search({ repo: "auto-infer-repo", limit: 1, offset: 0 })[0];
		expect(entry).toBeDefined();
		expect(entry.code).toBeDefined();

		const result = (await handleStandardRead(
			{ query: "", code: entry.code, owner: "test", repo: "auto-infer-repo", json: true },
			db,
			vectors
		)) as any;
		expect(result.structuredContent.mode).toBe("detail");
		expect(result.structuredContent.standard.code).toBe(entry.code);
	});

	it("standard-read auto-infers LIST when only empty-string discriminators are sent", async () => {
		const result = (await handleStandardRead(
			{ query: "", id: "", code: "", owner: "test", repo: "auto-infer-repo", json: true },
			db,
			vectors
		)) as any;
		expect(result.structuredContent.mode).toBe("list");
		expect(result.structuredContent.count).toBeGreaterThanOrEqual(1);
	});

	it("standard-read auto-infers LIST when no id/code/query present", async () => {
		const result = (await handleStandardRead(
			{ owner: "test", repo: "auto-infer-repo", json: true },
			db,
			vectors
		)) as any;
		expect(result.structuredContent.schema).toBe("standard-read");
		expect(result.structuredContent.mode).toBe("list");
		expect(result.structuredContent.count).toBeGreaterThanOrEqual(1);
	});

	it("standard-read auto-infers DETAIL BULK when ids array is present", async () => {
		const entries = db.standards.search({ repo: "auto-infer-repo", limit: 3, offset: 0 });
		const ids = entries.map((e: any) => e.id);

		const result = (await handleStandardRead(
			{ ids, owner: "test", repo: "auto-infer-repo", json: true },
			db,
			vectors
		)) as any;
		expect(result.structuredContent.schema).toBe("standard-read");
		expect(result.structuredContent.count).toBe(ids.length);
	});
});
