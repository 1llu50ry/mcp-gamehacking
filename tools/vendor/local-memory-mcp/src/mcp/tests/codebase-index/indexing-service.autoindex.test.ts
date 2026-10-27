import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCodebaseIndexService } from "../../codebase-index/services/indexing-service.js";
import { clearIndexingRepos } from "../../codebase-index/services/indexing-service.js";
import { autoIndexIfStale } from "../../codebase-index/services/indexing-service.js";
import { indexingRepos } from "../../codebase-index/services/indexing-cache.js";
import type { IndexOptions } from "../../codebase-index/services/indexing-service.js";
import type { IndexResult } from "../../codebase-index/services/indexing-service.js";
import { createTestStore } from "../../storage/sqlite.js";
import type { SQLiteStore } from "../../storage/sqlite.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
	touch,
	waitFor,
	createMockParserPool,
	ParserPool,
	ParseResult,
	SymbolKind
} from "./indexing-service.shared.js";

describe("CodebaseIndexService", () => {
	let store: SQLiteStore;
	let tempDir: string;
	let parserPool: ParserPool;
	let repoDir: string;
	beforeEach(async () => {
		store = await createTestStore();
		parserPool = createMockParserPool();
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-svc-"));
		repoDir = path.join(tempDir, "repo");
		fs.mkdirSync(repoDir, { recursive: true });
	});

	afterEach(() => {
		clearIndexingRepos();
		store.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	function service() {
		return createCodebaseIndexService(store, parserPool);
	}

	async function index(opts?: IndexOptions): Promise<IndexResult> {
		return service().indexRepository("test-repo", repoDir, opts);
	}

	it("permission denied: file skipped with PERMISSION classified error", async () => {
		// Create a parser that throws EACCES-style error
		let permInitialized = false;
		const permPool: ParserPool = {
			async initialize(): Promise<void> {
				permInitialized = true;
			},
			isInitialized(): boolean {
				return permInitialized;
			},
			async parseFile(filePath: string, _sourceCode: string): Promise<ParseResult> {
				const basename = path.basename(filePath);
				if (basename === "restricted.ts") {
					const err = new Error("EACCES: permission denied, open '/restricted.ts'");
					(err as NodeJS.ErrnoException).code = "EACCES";
					throw err;
				}
				return {
					symbols: [
						{
							name: "safeFn",
							kind: SymbolKind.Function,
							startLine: 1,
							startCol: 1,
							endLine: 1,
							endCol: 14,
							signature: "function safeFn()",
							docComment: null,
							exported: false,
							defaultExport: false,
							parentName: null
						}
					],
					error: null,
					durationMs: 0
				};
			}
		};

		const svc = createCodebaseIndexService(store, permPool);

		touch(path.join(repoDir, "safe.ts"), "export const s = 1;\n");
		touch(path.join(repoDir, "restricted.ts"), "// no access\n");

		const result = await svc.indexRepository("test-repo", repoDir);

		expect(result.totalFiles).toBe(2);
		expect(result.parsedFiles).toBe(1); // safe.ts parsed
		expect(result.failedFiles).toBe(1); // restricted.ts permission denied
		expect(result.errorSummary.permissionErrors).toBe(1);
		expect(result.errors[0].filePath).toBe("restricted.ts");
		expect(result.errors[0].error).toContain("permission denied");

		// safe.ts symbols stored
		const safeSymbols = store.codebaseSymbols.getSymbolsByFile("test-repo", "safe.ts");
		expect(safeSymbols.length).toBe(1);
	});

	// ══════════════════════════════════════════════════════════════════
	// 21. Error classification — errorSummary structure
	// ══════════════════════════════════════════════════════════════════

	it("errorSummary: structured classification present in all results", async () => {
		touch(path.join(repoDir, "a.ts"), "export const a = 1;\n");

		const result = await index();

		// Verify errorSummary is present and has expected shape
		expect(result.errorSummary).toBeDefined();
		expect(result.errorSummary.total).toBe(0);
		expect(result.errorSummary.recoverable).toBe(0);
		expect(result.errorSummary.fatal).toBe(0);
		expect(result.errorSummary.timeoutErrors).toBe(0);
		expect(result.errorSummary.permissionErrors).toBe(0);
		expect(result.errorSummary.dbWriteErrors).toBe(0);
	});

	it("errorSummary: mixed errors are counted correctly", async () => {
		const mixedPool = createMockParserPool({ simulateTimeout: true });
		const svc = createCodebaseIndexService(store, mixedPool);

		touch(path.join(repoDir, "t1.ts"), "export const t1 = 1;\n");
		touch(path.join(repoDir, "t2.ts"), "export const t2 = 2;\n");

		const result = await svc.indexRepository("test-repo", repoDir);

		expect(result.errorSummary.total).toBe(2);
		expect(result.errorSummary.timeoutErrors).toBe(2);
		expect(result.errorSummary.permissionErrors).toBe(0);
	});

	// ══════════════════════════════════════════════════════════════════
	// 22. autoIndexIfStale
	// ══════════════════════════════════════════════════════════════════

	it("autoIndexIfStale: returns skipped when index is fresh", async () => {
		touch(path.join(repoDir, "fresh.ts"), "export const f = 1;\n");

		// Index first to set last_indexed_at
		await index();

		// autoIndexIfStale should skip (TTL = 24h by default, index just created)
		const result = await autoIndexIfStale("test-repo", repoDir, store, parserPool);
		expect(result.status).toBe("skipped");
		expect(result.reason).toContain("Index is fresh");
	});

	it("autoIndexIfStale: returns started when no index exists", async () => {
		touch(path.join(repoDir, "first.ts"), "export const x = 1;\n");

		// No index yet — should trigger indexing
		const result = await autoIndexIfStale("test-repo", repoDir, store, parserPool);
		expect(result.status).toBe("started");
		expect(result.reason).toContain("No existing index");

		// Await the fire-and-forget background index (event-driven — the
		// index is dispatched without await, so a fixed sleep would race it).
		await waitFor(() => store.codebaseFiles.getFilesByRepo("test-repo").length > 0);
		await waitFor(() => !indexingRepos.has("test-repo"));

		// Verify index was actually built
		const files = store.codebaseFiles.getFilesByRepo("test-repo");
		expect(files.length).toBeGreaterThan(0);
	});

	it("autoIndexIfStale: returns started when index is stale beyond TTL", async () => {
		touch(path.join(repoDir, "stale.ts"), "export const s = 1;\n");

		// Index first
		await index();

		// autoIndexIfStale with very short TTL (1ms) — index is "stale"
		const result = await autoIndexIfStale("test-repo", repoDir, store, parserPool, { ttlMs: 1 });
		expect(result.status).toBe("started");
		expect(result.reason).toContain("Index TTL expired");

		// Await completion of the fire-and-forget re-index (event-driven).
		// The in-flight guard is added synchronously before the first await
		// (indexing-repository.ts:127), so this poll cannot pass spuriously.
		await waitFor(() => !indexingRepos.has("test-repo"));

		// Verify repo is no longer "auto-indexing" (autoIndexingRepos set was cleared)
		const status = await service().getIndexStatus("test-repo");
		expect(status.isIndexing).toBe(false);
	});

	it("autoIndexIfStale: returns already_indexing when concurrent call is made", async () => {
		touch(path.join(repoDir, "concurrent.ts"), "export const c = 1;\n");

		// First call starts background indexing
		const first = await autoIndexIfStale("test-repo", repoDir, store, parserPool);
		expect(first.status).toBe("started");

		// Second call should see it's already indexing (module-level guard)
		const second = await autoIndexIfStale("test-repo", repoDir, store, parserPool);
		expect(second.status).toBe("already_indexing");
		expect(second.reason).toContain("Index already in progress");

		// Await the first background index to finish so teardown
		// (clearIndexingRepos + store.close) never races it.
		await waitFor(() => !indexingRepos.has("test-repo"));
	});

	it("autoIndexIfStale: respects CODEBASE_AUTO_INDEX=false env var", async () => {
		touch(path.join(repoDir, "disabled.ts"), "export const d = 1;\n");

		const prev = process.env.CODEBASE_AUTO_INDEX;
		process.env.CODEBASE_AUTO_INDEX = "false";
		try {
			const result = await autoIndexIfStale("test-repo", repoDir, store, parserPool);
			expect(result.status).toBe("skipped");
			expect(result.reason).toContain("Auto-index disabled");
		} finally {
			process.env.CODEBASE_AUTO_INDEX = prev;
		}
	});

	it("autoIndexIfStale: respects custom TTL via env var", async () => {
		touch(path.join(repoDir, "envttl.ts"), "export const e = 1;\n");

		// Index first
		await index();

		// Set env TTL to 1ms to force staleness
		const prev = process.env.CODEBASE_AUTO_INDEX_TTL;
		process.env.CODEBASE_AUTO_INDEX_TTL = "1";
		try {
			const result = await autoIndexIfStale("test-repo", repoDir, store, parserPool);
			expect(result.status).toBe("started");
			expect(result.reason).toContain("Index TTL expired");
		} finally {
			process.env.CODEBASE_AUTO_INDEX_TTL = prev;
		}

		// Await the fire-and-forget re-index to finish so teardown
		// (clearIndexingRepos + store.close) never races it.
		await waitFor(() => !indexingRepos.has("test-repo"));
	});

	it("autoIndexIfStale: options.ttlMs overrides env var", async () => {
		touch(path.join(repoDir, "optttl.ts"), "export const o = 1;\n");

		// Index first
		await index();

		// env var says 1ms (stale), but options.ttlMs says 24h (fresh)
		const prev = process.env.CODEBASE_AUTO_INDEX_TTL;
		process.env.CODEBASE_AUTO_INDEX_TTL = "1";
		try {
			const result = await autoIndexIfStale("test-repo", repoDir, store, parserPool, {
				ttlMs: 24 * 60 * 60 * 1000
			});
			expect(result.status).toBe("skipped");
			expect(result.reason).toContain("Index is fresh");
		} finally {
			process.env.CODEBASE_AUTO_INDEX_TTL = prev;
		}
	});

	// ══════════════════════════════════════════════════════════════════
	// 23. checkStaleness — file no longer on disk
	// ══════════════════════════════════════════════════════════════════

	it("checkStaleness: deleted file is counted as stale", async () => {
		touch(path.join(repoDir, "will-delete.ts"), "export const w = 1;\n");
		touch(path.join(repoDir, "stay.ts"), "export const s = 2;\n");

		await index();

		// Delete one file
		fs.unlinkSync(path.join(repoDir, "will-delete.ts"));

		const s = await service().checkStaleness("test-repo", repoDir);
		expect(s.staleFiles).toBe(1);
	});

	it("checkStaleness: below 5% threshold is not stale", async () => {
		// 50 files — 5% = 2.5, so 2 files changed = 4% which is below threshold
		for (let i = 0; i < 50; i++) {
			touch(path.join(repoDir, `bt${i}.ts`), `export const bt${i} = ${i};\n`);
		}

		await index();

		// Modify 2 files = 4% — below 5% threshold
		fs.writeFileSync(path.join(repoDir, "bt0.ts"), "export const bt0 = 999;\n", "utf-8");
		fs.writeFileSync(path.join(repoDir, "bt1.ts"), "export const bt1 = 999;\n", "utf-8");

		const s = await service().checkStaleness("test-repo", repoDir);
		expect(s.staleFiles).toBe(2);
		// 2/50 = 0.04 < 0.05 → NOT stale
		expect(s.stale).toBe(false);
	});

	// ══════════════════════════════════════════════════════════════════
	// 24. getIndexStatus — with staleness
	// ══════════════════════════════════════════════════════════════════

	it("getIndexStatus: skips staleness when repoPath omitted but has index", async () => {
		touch(path.join(repoDir, "status2.ts"), "export const s = 1;\n");

		await index();

		const status = await service().getIndexStatus("test-repo");
		expect(status.isIndexed).toBe(true);
		expect(status.stale).toBeUndefined();
	});

	// ══════════════════════════════════════════════════════════════════
	// 25. Error classification — isPermissionError via message pattern
	// ══════════════════════════════════════════════════════════════════

	it("permission denied: EPERM via message pattern (code lost, detected by message regex)", async () => {
		let permInit = false;
		const msgPermPool: ParserPool = {
			async initialize(): Promise<void> {
				permInit = true;
			},
			isInitialized(): boolean {
				return permInit;
			},
			async parseFile(_filePath: string, _sourceCode: string): Promise<ParseResult> {
				// Throwing with "EACCES" in message so isPermissionError(new Error(msg)) can match.
				// Note: the code property is lost when isPermissionError re-wraps as new Error.
				throw new Error("EACCES: permission denied, open '/restricted'");
			}
		};

		const svc = createCodebaseIndexService(store, msgPermPool);
		touch(path.join(repoDir, "noperm.ts"), "// restricted\n");

		const result = await svc.indexRepository("test-repo", repoDir);
		expect(result.errorSummary.permissionErrors).toBe(1);
		expect(result.failedFiles).toBe(1);
	});

	it("permission denied: EPERM via message match", async () => {
		let permInit = false;
		const codePermPool: ParserPool = {
			async initialize(): Promise<void> {
				permInit = true;
			},
			isInitialized(): boolean {
				return permInit;
			},
			async parseFile(_filePath: string, _sourceCode: string): Promise<ParseResult> {
				const err = new Error("EPERM: operation not permitted, open '/eperm.ts'");
				(err as NodeJS.ErrnoException).code = "EPERM";
				throw err;
			}
		};

		const svc = createCodebaseIndexService(store, codePermPool);
		touch(path.join(repoDir, "eperm.ts"), "// nope\n");

		const result = await svc.indexRepository("test-repo", repoDir);
		expect(result.errorSummary.permissionErrors).toBe(1);
	});

	// ══════════════════════════════════════════════════════════════════
	// 26. Symbol entity edge cases: countLines with empty content
	// ══════════════════════════════════════════════════════════════════

	it("parse timeout: error message detected as timeout", async () => {
		const timeoutTextPool = createMockParserPool();
		// Override parseFile to return a timeout error
		timeoutTextPool.parseFile = async (_fp, _sc) => ({
			symbols: [],
			error: "Parse timeout after 10000ms for: file.ts",
			durationMs: 0
		});

		const svc = createCodebaseIndexService(store, timeoutTextPool);
		touch(path.join(repoDir, "timeout.ts"), "export const infinite = () => { while(true) {} };\n");

		const result = await svc.indexRepository("test-repo", repoDir);
		expect(result.errorSummary.timeoutErrors).toBe(1);
		expect(result.failedFiles).toBe(1);
	});
});
