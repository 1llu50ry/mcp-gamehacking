import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { MemoryEntry, VectorStore } from "../types";
import { getPrimaryTextContent } from "../utils/mcp-response";

// ─── Acknowledged-state surfacing (TASK-423) ─────────────────────────────
// AC1: every result item shows acknowledged/unacknowledged.
// AC2: unacknowledged memories are prioritized/marked in search results.
// AC3: work-themed queries are not dominated by pure task_archive via
//      "Task"-in-title keyword collision.
//
// Fixtures are inserted at the DB layer (bypassing memory-write's content
// conflict check) so two fixtures can share identical title/content — that
// makes every relevance signal (bm25 keyword, similarity, recency) IDENTICAL
// and isolates exactly the signal under test (acknowledged state / type).
//
// Split out from memory.read.test.ts (TASK-439) to keep that file within the
// 500-line maintainability limit. Setup mirrors the original describe:
// createTestStore + StubVectorStore + json:true router wrapper.

describe("memory-read acknowledged-state surfacing (TASK-423)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: Record<string, unknown>) => Promise<any>;

	const REPO = "ack-state-repo";
	const NOW = new Date().toISOString();

	const insertMemory = (overrides: Partial<MemoryEntry> & { id: string; title: string; content: string }): void => {
		db.memories.insert({
			type: "code_fact",
			importance: 4,
			agent: "test-agent",
			role: "test-role",
			model: "test-model",
			scope: { owner: "test", repo: REPO },
			created_at: NOW,
			updated_at: NOW,
			completed_at: null,
			hit_count: 0,
			recall_count: 0,
			last_used_at: null,
			expires_at: null,
			supersedes: null,
			status: "active",
			tags: [],
			metadata: {},
			is_global: false,
			...overrides
		});
	};

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
		const rawRouter = createRouter(db, vectors);
		router = async (method, params) => {
			const args = (params as Record<string, unknown>)?.arguments as Record<string, unknown> | undefined;
			if (method === "tools/call" && args) {
				args.json = true;
			}
			return rawRouter(method, params);
		};
	});

	const search = async (query: string, limit = 10) => {
		const res = await router("tools/call", {
			name: "memory-read",
			arguments: { query, owner: "test", repo: REPO, limit }
		});
		return res.structuredContent as {
			columns: string[];
			rows: Array<[string, string | undefined, string, string, number, boolean]>;
			count: number;
		};
	};

	it("AC1: surfaces acknowledged status per item in SEARCH rows and text markers", async () => {
		insertMemory({ id: "ack-a", title: "Ack A Topic", content: "ack a topic alpha" });
		insertMemory({ id: "ack-b", title: "Ack B Topic", content: "ack b topic beta" });
		db.memories.incrementRecallCount("ack-b");

		const results = await search("ack topic");
		expect(results.columns).toContain("acknowledged");
		const rowA = results.rows.find((r) => r[0] === "ack-a");
		const rowB = results.rows.find((r) => r[0] === "ack-b");
		expect(rowA?.[5]).toBe(false);
		expect(rowB?.[5]).toBe(true);

		// Every rendered line carries an explicit marker (ACK1: both states).
		const text = getPrimaryTextContent(
			await router("tools/call", {
				name: "memory-read",
				arguments: { query: "ack topic", owner: "test", repo: REPO, limit: 10 }
			})
		);
		expect(text).toContain("[unacked]");
		expect(text).toContain("[acked]");
		expect(text).toContain("unacknowledged");
	});

	it("AC2: prioritizes unacknowledged memories over identical-relevance acknowledged ones", async () => {
		// Identical title/content/tags/importance — every signal equal except
		// the acknowledged state; the unacknowledged one MUST rank first.
		insertMemory({ id: "unacked-x", title: "Alpha review workflow", content: "alpha review workflow pipeline" });
		insertMemory({ id: "acked-x", title: "Alpha review workflow", content: "alpha review workflow pipeline" });
		db.memories.incrementRecallCount("acked-x");

		const results = await search("alpha review workflow");
		expect(results.rows[0][0]).toBe("unacked-x");
		expect(results.rows[0][5]).toBe(false);
	});

	it("AC3: does not let task_archive crowd out work-type memories via title keyword collision", async () => {
		// Same relevance, same acknowledged state (both unacked): only the TYPE
		// differs. A keyword-heavy work query ("task") matches the task_archive
		// title, but the domain penalty must keep the code_fact above it.
		const sharedTitle = "Completed task alpha pipeline task review";
		const sharedContent = "completed task alpha pipeline task review work";
		insertMemory({
			id: "work-1",
			type: "code_fact",
			title: sharedTitle,
			content: sharedContent
		});
		insertMemory({
			id: "archive-1",
			type: "task_archive",
			title: sharedTitle,
			content: sharedContent
		});

		const results = await search("active task");
		expect(results.count).toBeGreaterThanOrEqual(2);
		// The work-type memory ranks above the pure task_archive record.
		const archiveIdx = results.rows.findIndex((r) => r[0] === "archive-1");
		const workIdx = results.rows.findIndex((r) => r[0] === "work-1");
		expect(workIdx).toBeGreaterThanOrEqual(0);
		expect(workIdx).toBeLessThan(archiveIdx);
		expect(results.rows[workIdx][3]).toBe("code_fact");
	});

	it("AC1: shows Acknowledged in DETAIL text + structured field", async () => {
		// The detail handler branches on UUID shape (UUID → getById, else code
		// lookup), so fixture ids here must be UUIDs.
		const idUnacked = "11111111-1111-4111-a111-111111111111";
		const idAcked = "22222222-2222-4222-a222-222222222222";
		insertMemory({ id: idUnacked, title: "Detail Ack State", content: "detail ack state content" });
		insertMemory({ id: idAcked, title: "Detail Ack State 2", content: "detail ack state content two" });
		db.memories.incrementRecallCount(idAcked);

		const unackedRes = await router("tools/call", {
			name: "memory-read",
			arguments: { id: idUnacked, owner: "test", repo: REPO }
		});
		expect(getPrimaryTextContent(unackedRes)).toContain("Acknowledged: no");
		expect(unackedRes.structuredContent.memory.acknowledged).toBe(false);

		const ackedRes = await router("tools/call", {
			name: "memory-read",
			arguments: { id: idAcked, owner: "test", repo: REPO }
		});
		expect(getPrimaryTextContent(ackedRes)).toContain("Acknowledged: yes");
		expect(ackedRes.structuredContent.memory.acknowledged).toBe(true);
	});

	it("AC1: shows acknowledged status in RECAP top rows + timeline markers", async () => {
		insertMemory({ id: "recap-unacked", title: "Recap Ack One", content: "recap ack one content" });
		insertMemory({ id: "recap-acked", title: "Recap Ack Two", content: "recap ack two content" });
		db.memories.incrementRecallCount("recap-acked");

		const recapRes = await router("tools/call", {
			name: "memory-read",
			arguments: { owner: "test", repo: REPO, limit: 10 }
		});
		const content = recapRes.structuredContent;
		expect(content.top.columns).toContain("acknowledged");
		const rowUnacked = content.top.rows.find((r: string[]) => r[0] === "recap-unacked");
		const rowAcked = content.top.rows.find((r: string[]) => r[0] === "recap-acked");
		expect(rowUnacked?.[5]).toBe(false);
		expect(rowAcked?.[5]).toBe(true);

		const text = getPrimaryTextContent(recapRes);
		expect(text).toContain("[unacked]");
		expect(text).toContain("[acked]");
	});
});
