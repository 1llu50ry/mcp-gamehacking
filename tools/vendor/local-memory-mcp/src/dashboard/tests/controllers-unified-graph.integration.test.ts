/**
 * Unified Graph Controller integration tests (TASK-428 split from controllers.integration.test.ts).
 *
 * Covers UnifiedGraphController read endpoints (Unified Graph API) — the
 * owner-scoped merged knowledge + codebase graph.
 *
 * Split from the original 2165-line file; the shared `vi.mock` + server
 * factory live in controllers.shared.ts. Tests are relocated verbatim — no
 * behavior change.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startControllersServer } from "./controllers.shared";

describe("Dashboard Controllers — Unified Graph API", () => {
	let serverHandle: Awaited<ReturnType<typeof startControllersServer>>;
	let baseUrl: string;

	beforeAll(async () => {
		serverHandle = await startControllersServer();
		baseUrl = serverHandle.baseUrl;
	});

	afterAll(async () => {
		await serverHandle.close();
	});

	// ── Unified Graph Controller ───────────────────────────────────────────

	describe("Unified Graph API", () => {
		it("GET /api/unified-graph returns 400 when owner is missing", async () => {
			const res = await fetch(`${baseUrl}/api/unified-graph`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/owner/i);
		});

		it("GET /api/unified-graph?owner=test-owner returns 200 with graph data", async () => {
			const res = await fetch(`${baseUrl}/api/unified-graph?owner=test-owner`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("unified-graph");
			expect(body.data.attributes).toHaveProperty("nodes");
			expect(body.data.attributes).toHaveProperty("edges");
			expect(body.data.attributes).toHaveProperty("stats");
			expect(Array.isArray(body.data.attributes.nodes)).toBe(true);
			expect(Array.isArray(body.data.attributes.edges)).toBe(true);
		});
	});
});
