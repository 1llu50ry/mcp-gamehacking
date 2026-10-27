/**
 * Dashboard Express application factory.
 *
 * Builds the full dashboard Express app (middleware, auth, `/api` routes,
 * static asset serving, SPA fallback, error handler) WITHOUT binding a socket.
 * Two callers share it:
 *
 *   - `src/dashboard/server.ts` — the standalone dashboard process (binds and
 *     starts the embedding worker itself).
 *   - `src/mcp/cli/combined-server.ts` — the daemon worker, which mounts the
 *     dashboard app AND the MCP Streamable HTTP handler at `/mcp` on ONE
 *     loopback port (FEAT-DAEMON-001).
 *
 * Extracting the app from the socket lifecycle is what lets the combined
 * server reuse the dashboard routes verbatim instead of duplicating them.
 */
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { addLogSink, createFileSink, logger } from "../mcp/utils/logger";
import { bugCapture } from "../mcp/utils/bug-capture";
import type { SQLiteStore } from "../mcp/storage/sqlite";
import type { VectorStore } from "../mcp/types";
import routes from "./routes";
import { createRequestLogger } from "./request-logging";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * A route registered BEFORE the JSON body parser, auth, static serving and the
 * SPA fallback.
 *
 * This ordering matters for the combined server: the MCP `/mcp` handler must
 * (a) own its path exclusively so the SPA fallback never answers a GET `/mcp`,
 * and (b) read the RAW request stream — `express.json()` would otherwise
 * consume the POST body before the Node→Web bridge can stream it.
 */
export interface ExpressPreRoute {
	path: string;
	handler: express.RequestHandler;
}

export interface CreateExpressAppOptions {
	/** The store the dashboard services resolve (telemetry + app locals). */
	db: SQLiteStore;
	/** The process-wide vector store (exposed on app.locals for diagnostics). */
	vectors: VectorStore;
	/** Routes mounted before the JSON parser / static / SPA fallback. */
	preRoutes?: ExpressPreRoute[];
}

export interface DashboardApp {
	app: express.Express;
	staticRoot: string;
	pkg: { version: string };
}

/**
 * Resolve the served dashboard version from package.json (best effort).
 *
 * Walks up from `__dirname` instead of using a hardcoded relative path: tsup
 * bundles this file into `dist/chunk-*.js` where `__dirname = dist/`, so a
 * fixed `../../package.json` would point outside the package root in the
 * published build. The walk-up loop finds the nearest `package.json` in both
 * dev (`src/dashboard/`) and prod (`dist/`), matching
 * `src/dashboard/services/system.service.ts`.
 */
function resolvePkgVersion(): { version: string } {
	const pkg = { version: "0.0.0" };
	try {
		let currentDir = __dirname;
		while (currentDir !== path.parse(currentDir).root) {
			const checkPath = path.join(currentDir, "package.json");
			if (fs.existsSync(checkPath)) {
				const data = JSON.parse(fs.readFileSync(checkPath, "utf8")) as { version?: string };
				if (data.version) pkg.version = data.version;
				break;
			}
			currentDir = path.dirname(currentDir);
		}
	} catch {
		// Intentionally empty: version stays at the fallback.
	}
	return pkg;
}

/**
 * Resolve the directory the static dashboard bundle is served from. Prefers the
 * production bundled path, then the root-relative dist path, then the unbuilt
 * source path — whichever actually contains `index.html`.
 */
function getStaticRoot(): string {
	const possibleRoots = [
		path.join(__dirname, "dashboard", "public"), // Production bundled path
		path.join(process.cwd(), "dist", "dashboard", "public"), // Root-relative dist path
		path.join(process.cwd(), "src", "dashboard", "public") // Source path (unbuilt)
	];

	for (const root of possibleRoots) {
		if (fs.existsSync(path.join(root, "index.html"))) {
			return root;
		}
	}

	// Fallback to production bundled path if no built UI found
	return possibleRoots[0];
}

/**
 * Build the dashboard Express app.
 *
 * Side effects (mirroring the historical standalone dashboard boot): binds the
 * file log sink and the local bug-telemetry sink to `db`. The file sink is
 * skipped for the `:memory:` test store so tests never write log files.
 */
export function createExpressApp(options: CreateExpressAppOptions): DashboardApp {
	const { db, vectors, preRoutes } = options;

	// File log sink (same dir as DB) — skipped for the in-memory test store.
	const dbPath = db.getDbPath();
	if (dbPath !== ":memory:") {
		addLogSink(createFileSink(path.dirname(dbPath)));
	}

	// Bug telemetry: capture dashboard 5xx + error-level logs into bug_reports.
	bugCapture.bind(db);
	addLogSink(bugCapture.logSink);

	const pkg = resolvePkgVersion();
	const app = express();
	app.locals.db = db;
	app.locals.vectors = vectors;

	// --- Request logging (first, so every route — including pre-routes — is logged) ---
	// FIX-028: the logger measures time-to-first-byte for streaming responses
	// (see ./request-logging) so an SSE stream's whole lifetime is never logged
	// as the request's latency. See createRequestLogger for the rationale.
	app.use(createRequestLogger());

	// --- Pre-routes (MCP /mcp in the combined server) ---
	// Registered before express.json(): these handlers consume the raw stream
	// and end the response themselves, so downstream middleware never runs for
	// their paths.
	for (const mount of preRoutes ?? []) {
		app.all(mount.path, mount.handler);
	}

	// --- Middleware ---
	app.use(express.json({ limit: process.env.DASHBOARD_JSON_LIMIT || "50mb" }));

	// --- Auth Middleware ---
	const authMiddleware: express.RequestHandler = (req, res, next) => {
		const token = process.env.DASHBOARD_TOKEN;

		// Auth not configured — pass through
		if (!token) {
			return next();
		}

		// Health check — unauthenticated
		if (req.path === "/" && req.method === "GET") {
			return next();
		}

		// Non-API routes (static files, SPA fallback) — no auth required
		if (!req.path.startsWith("/api")) {
			return next();
		}

		const authHeader = req.headers.authorization;
		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			res.status(401).json({ error: "Unauthorized: missing or invalid token" });
			return;
		}

		const providedToken = authHeader.slice(7);
		if (providedToken !== token) {
			res.status(401).json({ error: "Unauthorized: invalid token" });
			return;
		}

		next();
	};

	app.use(authMiddleware);

	// --- API Routes ---
	app.use("/api", routes);

	// --- Static Serving ---
	const staticRoot = getStaticRoot();
	logger.debug("Dashboard serving assets from", { staticRoot });
	app.use(express.static(staticRoot, { fallthrough: true }));

	app.use((req, res, next) => {
		if (req.path.startsWith("/api")) return next();

		const indexPath = path.join(staticRoot, "index.html");
		if (fs.existsSync(indexPath)) {
			res.sendFile(indexPath);
		} else {
			logger.warn("Dashboard index.html not found", { path: indexPath });
			res.status(404).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dashboard Not Built - Local Memory MCP</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 40px auto; padding: 20px; text-align: center; }
          h1 { color: #e53e3e; }
          code { background: #f7fafc; padding: 2px 4px; border-radius: 4px; border: 1px solid #edf2f7; font-family: monospace; }
          .container { border: 1px solid #e2e8f0; border-radius: 8px; padding: 30px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
          .footer { margin-top: 30px; font-size: 0.8rem; color: #718096; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Dashboard Assets Not Found</h1>
          <p>The dashboard frontend has not been built yet or assets are missing at:</p>
          <code>${indexPath}</code>
          <p style="margin-top: 20px;">To fix this, please run the build command in the repository root:</p>
          <code>npm run build</code>
        </div>
        <div class="footer">Local Memory MCP v${pkg.version}</div>
      </body>
      </html>
    `);
		}
	});

	// --- Error Handler ---
	app.use(
		(err: Error & { status?: number }, req: express.Request, res: express.Response, _next: express.NextFunction) => {
			if ((err as { status?: number }).status === 404) return res.status(404).end();
			logger.error("Unhandled error", { error: err.message });
			bugCapture.capture({
				source: "dashboard",
				message: err.message,
				stack: err.stack ?? null,
				context: { path: req.path, method: req.method, status: err.status ?? 500 }
			});
			res.status(500).end();
		}
	);

	return { app, staticRoot, pkg };
}
