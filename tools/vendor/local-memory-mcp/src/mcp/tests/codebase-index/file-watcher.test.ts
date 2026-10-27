/**
 * File watcher (TASK-322 / US-08) — polling sweep over autoIndexIfStale.
 *
 * Unit + integration (scoped): real temp dirs + real SQLiteStore (in-memory),
 * mocked ParserPool (WASM unavailable in test/CI). Covers the sweep decision
 * lattice (unindexed / fresh / unresolvable / in-flight / trigger), the
 * short-TTL staleness trigger, the mtime-skip no-op, and the FileWatcher
 * lifecycle (env gate + start/stop loop).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
	FileWatcher,
	registerRepo,
	clearWatchedRepos,
	listWatchedRepos,
	sweepWatchedRepos,
	isFileWatcherEnabled
} from "../../codebase-index/services/file-watcher";
import { createCodebaseIndexService, clearIndexingRepos } from "../../codebase-index/services/indexing-service";
import { indexingRepos } from "../../codebase-index/services/indexing-cache";
import type { ParserPool, ParseResult, ParsedSymbol } from "../../codebase-index/parser/language-visitor";
import { SymbolKind } from "../../codebase-index/parser/language-visitor";
import { createTestStore, SQLiteStore } from "../../storage/sqlite";
import { FILE_WATCH_TTL_MS } from "../../utils/constants";

// ── Helpers ────────────────────────────────────────────────────────────

function touch(filePath: string, content: string): void {
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
}

/** Mock ParserPool — returns one symbol per file named after the file stem. */
function createMockParserPool(): ParserPool {
	let initialized = false;
	return {
		async initialize(): Promise<void> {
			initialized = true;
		},
		isInitialized(): boolean {
			return initialized;
		},
		async parseFile(filePath: string, _sourceCode: string): Promise<ParseResult> {
			const stem = path.parse(path.basename(filePath)).name;
			const symbols: ParsedSymbol[] = [
				{
					name: stem,
					kind: SymbolKind.Function,
					startLine: 1,
					startCol: 1,
					endLine: 1,
					endCol: stem.length + 8,
					signature: `function ${stem}()`,
					docComment: `Documentation for ${stem}`,
					exported: true,
					defaultExport: false,
					parentName: null
				}
			];
			return { symbols, error: null, durationMs: 0 };
		}
	};
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error("waitFor timed out");
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

// ── Test suite ─────────────────────────────────────────────────────────

describe("FileWatcher (polling sweep, TASK-322)", () => {
	let store: SQLiteStore;
	let parserPool: ParserPool;
	let tempDir: string;
	let repoDir: string;
	const REPO = "watch-repo";
	let prevWatchEnv: string | undefined;
	let prevAutoIndexEnv: string | undefined;

	beforeEach(async () => {
		store = await createTestStore();
		parserPool = createMockParserPool();
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fw-test-"));
		repoDir = path.join(tempDir, "repo");
		fs.mkdirSync(repoDir, { recursive: true });
		prevWatchEnv = process.env.ENABLE_FILE_WATCHER;
		prevAutoIndexEnv = process.env.CODEBASE_AUTO_INDEX;
		delete process.env.ENABLE_FILE_WATCHER;
		delete process.env.CODEBASE_AUTO_INDEX;
	});

	afterEach(() => {
		clearIndexingRepos();
		clearWatchedRepos();
		store.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
		vi.useRealTimers();
		if (prevWatchEnv === undefined) delete process.env.ENABLE_FILE_WATCHER;
		else process.env.ENABLE_FILE_WATCHER = prevWatchEnv;
		if (prevAutoIndexEnv === undefined) delete process.env.CODEBASE_AUTO_INDEX;
		else process.env.CODEBASE_AUTO_INDEX = prevAutoIndexEnv;
	});

	function service() {
		return createCodebaseIndexService(store, parserPool);
	}

	async function indexRepo(repo = REPO, dir = repoDir): Promise<void> {
		await service().indexRepository(repo, dir);
	}

	// ══════════════════════════════════════════════════════════════════
	// Registry
	// ══════════════════════════════════════════════════════════════════

	it("registerRepo: stores resolved path; re-registration is idempotent", () => {
		registerRepo(REPO, path.join(tempDir, "..", "fw-test-x", "repo"));
		const entry = listWatchedRepos().get(REPO);
		expect(entry).toBeDefined();
		expect(entry!.repoPath).toBe(path.resolve(tempDir, "..", "fw-test-x", "repo"));

		// Same path again — no duplicate, timestamp untouched.
		const firstRegisteredAt = entry!.registeredAt;
		registerRepo(REPO, path.resolve(tempDir, "..", "fw-test-x", "repo"));
		expect(listWatchedRepos().size).toBe(1);
		expect(listWatchedRepos().get(REPO)!.registeredAt).toBe(firstRegisteredAt);

		// Different path — updated in place.
		registerRepo(REPO, repoDir);
		expect(listWatchedRepos().size).toBe(1);
		expect(listWatchedRepos().get(REPO)!.repoPath).toBe(path.resolve(repoDir));
	});

	it("registerRepo/clearWatchedRepos: registry bookkeeping", () => {
		registerRepo("a", repoDir);
		registerRepo("b", repoDir);
		expect(listWatchedRepos().size).toBe(2);
		clearWatchedRepos();
		expect(listWatchedRepos().size).toBe(0);
	});

	// ══════════════════════════════════════════════════════════════════
	// Sweep decision lattice
	// ══════════════════════════════════════════════════════════════════

	it("skips repos never indexed — never indexes unrequested repos", async () => {
		touch(path.join(repoDir, "a.ts"), "export function a() {}\n");
		registerRepo(REPO, repoDir);

		const outcome = await sweepWatchedRepos(store, parserPool);
		expect(outcome.skippedUnindexed).toContain(REPO);
		expect(outcome.triggered).not.toContain(REPO);
		// No index was built for the unrequested repo.
		expect(store.codebaseFiles.getFilesByRepo(REPO).length).toBe(0);
	});

	it("short-TTL staleness triggers re-index; new symbol appears (integration)", async () => {
		touch(path.join(repoDir, "existing.ts"), "export function existing() {}\n");
		registerRepo(REPO, repoDir);
		await indexRepo();

		// Modify the repo AFTER the first index: add a file.
		touch(path.join(repoDir, "added.ts"), "export function added() {}\n");

		// Sweep with a short TTL (0) — the registered repo is stale → triggered.
		const outcome = await sweepWatchedRepos(store, parserPool, { ttlMs: 0 });
		expect(outcome.triggered).toContain(REPO);
		expect(outcome.skippedFresh).not.toContain(REPO);

		// Fire-and-forget index completes in the background → new symbol appears.
		await waitFor(() => store.codebaseSymbols.getSymbolsByRepo(REPO).some((s) => s.name === "added"));
	});

	it("no-op when index is fresh — TTL cap prevents re-entry", async () => {
		touch(path.join(repoDir, "a.ts"), "export function a() {}\n");
		registerRepo(REPO, repoDir);
		await indexRepo();

		// Default TTL: the repo was registered (and its last trigger dispatch
		// recorded) moments ago → the in-memory cap marks it fresh.
		const outcome = await sweepWatchedRepos(store, parserPool); // default TTL (FILE_WATCH_TTL_MS)
		expect(outcome.skippedFresh).toContain(REPO);
		expect(outcome.triggered).not.toContain(REPO);
	});

	it("no-op when untouched — triggered run parses zero files (mtime skip)", async () => {
		touch(path.join(repoDir, "a.ts"), "export function a() {}\n");
		touch(path.join(repoDir, "b.ts"), "export function b() {}\n");
		registerRepo(REPO, repoDir);
		await indexRepo();
		const symbolCountBefore = store.codebaseSymbols.getSymbolCountByRepo(REPO);
		expect(symbolCountBefore).toBe(2);

		// Force the trigger (TTL 0) but leave files untouched.
		const outcome = await sweepWatchedRepos(store, parserPool, { ttlMs: 0 });
		expect(outcome.triggered).toContain(REPO);

		// Wait for the background incremental run to finish, then verify the
		// mtime pre-filter skipped every file: no new/duplicate symbols.
		await waitFor(() => !indexingRepos.has(REPO));
		expect(store.codebaseSymbols.getSymbolCountByRepo(REPO)).toBe(symbolCountBefore);
	});

	it("steady state: zero-parse run must NOT re-trigger — in-memory gate (TASK-354)", async () => {
		touch(path.join(repoDir, "a.ts"), "export function a() {}\n");
		touch(path.join(repoDir, "b.ts"), "export function b() {}\n");
		registerRepo(REPO, repoDir);
		await indexRepo();
		const symbolCount = store.codebaseSymbols.getSymbolCountByRepo(REPO);
		expect(symbolCount).toBe(2);

		// Build the steady state the F1 bug lives in: the repo's LAST REAL
		// INDEX happened beyond the TTL (DB last_indexed_at is stale — the
		// internal autoIndexIfStale backstop, which reads the real clock, must
		// agree), while the files' mtimes are safely OLDER than that timestamp
		// so the incremental planner skips every file (genuine zero-parse run).
		const fileMtime = new Date(Date.now() - 3 * FILE_WATCH_TTL_MS);
		fs.utimesSync(path.join(repoDir, "a.ts"), fileMtime, fileMtime);
		fs.utimesSync(path.join(repoDir, "b.ts"), fileMtime, fileMtime);
		store.db
			.prepare("UPDATE codebase_files SET last_indexed_at = ? WHERE repo = ?")
			.run(new Date(Date.now() - 2 * FILE_WATCH_TTL_MS).toISOString(), REPO);

		// Sweep 1 — due (the last trigger dispatch is beyond TTL) → dispatches
		// a trigger and advances the in-memory lastTriggeredAt.
		const dueNow = Date.now() + FILE_WATCH_TTL_MS + 1;
		const first = await sweepWatchedRepos(store, parserPool, { now: dueNow });
		expect(first.triggered).toContain(REPO);
		expect(first.skippedFresh).not.toContain(REPO);

		// Let the fire-and-forget run finish. Files untouched → planner skips
		// every file → ZERO parses → last_indexed_at stays stale.
		await waitFor(() => !indexingRepos.has(REPO));
		expect(store.codebaseSymbols.getSymbolCountByRepo(REPO)).toBe(symbolCount);

		// Sweep 2 — THE REGRESSION: the run parsed nothing, so a DB-keyed cap
		// (pre-fix behavior) would still see the repo as stale and re-trigger a
		// full discovery walk. The in-memory lastTriggeredAt DID advance, so
		// the sweep must be skippedFresh — not re-triggered.
		const second = await sweepWatchedRepos(store, parserPool, { now: dueNow });
		expect(second.skippedFresh).toContain(REPO);
		expect(second.triggered).not.toContain(REPO);

		// Sweep 3 — past the TTL again → due → triggers (the cap recovers).
		const third = await sweepWatchedRepos(store, parserPool, {
			now: dueNow + FILE_WATCH_TTL_MS + 1
		});
		expect(third.triggered).toContain(REPO);
	});

	it("guard prevents concurrent indexing — skippedInFlight", async () => {
		touch(path.join(repoDir, "a.ts"), "export function a() {}\n");
		registerRepo(REPO, repoDir);
		await indexRepo();

		// Simulate an in-flight index (tool call / startup path mid-run).
		indexingRepos.add(REPO);
		try {
			const outcome = await sweepWatchedRepos(store, parserPool, { ttlMs: 0 });
			expect(outcome.skippedInFlight).toContain(REPO);
			expect(outcome.triggered).not.toContain(REPO);
		} finally {
			indexingRepos.delete(REPO);
		}
	});

	it("skips repos whose registered path is no longer a directory", async () => {
		touch(path.join(repoDir, "a.ts"), "export function a() {}\n");
		registerRepo(REPO, repoDir);
		await indexRepo();

		fs.rmSync(repoDir, { recursive: true, force: true });

		const outcome = await sweepWatchedRepos(store, parserPool, { ttlMs: 0 });
		expect(outcome.skippedUnresolvable).toContain(REPO);
		expect(outcome.triggered).not.toContain(REPO);
	});

	// ══════════════════════════════════════════════════════════════════
	// FileWatcher lifecycle
	// ══════════════════════════════════════════════════════════════════

	it("ENABLE_FILE_WATCHER=false → loop never starts", () => {
		const watcher = new FileWatcher(store, parserPool, { enabled: false, intervalMs: 10 });
		watcher.start();
		expect(watcher.isRunning()).toBe(false);

		// Env-driven path: "false" disables the default-enabled gate.
		process.env.ENABLE_FILE_WATCHER = "false";
		expect(isFileWatcherEnabled()).toBe(false);
		const envWatcher = new FileWatcher(store, parserPool, { intervalMs: 10 });
		envWatcher.start();
		expect(envWatcher.isRunning()).toBe(false);
	});

	it("start() schedules a sweep on the interval; stop() cancels the loop", async () => {
		touch(path.join(repoDir, "existing.ts"), "export function existing() {}\n");
		registerRepo(REPO, repoDir);
		await indexRepo(); // built with real timers
		touch(path.join(repoDir, "added.ts"), "export function added() {}\n");

		// Fake timers for the SYNCHRONOUS lifecycle assertions + the "no tick
		// before the interval" check ONLY. The fake clock starts at real now,
		// and ttlMs=0 makes the just-indexed repo stale the moment a sweep runs.
		vi.useFakeTimers();
		const watcher = new FileWatcher(store, parserPool, { intervalMs: 1000, ttlMs: 0 });
		watcher.start();
		expect(watcher.isRunning()).toBe(true);

		// No tick before the first interval: advance just under the 1000ms floor
		// (FILE_WATCH_INTERVAL_MIN_MS) and verify the sweep was NOT dispatched —
		// no in-flight index, no new symbol.
		await vi.advanceTimersByTimeAsync(999);
		expect(indexingRepos.has(REPO)).toBe(false);
		expect(store.codebaseSymbols.getSymbolsByRepo(REPO).some((s) => s.name === "added")).toBe(false);

		// CRITICAL: switch back to REAL timers BEFORE any index dispatch. The
		// sweep's re-index is FIRE-AND-FORGET (indexing-service.ts `void
		// indexRepository(...)` returns 'started' immediately) and its directory
		// walk runs on real async I/O via setImmediate (@nodelib/fs.walk) —
		// scheduled on the fake clock it would never fire, and useRealTimers()
		// would discard the pending fake timers, parking the index forever.
		// useRealTimers() also cancels the pending fake interval, so drive the
		// first sweep explicitly through the public API — the same path the
		// interval tick calls into.
		vi.useRealTimers();

		// Sweep with a short TTL — the registered repo is stale → triggered, and
		// the fire-and-forget index completes in the background on real timers.
		const outcome = await watcher.sweepNow({ ttlMs: 0 });
		expect(outcome.triggered).toContain(REPO);
		expect(outcome.skippedFresh).not.toContain(REPO);

		// Poll the store until the triggered re-index lands (mirrors :168-183).
		await waitFor(() => store.codebaseSymbols.getSymbolsByRepo(REPO).some((s) => s.name === "added"));

		// Stop → no further ticks (waiting must not index new files).
		const addedBeforeStop = store.codebaseFiles.getFilesByRepo(REPO).length;
		watcher.stop();
		expect(watcher.isRunning()).toBe(false);
		touch(path.join(repoDir, "late.ts"), "export function late() {}\n");
		await new Promise((resolve) => setTimeout(resolve, 500));
		expect(store.codebaseFiles.getFilesByRepo(REPO).length).toBe(addedBeforeStop);
	});
});
