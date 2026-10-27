#!/usr/bin/env node
// Mark this process as an MCP server to disable stderr logging (stdin/stdout used for JSON-RPC)
process.env.MCP_SERVER = "true";

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServerFactory } from "./transport/factory";
import { resolveTransportMode, resolveHttpTransportConfig, startHttpTransport } from "./transport/http";
import { SQLiteStore } from "./storage/sqlite";
import { RealVectorStore } from "./storage/vectors";
import { EMBEDDING_MODEL_NAME } from "./storage/embedding-model";
import { CapabilityAwareVectorStore } from "./storage/lazy-vectors";
import { EmbeddingWorker } from "./embedding-queue";
import { RuntimeCapabilityRegistry, setRuntimeCapabilities } from "./runtime-capabilities";
import { CAPABILITIES } from "./capabilities";
import { formatBuildInfo, getBuildInfo } from "./utils/build-info";
import { addLogSink, createFileSink, logger } from "./utils/logger";
import { bugCapture } from "./utils/bug-capture";
import { reuseTelemetry } from "./utils/reuse-telemetry";
import { runStartupMaintenance } from "./services/maintenance-job";
import { runStartupVacuum } from "./services/vacuum";
import { scheduleDeferredSemanticWarmup } from "./services/startup-warmup";
import { scheduleDeferredStartupPasses } from "./services/startup-deferral";
import type { DeferredStartupPass } from "./services/startup-deferral";
import { kickOffStartupAutoIndex } from "./services/startup-auto-index";
import { EMBEDDING_LAZY_WARMUP, VACUUM_ON_STARTUP } from "./utils/constants";
import { runCliIndex } from "./codebase-index/cli";
import { getCodebaseParserPool } from "./codebase-index/parser/singleton";
import { closeProcessPools } from "./services/shutdown-teardown";
import { FileWatcher } from "./codebase-index/services/file-watcher";
import fs from "fs";
import path from "path";

// --- CLI Daemon Mode (FEAT-DAEMON-001) ---
// `daemon` forks the combined dashboard + MCP worker as a detached background
// process and exits; `daemon stop`/`daemon status` manage the recorded PID.
// `--daemon-worker` is the forked child entry point (never reached via the
// bin's `daemon` route directly — the worker re-execs the bin with this flag).
// Both branches run BEFORE the doctor/--index checks below so the daemon
// subcommands can never be shadowed by another CLI mode. The worker branch is
// checked FIRST so an OS service unit may spell the command either
// `<bin> --daemon-worker` or `<bin> daemon --daemon-worker`.
if (process.argv.includes("--daemon-worker")) {
	const { runDaemonWorker } = await import("./cli/combined-server");
	await runDaemonWorker();
	// runDaemonWorker never resolves — unreachable
}
if (process.argv.includes("daemon")) {
	const { runDaemonCli } = await import("./cli/daemon");
	// runDaemonCli always calls process.exit — unreachable
	runDaemonCli(process.argv.slice(process.argv.indexOf("daemon") + 1));
}

// --- CLI Doctor Mode ---
if (process.argv.includes("doctor")) {
	process.stderr.write("\n🏥 MCP Local Memory - System Diagnosis\n\n");

	const db = await SQLiteStore.create();
	const dbPath = db.getDbPath();

	process.stderr.write(`📂 Database Path: ${dbPath}\n`);
	process.stderr.write(`📄 Database Status: ${fs.existsSync(dbPath) ? "✅ Exists" : "❌ Not Found"}\n`);

	try {
		const stats = db.system.getGlobalStats();
		process.stderr.write(`📊 Memory Count: ${stats.totalMemories} entries\n`);
		process.stderr.write(`✅ SQLite Connection: Functional\n`);
	} catch (err) {
		process.stderr.write(`❌ SQLite Connection: Failed (${String(err)})\n`);
	}

	process.stderr.write(`🤖 AI Model: ${EMBEDDING_MODEL_NAME}\n`);
	process.stderr.write(`⚙️  Mode: Local-First (ONNX Runtime)\n`);

	const isAutoArchive = process.env.ENABLE_AUTO_ARCHIVE === "true";
	process.stderr.write(`📉 Auto-Archive: ${isAutoArchive ? "Enabled" : "Disabled (Default)"}\n`);

	process.stderr.write("\n✨ Diagnosis complete.\n\n");
	process.exit(0);
}

// --- CLI Index Mode ---
if (process.argv.includes("--index")) {
	await runCliIndex();
	// runCliIndex always calls process.exit(0|1) — unreachable
}

// --- Process-level crash containment (Fix #2) ---
// Node >= 15 terminates the process on ANY escaping rejection or uncaught
// exception. The codebase-index pipeline (sync WASM parses, DB writes) can
// throw from paths outside our try/catch reach — register handlers so a
// single escaping error logs and continues instead of killing the MCP server.
//
// Startup guard (TASK-051): these handlers are installed BEFORE the top-level
// `await SQLiteStore.create()` and vector-model init. In ESM, a rejection in a
// top-level await aborts module evaluation — with a handler installed Node no
// longer exits, and the process would hang with no server and no stdio
// listener. `serverStarted` flips only when serveStdio is about to run, so any
// pre-start failure always terminates with a clean non-zero exit.
let serverStarted = false;

process.on("unhandledRejection", (reason: unknown) => {
	if (!serverStarted) {
		logger.error("[Server] Unhandled promise rejection during startup — exiting", {
			pid: process.pid,
			error: reason instanceof Error ? `${reason.message}\n${reason.stack ?? ""}` : String(reason)
		});
		bugCapture.capture({
			source: "unhandled_rejection",
			message: reason instanceof Error ? reason.message : String(reason),
			stack: reason instanceof Error ? (reason.stack ?? null) : null,
			context: { pid: process.pid, startup: !serverStarted }
		});
		process.exit(1);
	}
	logger.error("[Server] Unhandled promise rejection", {
		pid: process.pid,
		error: reason instanceof Error ? `${reason.message}\n${reason.stack ?? ""}` : String(reason)
	});
	bugCapture.capture({
		source: "unhandled_rejection",
		message: reason instanceof Error ? reason.message : String(reason),
		stack: reason instanceof Error ? (reason.stack ?? null) : null,
		context: { pid: process.pid, startup: !serverStarted }
	});
});

process.on("uncaughtException", (err: Error) => {
	if (!serverStarted) {
		logger.error("[Server] Uncaught exception during startup — exiting", {
			pid: process.pid,
			error: err.message,
			stack: err.stack ?? ""
		});
		bugCapture.capture({
			source: "uncaught",
			message: err.message,
			stack: err.stack ?? null,
			context: { pid: process.pid, startup: !serverStarted }
		});
		process.exit(1);
	}
	logger.error("[Server] Uncaught exception", {
		pid: process.pid,
		error: err.message,
		stack: err.stack ?? ""
	});
	bugCapture.capture({
		source: "uncaught",
		message: err.message,
		stack: err.stack ?? null,
		context: { pid: process.pid, startup: !serverStarted }
	});
});

// Resolve the transport mode FIRST (fail fast): an invalid MCP_TRANSPORT must
// abort startup with a clear error before any store/worker work begins. The
// crash-containment handlers above see `serverStarted === false` and exit(1).
const transportMode = resolveTransportMode();

// Create the core store first. Optional engines are registered below and
// initialized through one single-flight capability registry.
const db = await SQLiteStore.create();
const realVectors = new RealVectorStore(db);
const runtimeCapabilities = new RuntimeCapabilityRegistry();
setRuntimeCapabilities(runtimeCapabilities);
const vectors = new CapabilityAwareVectorStore(realVectors, runtimeCapabilities);

// Register file log sink (same dir as DB, retain last 5 files) BEFORE the
// embedding worker starts (TASK-457 fix8): embeddingWorker.start() runs the
// startup reconcile/backfill immediately, which is exactly the window where
// a multi-process "database is locked" burst is logged — a sink registered
// after start() would lose those first failure logs.
addLogSink(createFileSink(path.dirname(db.getDbPath())));

// Bug telemetry: bind the local SQLite sink and start capturing error-level
// log entries (uncaught/unhandled handlers, tool failures, …) into
// bug_reports. Local-only; see utils/bug-capture.ts.
bugCapture.bind(db);
addLogSink(bugCapture.logSink);

// Optional operator-triggered space reclamation (TASK-047). A full VACUUM is
// too heavy to run implicitly (full write lock + ~2x free disk), so it is
// gated behind VACUUM_ON_STARTUP (default off). NOTE (FEAT-DAEMON-002E): it is
// now run in the DEFERRED post-transport block at the bottom of this file
// (never inline) so it can never delay the initialize handshake — a cold start
// on a large DB previously ran it BEFORE the transport bound.

// Start the embedding/KG outbox worker (TASK-013): drains queue_jobs with
// batched ONNX inference + KG extraction OUTSIDE the write lock. Startup
// reconcile/backfill/purge run inside the worker.
const embeddingWorker = new EmbeddingWorker(db, realVectors);
runtimeCapabilities.register("semantic", async () => {
	// Preserve the worker's independent retry/maintenance loop even if the
	// first ONNX initialization fails.
	embeddingWorker.start();
	await realVectors.initialize();
});

// Parser and watcher objects are not constructed until their capabilities are
// demanded. All paths still share the process-wide parser singleton.
let fileWatcher: FileWatcher | null = null;
runtimeCapabilities.register("indexing", () => getCodebaseParserPool().initialize());
runtimeCapabilities.register("watcher", () => {
	fileWatcher ??= new FileWatcher(db, getCodebaseParserPool());
	fileWatcher.start();
});
if (process.env.ENABLE_FILE_WATCHER === "false") {
	runtimeCapabilities.disable("watcher", "Disabled via ENABLE_FILE_WATCHER=false");
}
runtimeCapabilities.register("maintenance", async () => {
	const result = await runStartupMaintenance(db);
	if (!result.skipped) {
		logger.info("[Server] Startup maintenance complete", {
			decayed: result.decay.decayed,
			archived: result.expiredArchived + result.lowScoreArchived + result.decay.archived,
			coldArchivedOffloaded: result.coldArchivedOffloaded
		});
	}
});

logger.info("[Server] startup", {
	pid: process.pid,
	version: CAPABILITIES.serverInfo.version,
	build: formatBuildInfo(getBuildInfo()),
	db: db.getDbPath(),
	profile: runtimeCapabilities.profile
});

// PERF-005: the `full` profile eagerly warms the semantic capability, which
// loads the ONNX runtime + embedding model into RSS (~140-180 MB measured) even
// on a daemon that only serves lexical traffic. With EMBEDDING_LAZY_WARMUP the
// startup model load is skipped: the loader stays registered and the model
// loads on the first semantic demand (router/tool pre-dispatch or the embedding
// worker's first claimed batch). The worker ENGINE still starts so startup
// reconcile/backfill/purge and the poll loop are unaffected. Default (false)
// preserves eager warm-up.
//
// FIX-034 / FEAT-DAEMON-002E: the eager warm-up, the embedding worker start
// (lazy mode), the maintenance sweep, the operator-gated VACUUM and the startup
// auto-index are ALL scheduled in the DEFERRED post-transport block at the
// bottom of this file (after the listener is serving). Previously the worker
// start + maintenance + auto-index kickoff (and, before FIX-034, an inline
// awaited warm-up against a hard-coded 30s cap that on a large DB — ~897 MB
// codebase.db / ~2.7 GB memory.db — both timed out and sat on the critical path
// to the first tool call) ran INLINE here, BEFORE the transport bound, so a
// cold start on a large DB could delay the initialize handshake. See
// services/startup-deferral.ts for the ordering + failure-isolation contract.
//
// Startup auto-index notes (preserved): triggers codebase indexing for the
// current working directory if the index has never been built or is older than
// TTL (default 24h); respects CODEBASE_AUTO_INDEX; the parser pool is shared
// with the file watcher; the repo is registered with the watcher so the polling
// sweep keeps it fresh. GUARD (project detection): only a real project CWD is
// auto-indexed (indexing a NON-project root such as `~` enumerates the whole
// tree synchronously and starves the event loop). The kickoff is fully
// failure-isolated in services/startup-auto-index.ts — a failure degrades the
// `indexing` capability and NEVER aborts readiness.

// Ignore EPIPE errors on stdout/stderr (e.g. if the client disconnects prematurely)
process.stdout.on("error", (err: unknown) => {
	if ((err as Record<string, unknown>).code === "EPIPE") return;
	logger.error("stdout error", { error: String(err) });
});

process.stderr.on("error", (err: unknown) => {
	if ((err as Record<string, unknown>).code === "EPIPE") return;
	logger.error("stderr error", { error: String(err) });
});

// Cleanup on exit
const shutdown = async (signal: string) => {
	logger.info("[Server] shutdown", { signal, pid: process.pid });
	embeddingWorker.stop();
	fileWatcher?.stop();
	await handle?.close();
	// C1 (FEAT-DAEMON-002 review): release the process-owned worker pools (the
	// tree-sitter parser pool + the embedding worker pool) so their threads
	// never keep the event loop alive after a graceful stop. Idempotent and
	// failure-contained — shutdown always reaches db.close()/process.exit(0).
	await closeProcessPools({ vectors: realVectors, logTag: "[Server]" });
	reuseTelemetry.flush(db);
	db.close();
	process.exit(0);
};

process.on(
	"SIGINT",
	() =>
		void shutdown("SIGINT").catch((err) => {
			logger.error("[Server] shutdown error", { error: String(err) });
		})
);
process.on(
	"SIGTERM",
	() =>
		void shutdown("SIGTERM").catch((err) => {
			logger.error("[Server] shutdown error", { error: String(err) });
		})
);

// Start the MCP server using the SDK — startup is now complete, so a runtime
// failure may log+continue instead of exiting (TASK-051).
//
// Transport selection (opt-in): MCP_TRANSPORT=stdio (DEFAULT, unchanged) keeps
// the historical single-client stdio server; MCP_TRANSPORT=http starts the
// Streamable HTTP daemon so MANY clients share ONE store/worker set. The store
// and workers above are initialized EXACTLY ONCE for both transports; each
// session gets its own McpServer/SessionContext via createServerFactory.
serverStarted = true;
let handle: { close(): Promise<void> } | undefined;
if (transportMode === "http") {
	try {
		handle = await startHttpTransport({
			...resolveHttpTransportConfig(),
			factory: createServerFactory(db, vectors, "http")
		});
	} catch (error) {
		// A listen/bind failure (e.g. EADDRINUSE) or a missing bearer token must
		// terminate cleanly — never leave the process running with no listener.
		logger.error("[Server] Failed to start MCP HTTP transport — exiting", { error: String(error) });
		process.exit(1);
	}
} else {
	handle = serveStdio(createServerFactory(db, vectors, "stdio"));
}

// --- Deferred post-transport startup passes (FEAT-DAEMON-002E) ---
//
// The transport is BOUND/SERVING (above). Every OPTIONAL heavy pass runs on a
// later event-loop turn so a cold start on a large DB can never block the
// `initialize` handshake:
//   - `vacuum`          — operator-gated full VACUUM (TASK-047), default off;
//   - `embedding-worker`— lazy-mode worker start (PERF-005), non-blocking;
//   - `maintenance`     — startup maintenance sweep (FIX-025);
//   - `semantic-warmup` — eager ONNX load (FIX-034), non-fatal;
//   - `auto-index`      — codebase auto-index kickoff, fully failure-isolated.
// DB migrations + derived-schema setup stay INLINE in SQLiteStore.create()
// because a usable schema is required to serve ANY request (see
// services/startup-deferral.ts for the full rationale).
const startupPasses: DeferredStartupPass[] = [
	{
		name: "vacuum",
		run: () => {
			const result = runStartupVacuum(db, VACUUM_ON_STARTUP);
			if (result) {
				logger.info("[Server] VACUUM_ON_STARTUP ran", {
					changed: result.changed,
					skipped: result.skipped,
					reason: result.reason
				});
			}
		}
	}
];
if (runtimeCapabilities.profile === "full") {
	if (EMBEDDING_LAZY_WARMUP) {
		startupPasses.push({ name: "embedding-worker", run: () => embeddingWorker.start() });
	}
	startupPasses.push({ name: "maintenance", run: () => runtimeCapabilities.ensure("maintenance") });
	// FIX-034: eager semantic (ONNX) warm-up, DEFERRED and NON-FATAL — a timeout
	// or load failure logs one WARN and bumps a counter, but never blocks or
	// aborts startup; the capability still loads lazily on first semantic use.
	if (!EMBEDDING_LAZY_WARMUP) {
		startupPasses.push({
			name: "semantic-warmup",
			run: () => scheduleDeferredSemanticWarmup(runtimeCapabilities).settled
		});
	}
	startupPasses.push({
		name: "auto-index",
		run: () => kickOffStartupAutoIndex(db, runtimeCapabilities, { logTag: "[Server]" })
	});
}
scheduleDeferredStartupPasses(startupPasses);
