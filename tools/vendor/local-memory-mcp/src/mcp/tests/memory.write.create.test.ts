/**
 * memory-write CREATE — FIX-020 regression suite.
 *
 * Covers the four defects fixed together:
 *   1. An omitted `importance` used to bind `undefined` into the NOT NULL
 *      `memories.importance` column and fail the INSERT. It now defaults to 3
 *      (schema `.default(3)` + a `?? 3` safety net in `buildMemoryEntry`).
 *   2. A SQLITE_CONSTRAINT / validation failure used to surface as the opaque
 *      `Internal tool error`; it now returns a structured error carrying the
 *      real message + the raw constraint code.
 *   3. A write scoped ONLY via nested `scope:{owner,repo}` used to be
 *      re-targeted to the session/CWD repo (e.g. "agents"); nested scope now
 *      wins over the session-injected top-level owner/repo.
 *   4. The bulk CREATE path hits the same default (parity with single create).
 */

import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";
import type { SessionContext } from "../session";
import { getPrimaryTextContent } from "../utils/mcp-response";

const REPO = "memory-write-create-test";

type Router = (method: string, params: Record<string, unknown>) => Promise<any>;

/** Router wrapper that forces `json:true` (matches the sibling memory-write suites). */
function makeRouter(
	db: Awaited<ReturnType<typeof createTestStore>>,
	vectors: VectorStore,
	session?: SessionContext
): Router {
	const rawRouter = createRouter(db, vectors, session ? { getSessionContext: () => session } : undefined);
	return async (method, params) => {
		const args = (params as Record<string, unknown>)?.arguments as Record<string, unknown> | undefined;
		if (method === "tools/call" && args) {
			args.json = true;
		}
		return rawRouter(method, params);
	};
}

/** Minimal session context (mirrors the normalize-args tests). */
function makeSession(overrides: Partial<SessionContext> = {}): SessionContext {
	return {
		roots: [],
		supportsRoots: false,
		supportsSampling: false,
		supportsSamplingTools: false,
		supportsElicitation: false,
		supportsElicitationForm: false,
		supportsElicitationUrl: false,
		transport: "stdio",
		sessionId: "fix-020-session",
		...overrides
	};
}

describe("memory-write CREATE — importance default (FIX-020)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: Router;

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
		router = makeRouter(db, vectors);
	});

	// ── Positive: omitted importance succeeds and persists the default ──────

	it("creates a memory with importance OMITTED and persists importance=3", async () => {
		const res = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Omitted Importance",
				content: "This create omits importance entirely and must default to 3.",
				scope: { owner: "test", repo: REPO }
			}
		});

		expect(res.isError).toBeFalsy();
		expect(res.structuredContent.success).toBe(true);
		expect(res.structuredContent.importance).toBe(3);
		expect(getPrimaryTextContent(res)).toContain("imp:3");

		const stored = db.memories.getById(res.structuredContent.id);
		expect(stored).not.toBeNull();
		expect(stored!.importance).toBe(3);
	});

	it("honors every explicit in-range importance (1..5)", async () => {
		// Distinct vocabulary per iteration so the near-duplicate conflict gate
		// (MEMORY_CONFLICT_THRESHOLD 0.85) never fires.
		const contents = [
			"Alpha bravo charlie delta echo foxtrot golf hotel india juliet.",
			"Kilo lima mike november oscar papa quebec romeo sierra tango.",
			"Uniform victor whiskey xray yankee zulu amber bronze copper.",
			"Silver golden platinum diamond emerald ruby sapphire topaz.",
			"Mercury venus earth mars jupiter saturn uranus neptune pluto."
		];
		for (const importance of [1, 2, 3, 4, 5]) {
			const res = await router("tools/call", {
				name: "memory-write",
				arguments: {
					type: "code_fact",
					title: `Explicit Importance ${importance}`,
					content: contents[importance - 1],
					importance,
					scope: { owner: "test", repo: REPO }
				}
			});
			expect(res.isError).toBeFalsy();
			expect(res.structuredContent.importance).toBe(importance);
			const stored = db.memories.getById(res.structuredContent.id);
			expect(stored!.importance).toBe(importance);
		}
	});

	// ── Negative: out-of-range importance is rejected ───────────────────────

	it.each([0, 6, -1, 99])(
		"rejects out-of-range importance %i with a structured VALIDATION_ERROR",
		async (importance) => {
			const res = await router("tools/call", {
				name: "memory-write",
				arguments: {
					type: "code_fact",
					title: "Out Of Range",
					content: "This create supplies an importance outside the 1..5 range.",
					importance,
					scope: { owner: "test", repo: REPO }
				}
			});

			expect(res.isError).toBe(true);
			expect(res.structuredContent).toMatchObject({ schema: "tool-error", code: "VALIDATION_ERROR" });
			expect(getPrimaryTextContent(res)).not.toContain("Internal tool error");

			// Nothing was persisted for this rejected create.
			const rows = db.memories.getRecentMemories("test", REPO, 10);
			expect(rows).toHaveLength(0);
		}
	);

	// ── DB CHECK never violated by the default ──────────────────────────────

	it("never violates the memories.importance CHECK constraint when importance is omitted", async () => {
		// Seed several omitted-importance creates with distinct content (so the
		// near-duplicate conflict gate never fires), then assert every stored row
		// sits inside the DB CHECK band — the default must be DB-legal.
		const contents = [
			"Zebra yak xerus walrus vulture unicorn tapir sloth rabbit quokka.",
			"Otter narwhal manatee lemur koala jaguar iguana hedgehog giraffe.",
			"Ferret emu dolphin chinchilla beaver antelope wolverine viper.",
			"Toucan pelican mallard kingfisher ibis heron flamingo egret crane.",
			"Pine oak maple birch cedar willow aspen poplar spruce alder."
		];
		for (let i = 0; i < 5; i++) {
			const res = await router("tools/call", {
				name: "memory-write",
				arguments: {
					type: "code_fact",
					title: `Default Check ${i}`,
					content: contents[i],
					scope: { owner: "test", repo: REPO }
				}
			});
			expect(res.isError).toBeFalsy();
		}

		const rows = db.db
			.prepare("SELECT importance FROM memories WHERE owner = ? AND repo = ?")
			.all("test", REPO) as Array<{ importance: number }>;
		expect(rows).toHaveLength(5);
		for (const row of rows) {
			expect(row.importance).toBeGreaterThanOrEqual(1);
			expect(row.importance).toBeLessThanOrEqual(5);
		}
	});

	// ── Constraint failure → structured error, not "Internal tool error" ────

	it("surfaces a DB constraint failure as a structured error (not 'Internal tool error')", async () => {
		// Omitting `type` reaches the NOT NULL `memories.type` column and trips
		// SQLITE_CONSTRAINT_NOTNULL — the exact class of failure that used to be
		// masked. It must now return the real message + constraint code.
		const res = await router("tools/call", {
			name: "memory-write",
			arguments: {
				title: "Missing Type Constraint",
				content: "This create omits the NOT NULL type column to force a constraint failure.",
				importance: 3,
				scope: { owner: "test", repo: REPO }
			}
		});

		expect(res.isError).toBe(true);
		expect(res.structuredContent.schema).toBe("tool-error");
		expect(res.structuredContent.code).toBe("VALIDATION_ERROR");
		expect(res.structuredContent.message).toMatch(/constraint failed/i);
		expect(res.structuredContent.details).toMatchObject({ constraint: "SQLITE_CONSTRAINT_NOTNULL" });
		expect(getPrimaryTextContent(res)).not.toContain("Internal tool error");
		// No stack trace / secret leakage.
		expect(JSON.stringify(res)).not.toMatch(/at .*\.ts:\d+/);
	});
});

describe("memory-write CREATE — nested scope resolution (FIX-020)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
	});

	it("stores under the requested repo when scope:{owner,repo} is the ONLY scope (not the session 'agents' repo)", async () => {
		// A session whose roots resolve to a project literally named "agents" —
		// the exact shape that used to swallow a nested-scope-only write.
		const agentsRoot = path.join(os.tmpdir(), "fix-020-workspace", "agents");
		const session = makeSession({
			roots: [{ uri: pathToFileURL(agentsRoot).href, name: "agents" }],
			supportsRoots: true,
			repo: "agents",
			owner: "session-owner"
		});
		const router = makeRouter(db, vectors, session);

		const res = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Nested Scope Only",
				content: "This create is scoped only via the nested scope object.",
				scope: { owner: "acme", repo: "requested-repo" }
			}
		});

		expect(res.isError).toBeFalsy();
		expect(res.structuredContent.repo).toBe("requested-repo");

		// Stored under the REQUESTED repo…
		const requested = db.memories.getRecentMemories("acme", "requested-repo", 10);
		expect(requested.map((m) => m.title)).toContain("Nested Scope Only");

		// …and NOT under the session's "agents" repo.
		const agents = db.memories.getRecentMemories("session-owner", "agents", 10);
		expect(agents.map((m) => m.title)).not.toContain("Nested Scope Only");
	});

	it("falls back to the session-derived repo ONLY when both top-level and nested scope are absent", async () => {
		const agentsRoot = path.join(os.tmpdir(), "fix-020-workspace", "agents");
		const session = makeSession({
			roots: [{ uri: pathToFileURL(agentsRoot).href, name: "agents" }],
			supportsRoots: true,
			repo: "agents",
			owner: "session-owner"
		});
		const router = makeRouter(db, vectors, session);

		const res = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "No Scope At All",
				content: "This create supplies no scope, so the session repo is the only fallback."
			}
		});

		expect(res.isError).toBeFalsy();
		// The repo falls back to the session-derived repo ("agents"). Owner is
		// derived from the root's parent directory by normalize-args (not the
		// session owner), so we assert on repo + look the row up by title rather
		// than guessing the owner.
		expect(res.structuredContent.repo).toBe("agents");
		const row = db.db.prepare("SELECT repo FROM memories WHERE title = ?").get("No Scope At All") as
			| { repo: string }
			| undefined;
		expect(row?.repo).toBe("agents");
	});
});

describe("memory-write CREATE — UPDATE/ACKNOWLEDGE unaffected by the importance default (FIX-020)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: Router;

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
		router = makeRouter(db, vectors);
	});

	it("an UPDATE that omits importance does NOT write a spurious importance change", async () => {
		const created = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Update Untouched Importance",
				content: "Created with importance 5; a later title-only update must not touch it.",
				importance: 5,
				scope: { owner: "test", repo: REPO }
			}
		});
		const id = created.structuredContent.id;
		expect(created.structuredContent.importance).toBe(5);

		const updated = await router("tools/call", {
			name: "memory-write",
			arguments: { id, title: "Renamed Only", owner: "test", repo: REPO }
		});

		expect(updated.isError).toBeFalsy();
		// `importance` must NOT appear in the updated-field set…
		expect(updated.structuredContent.updatedFields).not.toContain("importance");
		// …and the stored value stays 5.
		expect(db.memories.getById(id)!.importance).toBe(5);
	});

	it("an ACKNOWLEDGE does not touch importance", async () => {
		const created = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Ack Untouched Importance",
				content: "Created with importance 2; acknowledging must not change it.",
				importance: 2,
				scope: { owner: "test", repo: REPO }
			}
		});
		const id = created.structuredContent.id;

		const ack = await router("tools/call", {
			name: "memory-write",
			arguments: { id, acknowledge: "used", owner: "test", repo: REPO }
		});

		expect(ack.isError).toBeFalsy();
		expect(db.memories.getById(id)!.importance).toBe(2);
	});
});

describe("memory-write BULK CREATE — omitted importance parity (FIX-020)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: Router;

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
		router = makeRouter(db, vectors);
	});

	it("bulk create items with omitted importance default to 3, matching single create", async () => {
		const bulkRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				owner: "test",
				repo: REPO,
				memories: [
					{
						type: "code_fact",
						title: "Bulk Omitted A",
						content: "First bulk item omits importance entirely."
					},
					{
						type: "decision",
						title: "Bulk Explicit B",
						content: "Second bulk item sets importance explicitly to 4.",
						importance: 4
					}
				]
			}
		});

		expect(bulkRes.isError).toBeFalsy();
		expect(bulkRes.structuredContent.success).toBe(true);
		expect(bulkRes.structuredContent.processed).toBe(2);

		const rows = db.memories.getRecentMemories("test", REPO, 10);
		const byTitle = new Map(rows.map((r) => [r.title, r.importance]));
		expect(byTitle.get("Bulk Omitted A")).toBe(3);
		expect(byTitle.get("Bulk Explicit B")).toBe(4);
	});
});
