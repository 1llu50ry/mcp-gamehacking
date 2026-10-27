#!/usr/bin/env node
/**
 * Standalone dashboard entry point.
 *
 * Boots the dashboard DI singletons (`./lib/context`), builds the Express app
 * via the shared {@link createExpressApp} factory, binds it on `PORT`/`HOST`,
 * and starts the embedding worker. The combined daemon worker
 * (`src/mcp/cli/combined-server.ts`) reuses the same factory to mount the
 * dashboard routes next to the MCP `/mcp` handler on one port
 * (FEAT-DAEMON-001) — this file only owns the standalone socket lifecycle.
 */
import { db, vectors, mcpClient, logger, embeddingWorker } from "./lib/context";
import { reuseTelemetry } from "../mcp/utils/reuse-telemetry";
import { createExpressApp } from "./app";

const { app, pkg } = createExpressApp({ db, vectors });

const PORT = Number(process.env.PORT) || 3456;
const HOST = process.env.DASHBOARD_HOST || "127.0.0.1";

// --- Start Server ---
if (process.env.DASHBOARD_ENABLE_MCP === "true") {
	mcpClient.start().catch((e) => logger.error("MCP Client failed", { error: e.message }));
}

function startServer() {
	const server = app.listen(PORT, HOST, () => {
		const addr = server.address();
		const bindAddr = typeof addr === "string" ? addr : (addr?.address ?? HOST);
		if (bindAddr !== "127.0.0.1" && bindAddr !== "::1") {
			logger.warn("Dashboard bound to non-loopback address — access is exposed on the network", {
				address: bindAddr,
				port: PORT,
				suggestion: "Set DASHBOARD_HOST=127.0.0.1 to restrict to localhost"
			});
		}
		console.log(`${new Date().toISOString()} DASHBOARD_STARTING v${pkg.version} on ${bindAddr}:${PORT}`);
	});

	server.on("error", (err: NodeJS.ErrnoException) => {
		if (err.code === "EADDRINUSE") {
			console.log(
				`${new Date().toISOString()} DASHBOARD_ALREADY_RUNNING Dashboard already running on port ${PORT}. Exiting.`
			);
			process.exit(0);
		}
		throw err;
	});
}

startServer();

process.on("SIGINT", () => {
	embeddingWorker.stop();
	mcpClient.stop();
	reuseTelemetry.flush(db);
	db.close();
	process.exit(0);
});
process.on("SIGTERM", () => {
	embeddingWorker.stop();
	mcpClient.stop();
	reuseTelemetry.flush(db);
	db.close();
	process.exit(0);
});
