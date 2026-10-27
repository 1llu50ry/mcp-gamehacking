#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { SQLiteStore } from "../../src/mcp/storage/sqlite";
import { ReuseTelemetry } from "../../src/mcp/utils/reuse-telemetry";

const OWNER = "bench-owner";
const REPO = "context-reuse-bench";
const FILES = 12;
const SYMBOLS = 24;
const EVIDENCE_POINTERS = 8;
const TOKEN_PER_READ = 96;
const ROUNDS = 2;

function runScenario(store: SQLiteStore, shared: boolean) {
	const readFiles = store.db.prepare("SELECT id, file_path FROM bench_files ORDER BY id");
	const readSymbols = store.db.prepare("SELECT id, name FROM bench_symbols ORDER BY id");
	const readEvidence = store.db.prepare("SELECT file_id, symbol_id FROM bench_evidence ORDER BY file_id, symbol_id");
	const started = performance.now();
	let fileReads = 0;
	let symbolReads = 0;
	let evidenceReads = 0;
	let estimatedTokens = 0;
	if (shared) {
		fileReads += readFiles.all().length;
		symbolReads += readSymbols.all().length;
		estimatedTokens += (fileReads + symbolReads) * TOKEN_PER_READ;
		for (let consumer = 0; consumer < 3; consumer++) {
			evidenceReads += readEvidence.all().length;
			estimatedTokens += EVIDENCE_POINTERS * TOKEN_PER_READ;
		}
	} else {
		for (let round = 0; round < ROUNDS; round++) {
			for (let agent = 0; agent < 2; agent++) {
				fileReads += readFiles.all().length;
				symbolReads += readSymbols.all().length;
				estimatedTokens += (FILES + SYMBOLS) * TOKEN_PER_READ;
			}
		}
	}
	return { fileReads, symbolReads, evidenceReads, estimatedTokens, latencyMs: performance.now() - started };
}

function workload(store: SQLiteStore, telemetry: ReuseTelemetry, enabled: boolean) {
	const calls = 500;
	const query = store.db.prepare("SELECT ? AS value");
	const cpuStarted = process.cpuUsage();
	const started = performance.now();
	for (let index = 0; index < calls; index++) {
		for (let read = 0; read < 10_000; read++) query.get(index + read);
		telemetry.recordTool({
			owner: OWNER,
			repo: REPO,
			session: "bench-session",
			toolName: enabled ? "codebase-read" : "untracked-read",
			args: { filePath: `src/file-${index & 63}.ts` },
			result: {}
		});
	}
	telemetry.flush(store);
	const cpu = process.cpuUsage(cpuStarted);
	return { wallMs: performance.now() - started, cpuMs: (cpu.user + cpu.system) / 1_000 };
}

function median(values: number[]): number {
	return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "context-reuse-bench-"));
const dbPath = path.join(tmpDir, "telemetry.db");
try {
	const store = new SQLiteStore(dbPath);
	store.db.exec(`
		CREATE TABLE bench_files (id INTEGER PRIMARY KEY, file_path TEXT NOT NULL);
		CREATE TABLE bench_symbols (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
		CREATE TABLE bench_evidence (file_id INTEGER NOT NULL, symbol_id INTEGER NOT NULL);
	`);
	const seed = store.db.transaction(() => {
		for (let index = 0; index < FILES; index++)
			store.db.prepare("INSERT INTO bench_files VALUES (?, ?)").run(index, `file-${index}`);
		for (let index = 0; index < SYMBOLS; index++)
			store.db.prepare("INSERT INTO bench_symbols VALUES (?, ?)").run(index, `symbol-${index}`);
		for (let index = 0; index < EVIDENCE_POINTERS; index++)
			store.db.prepare("INSERT INTO bench_evidence VALUES (?, ?)").run(index % FILES, index % SYMBOLS);
	});
	seed();
	store.db.pragma("wal_checkpoint(TRUNCATE)");
	const dbBytesBefore = fs.statSync(dbPath).size;
	const disabled = new ReuseTelemetry(false);
	const enabled = new ReuseTelemetry(true);
	for (let index = 0; index < 3; index++) workload(store, disabled, false);
	globalThis.gc?.();
	const baselineTrials: Array<{ wallMs: number; cpuMs: number }> = [];
	const enabledTrials: Array<{ wallMs: number; cpuMs: number }> = [];
	const heapBefore = process.memoryUsage().heapUsed;
	for (let index = 0; index < 7; index++) {
		baselineTrials.push(workload(store, disabled, false));
		enabledTrials.push(workload(store, enabled, true));
	}
	globalThis.gc?.();
	store.db.pragma("wal_checkpoint(TRUNCATE)");
	const heapDeltaBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore);
	const baselineMs = median(baselineTrials.map((trial) => trial.wallMs));
	const instrumentedMs = median(enabledTrials.map((trial) => trial.wallMs));
	const baselineCpuMs = median(baselineTrials.map((trial) => trial.cpuMs));
	const instrumentedCpuMs = median(enabledTrials.map((trial) => trial.cpuMs));
	const baseline = runScenario(store, false);
	const shared = runScenario(store, true);
	console.log(
		JSON.stringify(
			{
				seed: 96,
				scenario: "explore -> orchestrator -> two implementers",
				baseline,
				shared,
				delta: {
					fileReadsAvoided: baseline.fileReads - shared.fileReads,
					symbolReadsAvoided: baseline.symbolReads - shared.symbolReads,
					estimatedTokensAvoided: baseline.estimatedTokens - shared.estimatedTokens
				},
				telemetry: {
					baselineMs,
					instrumentedMs,
					wallOverheadPercent: ((instrumentedMs - baselineMs) / baselineMs) * 100,
					baselineCpuMs,
					instrumentedCpuMs,
					cpuOverheadPercent: ((instrumentedCpuMs - baselineCpuMs) / baselineCpuMs) * 100,
					heapDeltaBytes,
					dbBytes: fs.statSync(dbPath).size,
					dbGrowthBytes: fs.statSync(dbPath).size - dbBytesBefore,
					rows: (store.db.prepare("SELECT COUNT(*) AS count FROM reuse_telemetry_hourly").get() as { count: number })
						.count
				}
			},
			null,
			2
		)
	);
	store.close();
} finally {
	fs.rmSync(tmpDir, { recursive: true, force: true });
}
