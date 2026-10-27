/**
 * Codebase routes — route-level integration tests.
 *
 * Scope (REFACTOR-TST-008): route REGISTRATION (exact method+path table in
 * registration order via router stack introspection), MOUNTING (prefix
 * resolution over HTTP), and PARAM/404 handling (400 for missing required
 * params, 404 for unknown sub-paths / method mismatches). Deep controller +
 * tool-handler behavior is owned by codebase-api.integration.test.ts and is
 * NOT duplicated here.
 *
 * Unlike the other dashboard routes, codebase endpoints return the raw
 * `{ error, code }` shape (CodebaseController.onCodebaseError) instead of a
 * JSON:API envelope — the negatives assert that contract.
 *
 * Conventions: mocked context with an in-memory SQLiteStore (same pattern as
 * controllers.integration.test.ts); `*.integration.test.ts` suffix and
 * module-mirrored path per .agents/documents/testing.md §2.1/§3.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Router } from "express";
import type { AddressInfo } from "node:net";

// ── Mock context.ts (must precede any import that transitively loads it) ──

vi.mock("../../../dashboard/lib/context", async () => {
	const { SQLiteStore } = await import("../../../mcp/storage/sqlite");
	const db = new SQLiteStore(":memory:");

	return {
		db,
		vectors: {
			upsert: vi.fn(),
			remove: vi.fn(),
			search: vi.fn().mockResolvedValue([])
		},
		mcpClient: {
			start: vi.fn(),
			stop: vi.fn(),
			isConnected: vi.fn(() => false),
			getPendingCount: vi.fn(() => 0),
			callTool: vi.fn().mockResolvedValue({ structuredContent: { success: true } })
		},
		// QueueController.status / SystemService.getMetrics read worker stats
		// (MEM-697): stub so those endpoints run without a real worker.
		embeddingWorker: {
			getStats: vi.fn().mockReturnValue({
				pending: 0,
				claimed: 0,
				done: 0,
				poison: 0,
				total: 0,
				processed: 0,
				failed: 0,
				poisoned: 0,
				lastBatchSize: 0,
				lastRunAt: null,
				running: false,
				started: false,
				modelReady: false,
				pollIntervalMs: 5000,
				batchSize: 8,
				leaseMs: 60_000
			})
		},
		logger: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn()
		},
		startTime: Date.now()
	};
});

// ── Route table introspection (Express 5 router.stack) ────────────────────

interface RegisteredRoute {
	method: string;
	path: string;
}

/**
 * Collect every registered route as `{ method, path }`, in registration
 * order. Order is SEMANTIC here — the static `GET /file/content` +
 * `POST /file/content` pair and `GET /symbol/callers` are exact-path routes
 * that must not be reordered against `/trace`/`/graph`. The runtime
 * `route.methods` map is not part of the @types surface; narrow with an
 * intersection, never `any`.
 */
function collectRouteTable(router: Router): RegisteredRoute[] {
	const table: RegisteredRoute[] = [];
	for (const layer of router.stack) {
		const route = layer.route as { path: string; methods?: Record<string, boolean> } | undefined;
		if (!route) continue;
		for (const method of Object.keys(route.methods ?? {})) {
			table.push({ method: method.toUpperCase(), path: route.path });
		}
	}
	return table;
}

// ── Codebase error shape (raw, not JSON:API — onCodebaseError) ────────────

interface CodebaseErrorBody {
	error?: string;
	code?: string;
}

/** Assert a CodebaseController boundary-validation 400 with its machine code. */
async function expectCodebaseError(url: string, code: string, init?: RequestInit): Promise<void> {
	const res = await fetch(url, init);
	expect(res.status).toBe(400);
	const body = (await res.json()) as CodebaseErrorBody;
	expect(body.code).toBe(code);
	expect(body.error).toBeDefined();
}

const POST_JSON: RequestInit = {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: "{}"
};

describe("Codebase routes", () => {
	let app: express.Express;
	let server: ReturnType<express.Express["listen"]>;
	let baseUrl: string;

	beforeAll(async () => {
		const router = (await import("../../routes/codebase.routes")).default;
		app = express();
		app.use(express.json());
		app.use("/api/codebase", router);
		server = app.listen(0);
		const { port } = server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${port}`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
	});

	describe("route registration", () => {
		it("registers the full codebase route table in order", async () => {
			const { default: router } = await import("../../routes/codebase.routes");
			expect(collectRouteTable(router)).toEqual([
				{ method: "GET", path: "/architecture" },
				{ method: "GET", path: "/symbols" },
				{ method: "GET", path: "/search" },
				{ method: "GET", path: "/code-search" },
				{ method: "GET", path: "/trace" },
				{ method: "GET", path: "/file/content" },
				{ method: "POST", path: "/file/content" },
				{ method: "GET", path: "/symbol/callers" },
				{ method: "GET", path: "/graph" },
				{ method: "GET", path: "/index-status" },
				{ method: "POST", path: "/index" },
				{ method: "POST", path: "/auto-index" }
			]);
		});
	});

	describe("mounting", () => {
		it("GET /api/codebase/index-status?repo=... resolves (200, raw payload)", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/index-status?repo=test-owner/test-repo`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, unknown>;
			expect(body).toHaveProperty("repo");
			expect(body).toHaveProperty("isIndexed");
		});
	});

	describe("param validation (boundary 400s)", () => {
		it("GET /api/codebase/architecture without repo returns 400 MISSING_REPO", async () => {
			await expectCodebaseError(`${baseUrl}/api/codebase/architecture`, "MISSING_REPO");
		});

		it("GET /api/codebase/symbols without filePath returns 400 MISSING_FILE_PATH", async () => {
			await expectCodebaseError(`${baseUrl}/api/codebase/symbols?repo=test-owner/test-repo`, "MISSING_FILE_PATH");
		});

		it("GET /api/codebase/code-search without content returns 400 MISSING_CONTENT", async () => {
			await expectCodebaseError(`${baseUrl}/api/codebase/code-search?repo=test-owner/test-repo`, "MISSING_CONTENT");
		});

		it("GET /api/codebase/trace without name returns 400 MISSING_NAME", async () => {
			await expectCodebaseError(`${baseUrl}/api/codebase/trace`, "MISSING_NAME");
		});

		it("GET /api/codebase/file/content without repo returns 400 MISSING_REPO", async () => {
			await expectCodebaseError(`${baseUrl}/api/codebase/file/content`, "MISSING_REPO");
		});

		it("GET /api/codebase/symbol/callers without name returns 400 MISSING_NAME", async () => {
			await expectCodebaseError(`${baseUrl}/api/codebase/symbol/callers?repo=test-owner/test-repo`, "MISSING_NAME");
		});

		it("GET /api/codebase/graph without repo returns 400 MISSING_REPO", async () => {
			await expectCodebaseError(`${baseUrl}/api/codebase/graph`, "MISSING_REPO");
		});

		it("GET /api/codebase/index-status without repo returns 400 MISSING_REPO", async () => {
			await expectCodebaseError(`${baseUrl}/api/codebase/index-status`, "MISSING_REPO");
		});

		it("POST /api/codebase/index without repo returns 400 MISSING_REPO", async () => {
			await expectCodebaseError(`${baseUrl}/api/codebase/index`, "MISSING_REPO", POST_JSON);
		});

		it("POST /api/codebase/index without repoPath returns 400 MISSING_REPO_PATH", async () => {
			await expectCodebaseError(
				`${baseUrl}/api/codebase/index`,
				"MISSING_REPO_PATH",
				jsonBody({ repo: "test-owner/test-repo" })
			);
		});

		it("POST /api/codebase/auto-index without repo returns 400 MISSING_REPO", async () => {
			await expectCodebaseError(`${baseUrl}/api/codebase/auto-index`, "MISSING_REPO", POST_JSON);
		});
	});

	describe("404 handling", () => {
		it("GET /api/codebase/<unknown>/deeper returns 404 (unregistered sub-path)", async () => {
			expect((await fetch(`${baseUrl}/api/codebase/unknown/deeper`)).status).toBe(404);
		});

		it("DELETE /api/codebase/architecture returns 404 (GET-only route, method mismatch)", async () => {
			expect((await fetch(`${baseUrl}/api/codebase/architecture`, { method: "DELETE" })).status).toBe(404);
		});
	});
});

/** Build a JSON POST request init from a plain payload. */
function jsonBody(payload: Record<string, unknown>): RequestInit {
	return {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload)
	};
}
