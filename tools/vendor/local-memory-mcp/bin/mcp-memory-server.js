#!/usr/bin/env node
import { ensureDashboardBuild } from "./ensure-dashboard-build.mjs";

// FEAT-DAEMON-002A: merge file-based config (<configDir>/config.jsonc then
// <configDir>/.env) into process.env BEFORE any bundled module is imported.
// utils/constants.ts reads process.env at module-evaluation time, so this MUST
// run before the first "../dist/mcp/server.js" import. A missing/malformed
// file is a silent no-op and an explicit env var always wins (see
// src/mcp/utils/config-file.ts for the precedence rules). The import is
// dynamic so it executes here at the top, not hoisted past this point.
const { loadConfigFileEnv } = await import("../dist/mcp/utils/config-file.js");
loadConfigFileEnv();

process.env.MCP_SERVER = "true";

const sub = process.argv[2];
if (sub === "dashboard" || sub === "mcp-memory-dashboard") {
	// Rebuild the served UI bundle if stale (no-op when fresh).
	ensureDashboardBuild();
	import("../dist/dashboard/server.js");
} else if (sub === "daemon") {
	// Combined dashboard + MCP daemon (FEAT-DAEMON-001): the worker serves the
	// dashboard UI, so refresh the bundle before routing into server.ts, which
	// dispatches the daemon/--daemon-worker branches.
	ensureDashboardBuild();
	import("../dist/mcp/server.js");
} else if (sub === "--index") {
	// Pass through --index and all subsequent args to server.ts
	import("../dist/mcp/server.js");
} else {
	import("../dist/mcp/server.js");
}
