// Integration test for the onResourcesMutated emission path (OPT-DRY-08).
//
// collectAffectedResourceUris (utils/tool-plumbing.ts) is unit-tested in
// tool-plumbing.test.ts, but the end-to-end emission — the router callback at
// router.ts:215-218 and the shared SDK write path at tools/index.ts:296-300 —
// had no direct test. These tests dispatch real write/read tools through
// createRouter with a spy onResourcesMutated hook and assert:
//   1. write tools notify the affected entity URIs (memory://{id}, task://{id})
//      derived from result.structuredContent (the OPT-DRY-08 fix);
//   2. read tools emit no ENTITY-level mutation notifications when they return
//      no result rows — entity URIs can only come from a tool whose
//      structuredContent carries rows (or args id).
//
// NOTE (read-path behavior): collectAffectedResourceUris derives
// repository:// collection URIs from the args repo for any memory/task-domain
// tool, so a memory-read WITH a repo still triggers the hook with
// repository-scope invalidation. addTableIds (utils/tool-plumbing.ts) runs for
// any memory-domain tool returning structuredContent, so a memory-read WITH
// result rows DOES emit memory://{id} entity URIs (per MEM-887); they are
// absent in these tests only because the store is empty, so the reads are
// row-less. A read with no affected scope (standard-read list) does not invoke
// the hook at all. Gating reads fully silent would require a WRITE_TOOLS check
// in router.ts/tools/index.ts — out of this test's scope.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";

// FIX-110-A: GitHub Actions exports GITHUB_REPOSITORY=<owner>/<repo>, and
// utils/constants.ts captures it (plus LOCAL_MEMORY_DEFAULT_*) as module-load
// snapshot constants. Left in place, the env-default scope tier resolves a repo
// for the scope-less standard-read below, so the router emits repository://index
// and the "no repo scope" assertion becomes environment-dependent. Delete the
// vars before any module is imported (vi.hoisted runs above the static imports)
// so the tier is inert: the snapshot constants are undefined and envStr()
// returns undefined at call time.
vi.hoisted(() => {
	delete process.env.GITHUB_REPOSITORY;
	delete process.env.LOCAL_MEMORY_DEFAULT_OWNER;
	delete process.env.LOCAL_MEMORY_DEFAULT_REPO;
});
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY_URI_RE = /^(memory|task):\/\//;

describe("onResourcesMutated — resource mutation notification emission (OPT-DRY-08)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	const REPO = "notify-test-repo";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
	});

	it("memory-write (create, json) emits memory://{id} derived from structuredContent", async () => {
		const onResourcesMutated = vi.fn();
		const router = createRouter(db, vectors, { onResourcesMutated });

		const res: any = await router("tools/call", {
			name: "memory-write",
			arguments: {
				owner: "test",
				repo: REPO,
				type: "code_fact",
				title: "Notification emission path",
				content: "onResourcesMutated must carry memory:// URIs derived from structuredContent.",
				importance: 3,
				json: true
			}
		});

		expect(res.structuredContent).toBeDefined();
		const memoryId = res.structuredContent.id as string;
		expect(memoryId).toMatch(UUID_RE);

		// memory-write create carries no id in args, so memory://{id} can ONLY
		// come from reading result.structuredContent.id — the OPT-DRY-08 fix.
		expect(onResourcesMutated).toHaveBeenCalledTimes(1);
		const uris = onResourcesMutated.mock.calls[0][0] as string[];
		expect(uris).toContain(`memory://${memoryId}`);
		expect(uris).toContain(`repository://${REPO}/memories`);
		expect(uris).toContain("repository://index");
	});

	it("task-write (create, json) emits task://{id} derived from structuredContent", async () => {
		const onResourcesMutated = vi.fn();
		const router = createRouter(db, vectors, { onResourcesMutated });

		const res: any = await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				phase: "testing",
				title: "Notify hook integration",
				description: "task-write create must emit task:// URIs derived from structuredContent.",
				priority: 3,
				json: true
			}
		});

		expect(res.structuredContent).toBeDefined();
		const taskId = res.structuredContent.id as string;
		expect(taskId).toMatch(UUID_RE);

		expect(onResourcesMutated).toHaveBeenCalledTimes(1);
		const uris = onResourcesMutated.mock.calls[0][0] as string[];
		expect(uris).toContain(`task://${taskId}`);
		expect(uris).toContain(`repository://${REPO}/tasks`);
		// task-write is hardcoded as touchesMemory in tool-plumbing.ts:104, so
		// its repository://{REPO}/memories collection URI is emitted regardless
		// of whether any memory row was actually written.
		expect(uris).toContain(`repository://${REPO}/memories`);
		expect(uris).toContain("repository://index");
	});

	it("memory-read (read tool) emits no entity mutation URIs (memory://{id}/task://{id})", async () => {
		const onResourcesMutated = vi.fn();
		const router = createRouter(db, vectors, { onResourcesMutated });

		// Empty store + json:true → structuredContent present but zero rows, so
		// no entity ids can be derived. Reads must never notify entity mutations.
		const res: any = await router("tools/call", {
			name: "memory-read",
			arguments: { query: "nothing", owner: "test", repo: REPO, limit: 5, json: true }
		});

		expect(res.structuredContent).toBeDefined();

		// The hook may fire with repository-scope invalidation (repo-derived
		// collection URIs — documented above), but never with entity URIs.
		expect(onResourcesMutated).toHaveBeenCalledTimes(1);
		const uris = onResourcesMutated.mock.calls[0][0] as string[];
		expect(uris).toHaveLength(2);
		expect(uris.some((uri) => ENTITY_URI_RE.test(uri))).toBe(false);
		expect(uris.every((uri) => uri.startsWith("repository://"))).toBe(true);
	});

	it("standard-read (pure read, no repo scope) does NOT invoke onResourcesMutated", async () => {
		const onResourcesMutated = vi.fn();
		const router = createRouter(db, vectors, { onResourcesMutated });

		const res: any = await router("tools/call", {
			name: "standard-read",
			// `json: true` is required to observe structuredContent: audit F4
			// removed the hardcoded `includeJson: true` from list/search mode, so
			// standard-read now honours the flag consistently with every other
			// read tool.
			arguments: { limit: 5, json: true }
		});

		// The read itself succeeds (list mode) — the absence of a notification is
		// not a failure path.
		expect(res.structuredContent).toBeDefined();
		expect(res.structuredContent.mode).toBe("list");
		expect(onResourcesMutated).not.toHaveBeenCalled();
	});
});
