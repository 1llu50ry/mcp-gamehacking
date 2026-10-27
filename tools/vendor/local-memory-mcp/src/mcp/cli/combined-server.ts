/**
 * Combined daemon worker (FEAT-DAEMON-001).
 *
 * Started by `--daemon-worker` (forked by {@link ./daemon}). Serves BOTH the
 * existing dashboard Express app (all `/api` routes + the built UI) AND the MCP
 * Streamable HTTP handler at `/mcp` on ONE loopback port (default `3456`, env
 * `PORT`). The dashboard routes and the MCP endpoint therefore share one origin
 * and one store — no bearer token is required because the listener is
 * loopback-only.
 *
 * STORE OWNERSHIP: the dashboard route modules resolve their store from the
 * `src/dashboard/lib/context` DI singleton (`import { db } from "../lib/context"`).
 * The combined server therefore reuses that singleton (db, vectors,
 * embeddingWorker, runtimeCapabilities) so MCP reads/writes and dashboard reads
 * observe the SAME database. It only ADDS the engines the dashboard does not
 * own (indexing / watcher / maintenance).
 *
 * The MCP handler is mounted as an Express pre-route so it owns `/mcp`
 * exclusively (the SPA fallback can never answer it) and reads the raw request
 * stream (the Node→Web bridge in `../transport/http` consumes the body before
 * `express.json()` would).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { hostHeaderValidationResponse, originValidationResponse } from "@modelcontextprotocol/server";
import { createServerFactory } from "../transport/factory";
import {
	buildAllowedHostnames,
	buildRequestUrl,
	createDualHandler,
	serveNodeRequest,
	toWebRequest,
	writeWebResponse,
	type DualHandler,
	MCP_HTTP_DEFAULT_HOST,
	MCP_HTTP_DEFAULT_PATH
} from "../transport/http";
import { CAPABILITIES } from "../capabilities";
import { resolveDaemonPaths, removeLock } from "./daemon";
import { isRecoverableLockError } from "../storage/write-lock";
import { formatBuildInfo, getBuildInfo } from "../utils/build-info";
import { logger } from "../utils/logger";
import { bugCapture } from "../utils/bug-capture";
import { reuseTelemetry } from "../utils/reuse-telemetry";
import { runStartupMaintenance } from "../services/maintenance-job";
import { runStartupVacuum } from "../services/vacuum";
import { scheduleDeferredSemanticWarmup } from "../services/startup-warmup";
import { scheduleDeferredStartupPasses } from "../services/startup-deferral";
import type { DeferredStartupPass } from "../services/startup-deferral";
import { kickOffStartupAutoIndex } from "../services/startup-auto-index";
import { EMBEDDING_LAZY_WARMUP, MCP_DAEMON_SESSION_IDLE_TTL_MS, VACUUM_ON_STARTUP } from "../utils/constants";
import { getCodebaseParserPool } from "../codebase-index/parser/singleton";
import { closeProcessPools } from "../services/shutdown-teardown";
import { FileWatcher } from "../codebase-index/services/file-watcher";
import { createExpressApp } from "../../dashboard/app";
import type { ExpressPreRoute } from "../../dashboard/app";
import type { SQLiteStore } from "../storage/sqlite";
import type { RuntimeCapabilityRegistry } from "../runtime-capabilities";
import type { VectorStore } from "../types";

/** Default combined-server port — shared with the standalone dashboard. */
export const DAEMON_DEFAULT_PORT = 3456;

/** The minimal worker surface the combined server needs for lifecycle control. */
interface WorkerLike {
	start(): void;
	stop(): void;
}

/**
 * Options accepted by {@link startCombinedServer}.
 */
export interface StartCombinedServerOptions {
	/** Bind host — loopback only. Defaults to `127.0.0.1`. */
	host?: string;
	/** Bind port (`0` requests an ephemeral port). Defaults to `PORT`/3456. */
	port?: number;
	/**
	 * Register + warm the background runtime engines (indexing, watcher,
	 * maintenance). Defaults to `true`; tests disable it to keep startup
	 * hermetic.
	 */
	enableEngines?: boolean;
	/**
	 * Test-only seam (FEAT-DAEMON-002E) for the DEFERRED post-listen startup
	 * passes. Production never sets it. Tests inject a capturing `schedule` to
	 * prove the listener answers `initialize` BEFORE the heavy passes run, and
	 * `extraPasses` to append a slow/observable pass. See
	 * {@link ../services/startup-deferral}.
	 */
	startupDeferral?: {
		/** Override the deferred-pass scheduler (default `setImmediate`). */
		schedule?: (run: () => void) => void;
		/** Extra passes appended after the built-in ones. */
		extraPasses?: DeferredStartupPass[];
	};
}

/**
 * Options accepted by {@link runDaemonWorker}. Extends the combined-server
 * options so a production caller can still pin host/port/engines.
 */
export interface RunDaemonWorkerOptions extends StartCombinedServerOptions {
	/**
	 * Test-only seam: override the boot function so a test can assert the
	 * never-resolving contract WITHOUT binding a real listener (or polluting
	 * the process with a second store). Production callers never pass this.
	 */
	startServer?: (options: StartCombinedServerOptions) => Promise<CombinedServerHandle>;
	/**
	 * Test-only seam: skip installing the process-level crash/signal handlers
	 * (which would otherwise leak onto the test runner process). Defaults to
	 * `true` in production.
	 */
	installProcessHandlers?: boolean;
}

/** Handle returned by {@link startCombinedServer}. */
export interface CombinedServerHandle {
	server: http.Server;
	/** Actual bound port (resolved when `port: 0` was requested). */
	port: number;
	/** Base URL (no trailing slash). */
	url: string;
	/** Close the MCP handler, the HTTP listener, and any owned resources. */
	close(): Promise<void>;
}

/**
 * Resolve the shared runtime dependencies from the dashboard context
 * singleton. Imported dynamically so the stdio server path never pulls in the
 * dashboard/express graph.
 */
async function resolveRuntime(): Promise<{
	db: SQLiteStore;
	vectors: VectorStore;
	embeddingWorker: WorkerLike;
	runtimeCapabilities: RuntimeCapabilityRegistry;
}> {
	const ctx = await import("../../dashboard/lib/context");
	return {
		db: ctx.db,
		vectors: ctx.vectors,
		embeddingWorker: ctx.embeddingWorker,
		runtimeCapabilities: ctx.runtimeCapabilities
	};
}

/**
 * Build the Express pre-route that serves the MCP Streamable HTTP handler at
 * `/mcp`.
 *
 * Bridges each Express request (a Node `IncomingMessage`/`ServerResponse`
 * subclass) into the SDK's Web-standard handler and back. Host/Origin
 * validation mirrors `startHttpTransport`; bearer auth is intentionally absent
 * because the combined listener is loopback-only.
 */
function createMcpPreRoute(handler: DualHandler, host: string): ExpressPreRoute {
	const allowedHostnames = buildAllowedHostnames(host);

	return {
		path: MCP_HTTP_DEFAULT_PATH,
		handler: (req, res) => {
			// FIX-025: route through the shared disconnect-safe bridge so a
			// client that goes away mid-request (ERR_STREAM_PREMATURE_CLOSE —
			// the highest-volume signal in daemon.log) aborts only this request
			// and logs at WARN instead of escaping as an uncaught exception.
			serveNodeRequest(
				req,
				res,
				async (nodeReq, nodeRes) => {
					const port = nodeReq.socket.localPort ?? DAEMON_DEFAULT_PORT;
					const url = buildRequestUrl(nodeReq, host, port);
					const webRequest = toWebRequest(nodeReq, url);

					const rejected =
						hostHeaderValidationResponse(webRequest, allowedHostnames) ??
						originValidationResponse(webRequest, allowedHostnames);
					if (rejected !== undefined) {
						await writeWebResponse(nodeRes, rejected);
						return;
					}

					const webResponse = await handler.fetch(webRequest);
					await writeWebResponse(nodeRes, webResponse);
				},
				{ logTag: "[Daemon]" }
			);
		}
	};
}

/**
 * Register the runtime engines the dashboard does not own (indexing, watcher,
 * maintenance) on the shared capability registry. `semantic` is registered by
 * the dashboard context; it is not re-registered here.
 *
 * @returns A teardown function stopping the file watcher.
 */
function registerEngines(db: SQLiteStore, runtimeCapabilities: RuntimeCapabilityRegistry): () => void {
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
			logger.info("[Daemon] Startup maintenance complete", {
				decayed: result.decay.decayed,
				archived: result.expiredArchived + result.lowScoreArchived + result.decay.archived,
				coldArchivedOffloaded: result.coldArchivedOffloaded
			});
		}
	});

	return () => fileWatcher?.stop();
}

/**
 * Start the combined dashboard + MCP server.
 *
 * Resolves the shared runtime, builds the dashboard Express app with the MCP
 * `/mcp` pre-route, and binds the listener. Returns a handle for lifecycle
 * control.
 */
export async function startCombinedServer(options: StartCombinedServerOptions = {}): Promise<CombinedServerHandle> {
	const host = options.host ?? MCP_HTTP_DEFAULT_HOST;
	const port = options.port ?? (Number(process.env.PORT) || DAEMON_DEFAULT_PORT);
	const enableEngines = options.enableEngines ?? true;

	const { db, vectors, embeddingWorker, runtimeCapabilities } = await resolveRuntime();

	// NOTE (FEAT-DAEMON-002E): the store was created (migrations + derived
	// schema) INSIDE resolveRuntime() — those are REQUIRED for the DB to be
	// usable and stay inline (cheap when already migrated; see
	// services/startup-deferral.ts). Every OPTIONAL heavy pass — including the
	// operator-gated startup VACUUM — is deferred until AFTER the listener is
	// bound (see the post-listen block below).

	const stopEngines = enableEngines ? registerEngines(db, runtimeCapabilities) : () => {};

	// Build identity (PERF-009): the daemon is a DETACHED process that does NOT
	// restart with the client, so it can silently keep serving an old build (the
	// wedge that motivated this task: an npx-cached 0.48.0 process while the
	// repo on disk was newer). Log the resolved identity AND the entry path so
	// "the daemon is not the build I think it is" is a one-line log check.
	// `entry` is what actually disambiguates an npx-cache install from the
	// working tree; version/SHA alone cannot.
	const build = getBuildInfo();
	logger.info("[Daemon] build identity", {
		build: formatBuildInfo(build),
		gitSha: build.gitSha,
		source: build.source,
		entry: process.argv[1] ?? "unknown",
		pid: process.pid
	});

	logger.info("[Daemon] startup", {
		pid: process.pid,
		version: CAPABILITIES.serverInfo.version,
		build: formatBuildInfo(build),
		db: db.getDbPath(),
		profile: runtimeCapabilities.profile
	});

	// --- Build the MCP handler + Express app ---
	// DUAL-ERA handler (DEBT-423): modern (2026-07-28) traffic is served by a
	// strict `legacy: "reject"` handler; 2025-era traffic — the era OpenCode and
	// most current MCP clients speak — is served by a PER-SESSION stateful
	// transport so MCP roots applied on `oninitialized` survive into later tool
	// calls. Without this the daemon (the PRIMARY deployment) fell back to the
	// SDK's throwaway stateless legacy serving and roots never reached tools.
	const mcpHandler = createDualHandler(
		createServerFactory(db, vectors, "http"),
		(error) => logger.warn("[Daemon] MCP handler error", { error: error.message }),
		// FIX-110-C: the daemon keeps legacy sessions alive far longer (2h
		// default) so a remote client that holds one session id for its whole
		// lifetime is evicted far less often; stateless recovery (default ON)
		// covers any eviction that still happens.
		{ sessionIdleTtlMs: MCP_DAEMON_SESSION_IDLE_TTL_MS }
	);
	const mcpMount = createMcpPreRoute(mcpHandler, host);
	const { app } = createExpressApp({ db, vectors, preRoutes: [mcpMount] });

	// --- Bind ---
	const server = http.createServer(app);
	await new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.off("error", onError);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, host);
	});

	const boundPort = (server.address() as AddressInfo).port;
	logger.info("[Daemon] listening", { host, port: boundPort, mcp: MCP_HTTP_DEFAULT_PATH });

	// --- Deferred post-listen startup passes (FEAT-DAEMON-002E) ---
	//
	// The listener is BOUND (above). Every OPTIONAL heavy pass runs on a later
	// event-loop turn so a cold start on a large DB can never block the
	// `initialize` handshake:
	//   - `vacuum`     — operator-gated full VACUUM (TASK-047), default off;
	//   - `maintenance`— startup maintenance sweep;
	//   - `semantic-warmup` — eager ONNX load (FIX-034), non-fatal;
	//   - `auto-index` — codebase auto-index kickoff, fully failure-isolated.
	// DB migrations + derived-schema setup stay INLINE in resolveRuntime()
	// because a usable schema is required to serve ANY request (see
	// services/startup-deferral.ts for the full rationale).
	const startupPasses: DeferredStartupPass[] = [
		{
			name: "vacuum",
			run: () => {
				const result = runStartupVacuum(db, VACUUM_ON_STARTUP);
				if (result) {
					logger.info("[Daemon] VACUUM_ON_STARTUP ran", {
						changed: result.changed,
						skipped: result.skipped,
						reason: result.reason
					});
				}
			}
		}
	];
	if (enableEngines && runtimeCapabilities.profile === "full") {
		startupPasses.push({ name: "maintenance", run: () => runtimeCapabilities.ensure("maintenance") });
		// FIX-034: eager semantic (ONNX) warm-up, DEFERRED and NON-FATAL — a
		// timeout/load failure logs one WARN + bumps a counter and the server
		// keeps serving; semantic loads lazily on first use. Mirrors server.ts.
		if (!EMBEDDING_LAZY_WARMUP) {
			startupPasses.push({
				name: "semantic-warmup",
				run: () => scheduleDeferredSemanticWarmup(runtimeCapabilities).settled
			});
		}
		startupPasses.push({
			name: "auto-index",
			run: () => kickOffStartupAutoIndex(db, runtimeCapabilities, { logTag: "[Daemon]" })
		});
	}
	startupPasses.push(...(options.startupDeferral?.extraPasses ?? []));
	scheduleDeferredStartupPasses(startupPasses, { schedule: options.startupDeferral?.schedule });

	const close = async (): Promise<void> => {
		try {
			embeddingWorker.stop();
		} catch {
			/* best effort */
		}
		stopEngines();
		await mcpHandler.close();
		// C1 (FEAT-DAEMON-002 review): release the process-owned worker pools.
		// `stopEngines()` only stops the file watcher; the shared parser pool and
		// the embedding worker pool (behind the dashboard context's vector store)
		// must be closed explicitly or their threads keep the event loop alive
		// after the daemon is asked to stop. Idempotent + failure-contained.
		await closeProcessPools({ vectors, logTag: "[Daemon]" });
		const closed = new Promise<void>((resolve) => server.close(() => resolve()));
		// Terminate lingering keep-alive / SSE connections so close() resolves.
		server.closeAllConnections();
		await closed;
		reuseTelemetry.flush(db);
		// The shared dashboard context store is process-owned; close it so the
		// WAL is checkpointed on a clean daemon shutdown.
		try {
			db.close();
		} catch {
			/* best effort */
		}
	};

	return { server, port: boundPort, url: `http://${host}:${boundPort}`, close };
}

/**
 * Entry point for the forked `--daemon-worker` process. Boots the combined
 * server, installs graceful-shutdown handlers, and stays alive until
 * SIGTERM/SIGINT.
 *
 * **Never resolves.** `server.ts` runs `await runDaemonWorker()` and, on
 * return, would fall through into the NORMAL `[Server]` boot path — creating a
 * SECOND `SQLiteStore` + `EmbeddingWorker` + maintenance engine in the same
 * pid (observed as `[Daemon] startup` AND `[Server] startup` under one pid,
 * with `[EmbeddingWorker] started` twice per boot). Two stores and two workers
 * on one DB is a major write-contention amplifier (the KG-Archivist /
 * EmbeddingWorker `database is locked` storm). The function therefore parks on
 * a never-settling promise; shutdown is driven exclusively by the signal
 * handlers below via `process.exit`.
 *
 * @param options - Boot options + an optional `startServer` seam for tests.
 *   Production callers pass nothing (defaults); tests inject a stub boot so
 *   they can assert the never-resolving contract hermetically.
 */
export async function runDaemonWorker(options: RunDaemonWorkerOptions = {}): Promise<void> {
	// The worker is HTTP-served (not stdio), so stdout/stderr are free for the
	// daemon log file. The listener is loopback-only, so no bearer token is
	// required.
	process.env.MCP_SERVER = "false";
	process.env.MCP_HTTP_ALLOW_INSECURE = "true";

	// Crash containment (mirrors server.ts): a startup failure must exit
	// non-zero; a post-start failure logs and continues.
	let serverStarted = false;
	if (options.installProcessHandlers !== false) {
		/**
		 * FIX-025: a residual proper-lockfile failure that reaches the process
		 * level (heartbeat `onCompromised`, vanished lockfile) is a KNOWN,
		 * non-fatal condition — log it at WARN and keep serving. Treating it as
		 * a generic ERROR is what made `daemon.log` show `Uncaught exception`
		 * for a lock refresh race. Any other error keeps the historical
		 * ERROR + startup-exit behavior.
		 */
		const reportProcessError = (source: "uncaught" | "unhandled_rejection", err: Error): void => {
			if (isRecoverableLockError(err)) {
				logger.warn("[Daemon] Recoverable lock error contained — daemon continues", {
					pid: process.pid,
					source,
					error: err.message
				});
				return;
			}
			logger.error(`[Daemon] ${source === "uncaught" ? "Uncaught exception" : "Unhandled promise rejection"}`, {
				pid: process.pid,
				error: `${err.message}\n${err.stack ?? ""}`
			});
			bugCapture.capture({
				source,
				message: err.message,
				stack: err.stack ?? null,
				context: { pid: process.pid, startup: !serverStarted }
			});
			if (!serverStarted) process.exit(1);
		};

		process.on("unhandledRejection", (reason: unknown) => {
			reportProcessError("unhandled_rejection", reason instanceof Error ? reason : new Error(String(reason)));
		});
		process.on("uncaughtException", (err: Error) => {
			reportProcessError("uncaught", err);
		});
	}

	let handle: CombinedServerHandle;
	try {
		const boot = options.startServer ?? startCombinedServer;
		handle = await boot(options);
	} catch (error) {
		// EADDRINUSE (TASK-425): another daemon/process already owns the port.
		// Emit an ACTIONABLE message and exit ONCE — do NOT crash-loop.
		if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
			const port = options.port ?? (Number(process.env.PORT) || DAEMON_DEFAULT_PORT);
			const message =
				`Daemon port ${port} is already in use — another daemon or process is listening. ` +
				`Run "daemon status" or stop the conflicting process.`;
			logger.error("[Daemon] port in use", { port, pid: process.pid });
			process.stderr.write(`${message}\n`);
			// Release the single-instance lock so the next `daemon start` is not
			// blocked by a lock this (failed) worker no longer legitimately holds.
			removeLock(resolveDaemonPaths().lockFile);
			process.exit(1);
			return;
		}
		logger.error("[Daemon] Failed to start combined server — exiting", { error: String(error) });
		process.exit(1);
		return;
	}
	serverStarted = true;

	// Ready signal → daemon.log (the parent already printed "Daemon started").
	// The build identity is repeated here so the most recent DAEMON_READY line
	// alone answers "which build is serving right now?" (PERF-009).
	process.stdout.write(
		`${new Date().toISOString()} DAEMON_READY ${handle.url} (pid ${process.pid}, build ${formatBuildInfo()})\n`
	);

	let shuttingDown = false;
	const shutdown = async (signal: string): Promise<void> => {
		if (shuttingDown) return;
		shuttingDown = true;
		logger.info("[Daemon] shutdown", { signal, pid: process.pid });
		try {
			await handle.close();
		} catch (error) {
			logger.error("[Daemon] shutdown error", { error: String(error) });
		}
		// Release the single-instance lock (TASK-425) so a subsequent
		// `daemon start` can acquire it immediately.
		removeLock(resolveDaemonPaths().lockFile);
		process.exit(0);
	};
	if (options.installProcessHandlers !== false) {
		process.on("SIGINT", () => void shutdown("SIGINT"));
		process.on("SIGTERM", () => void shutdown("SIGTERM"));
	}

	// Park forever (see the "Never resolves" note above): returning here would
	// re-enter server.ts's normal boot path and double-boot the store + worker.
	await new Promise<void>(() => {});
}
