import type { McpServerFactory, Server } from "@modelcontextprotocol/server";
import { createMcpServer } from "../mcp-server";
import { applySessionRoots, createSessionContext, updateSessionFromInitialize } from "../session";
import type { SessionContext } from "../session";
import type { SQLiteStore } from "../storage/sqlite";
import type { VectorStore } from "../types";
import { logger } from "../utils/logger";
import { bugCapture } from "../utils/bug-capture";

/**
 * Build an SDK {@link McpServerFactory} that constructs one fully-wired
 * {@link McpServer} (plus its per-connection {@link SessionContext}) per
 * serving unit — one stdio connection, or one HTTP request/session — over the
 * shared store and vectors.
 *
 * The factory is transport-agnostic and used by BOTH the stdio entry and the
 * Streamable HTTP transport, so the tool surface and the initialize-handshake
 * capture (client name/version/capabilities into the session context) can
 * never drift between the two transports.
 *
 * `transport` is threaded into the per-session {@link SessionContext} so the
 * TASK-420 write fail-loud guard can distinguish a stdio session (whose CWD IS
 * the client's project) from an HTTP/daemon session (whose CWD is the daemon's,
 * not the caller's). It defaults to `"stdio"` to preserve the historical
 * behavior of every existing caller/test.
 *
 * @param store - The process-wide SQLiteStore shared by every session.
 * @param vectors - The process-wide vector store shared by every session.
 * @param transport - The serving transport (`"stdio"` default, or `"http"`).
 * @returns A zero-argument factory assignable to the SDK's McpServerFactory.
 */
export function createServerFactory(
	store: SQLiteStore,
	vectors: VectorStore,
	transport: "stdio" | "http" = "stdio"
): McpServerFactory {
	return () => {
		const { server, ctx } = createMcpServer(store, vectors, createSessionContext(transport));

		// Wire oninitialized to capture client info from the initialize handshake
		// (mirrors the historical stdio wiring in server.ts).
		server.server.oninitialized = () => {
			// Register the process-level fallback scope provider (TASK-421) so
			// process-level captures (uncaught exceptions, unhandled rejections)
			// at least attribute to the most-recently-initialized session. This is
			// BEST-EFFORT for multi-session (HTTP) serving: one process serves many
			// sessions, so a single global provider can only reflect the latest —
			// call sites that know their scope pass owner/repo/sessionId explicitly.
			bugCapture.setScopeProvider(() => ({
				owner: ctx.owner,
				repo: ctx.repo,
				sessionId: ctx.sessionId
			}));

			try {
				const clientVer = server.server.getClientVersion();
				if (clientVer) {
					ctx.clientName = clientVer.name;
					ctx.clientVersion = clientVer.version;
					ctx.lastSeenAgent = clientVer.name;
				}
				ctx.lastSeenModel ??= process.env.MCP_MODEL;
				ctx.lastSeenAgent ??= process.env.MCP_CLIENT_NAME;

				updateSessionFromInitialize(ctx, {
					clientInfo: clientVer,
					capabilities: server.server.getClientCapabilities()
				} as Record<string, unknown>);
			} catch (error) {
				// Non-fatal — just logging
				logger.warn("[session] Failed to capture client info", { error: String(error) });
			}

			// Clients that advertise the roots capability get per-session
			// owner/repo/projectPath derived from their declared roots. Clients
			// without roots support keep the CWD-derived defaults untouched.
			if (ctx.supportsRoots) {
				void refreshSessionRoots(server.server, ctx);
				registerRootsChangedHandler(server.server, ctx);
			}
		};

		return server;
	};
}

/**
 * Fetches the client's declared roots and applies them to the session context.
 *
 * `listRoots` is a server→client request that only succeeds on a client which
 * advertised the `roots` capability (the caller gates on
 * {@link SessionContext.supportsRoots}). Any failure — a client that refuses
 * the request, an unsupported protocol era, a transport error — is logged and
 * swallowed: root scoping is a best-effort enhancement, never fatal to the
 * connection.
 */
async function refreshSessionRoots(server: Server, ctx: SessionContext): Promise<void> {
	try {
		const result = await server.listRoots();
		applySessionRoots(ctx, result.roots);
	} catch (error) {
		logger.warn("[session] Failed to fetch client roots", { error: String(error) });
	}
}

/**
 * Registers a handler for the client's `notifications/roots/list_changed`
 * notification, re-fetching and re-applying the roots whenever the client
 * changes them. Registration failure (e.g. the method is unavailable on the
 * SDK build or already registered) is logged and swallowed.
 */
function registerRootsChangedHandler(server: Server, ctx: SessionContext): void {
	try {
		server.setNotificationHandler("notifications/roots/list_changed", () => {
			void refreshSessionRoots(server, ctx);
		});
	} catch (error) {
		logger.warn("[session] Failed to register roots/list_changed handler", { error: String(error) });
	}
}
