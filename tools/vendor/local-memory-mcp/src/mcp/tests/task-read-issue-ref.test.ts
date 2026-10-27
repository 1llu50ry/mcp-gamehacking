import { describe, it, expect, vi } from "vitest";
import { handleTaskWrite } from "../tools/task.write";
import { handleTaskRead } from "../tools/task.read";
import { createTestStore } from "../storage/sqlite";
import { getPrimaryTextContent } from "../utils/mcp-response";
import { VectorStore, VectorResult } from "../types";

/**
 * TASK-422 regression + contract tests — task-read SEARCH must distinguish
 * "text match" from "structurally linked to issue (#NNN)".
 *
 * Fixture semantics (MEM-1518: REAL stores, deterministic keyword path via a
 * vector store that returns nothing — tasks reach the pool through the SQL
 * LIKE candidate fetch, never through mocked embeddings):
 *   - IR-001 "Fix crash issue 544 [#544]"  → structural ref in TITLE
 *   - IR-002 "... issue 544 ..." (no #)     → bare phrase, NO structural ref
 *   - IR-003 "Refactor auth module" + comment "... tracked in #701"
 *                                          → ref only in a COMMENT
 */
function mockVectorStore(results: VectorResult[] = []): VectorStore {
	return {
		upsert: async () => {},
		remove: async () => {},
		search: async () => results
	} as unknown as VectorStore;
}

const vectors = mockVectorStore();

async function seedLinkedFixture(db: Awaited<ReturnType<typeof createTestStore>>, repo: string): Promise<void> {
	await handleTaskWrite(
		{
			owner: "test",
			repo,
			task_code: "IR-001",
			phase: "fix",
			title: "Fix crash issue 544 [#544]",
			description: "Crash on dashboard load",
			status: "pending",
			json: true,
			agent: "test",
			role: "dev"
		},
		db,
		vectors
	);
	// Text-only match: mentions the phrase "issue 544" but has NO #544 ref.
	await handleTaskWrite(
		{
			owner: "test",
			repo,
			task_code: "IR-002",
			phase: "research",
			title: "Investigate report regression",
			description: "Discussed issue 544 with the team in the meeting",
			status: "pending",
			json: true,
			agent: "test",
			role: "dev"
		},
		db,
		vectors
	);
}

describe("task-read issue-reference differentiation (TASK-422)", () => {
	it("marks per-item issue refs and match reason (linked vs text)", async () => {
		const db = await createTestStore();
		const repo = "issue-ref-markers";
		await seedLinkedFixture(db, repo);

		const result = await handleTaskRead({ query: "issue 544", owner: "test", repo, json: true }, db, mockVectorStore());
		const structured = result.structuredContent as {
			count: number;
			total: number;
			results: { columns: string[]; rows: unknown[][] };
		};
		// Columns are appended (additive contract): [0..8] unchanged,
		// [9] issue_refs, [10] match_reason.
		expect(structured.results.columns.slice(9)).toEqual(["issue_refs", "match_reason"]);
		expect(structured.results.rows).toHaveLength(2);

		const byCode = new Map(structured.results.rows.map((r) => [r[1], r]));
		// IR-001 is structurally linked (#544 in title).
		expect(byCode.get("IR-001")![9]).toBe("#544");
		expect(byCode.get("IR-001")![10]).toBe("issue");
		// IR-002 is a plain text match (bare "issue 544", no #NNN ref).
		expect(byCode.get("IR-002")![9]).toBe("");
		expect(byCode.get("IR-002")![10]).toBe("text");
		db.close();
	});

	it("differentiates linked vs text matches in the text summary with a breakdown line", async () => {
		const db = await createTestStore();
		const repo = "issue-ref-text";
		await seedLinkedFixture(db, repo);

		const result = await handleTaskRead(
			{ query: "issue 544", owner: "test", repo, json: false },
			db,
			mockVectorStore()
		);
		const text = getPrimaryTextContent(result);

		// Header stays honest about the TOTAL match count...
		expect(text).toContain(`### Results: 2 tasks for "issue 544"`);
		// ...and the breakdown separates real links from fuzzy text matches.
		expect(text).toContain("- 1 linked to issue #544 · 1 text matches");
		// Linked items carry an inline marker; text matches do not.
		expect(text).toContain(" [issue #544]");
		db.close();
	});

	it("filters by explicit issue_ref — only tasks with the #NNN link (accepts '#544' form)", async () => {
		const db = await createTestStore();
		const repo = "issue-ref-filter";
		await seedLinkedFixture(db, repo);

		const result = await handleTaskRead(
			{ query: "issue 544", issue_ref: "#544", owner: "test", repo, json: true },
			db,
			mockVectorStore()
		);
		const structured = result.structuredContent as {
			count: number;
			total: number;
			results: { rows: unknown[][] };
		};
		// IR-002 (bare phrase, no ref) is EXCLUDED — count is not inflated.
		expect(structured.count).toBe(1);
		expect(structured.total).toBe(1);
		expect(structured.results.rows).toHaveLength(1);
		expect(structured.results.rows[0][1]).toBe("IR-001");
		expect(structured.results.rows[0][10]).toBe("issue");

		// Text mode header states the linkage filter explicitly.
		const textResult = await handleTaskRead(
			{ query: "issue 544", issue_ref: "544", owner: "test", repo, json: false },
			db,
			mockVectorStore()
		);
		expect(getPrimaryTextContent(textResult)).toContain("### Results: 1 tasks linked to issue #544");

		// Negative control: an unfiltered-matching issue returns nothing.
		const none = await handleTaskRead(
			{ query: "issue 544", issue_ref: "999", owner: "test", repo, json: true },
			db,
			mockVectorStore()
		);
		expect((none.structuredContent as { total: number }).total).toBe(0);
		db.close();
	});

	it("detects refs in COMMENTS — issue_ref filter matches a link that lives only in a comment", async () => {
		const db = await createTestStore();
		const repo = "issue-ref-comment";
		await handleTaskWrite(
			{
				owner: "test",
				repo,
				task_code: "IR-003",
				phase: "refactor",
				title: "Refactor auth module",
				description: "Clean up the auth flow",
				status: "pending",
				json: true,
				agent: "test",
				role: "dev"
			},
			db,
			vectors
		);
		// The only #701 reference lives in a status-transition comment.
		await handleTaskWrite(
			{
				owner: "test",
				repo,
				code: "IR-003",
				status: "in_progress",
				comment: "Root cause found, tracked in #701",
				agent: "test",
				role: "dev"
			},
			db,
			vectors
		);

		const result = await handleTaskRead(
			{ query: "auth", issue_ref: "701", owner: "test", repo, json: true },
			db,
			mockVectorStore()
		);
		const structured = result.structuredContent as { total: number; results: { rows: unknown[][] } };
		expect(structured.total).toBe(1);
		expect(structured.results.rows[0][1]).toBe("IR-003");
		expect(structured.results.rows[0][9]).toBe("#701");
		expect(structured.results.rows[0][10]).toBe("issue");

		// Control: no task links issue 888.
		const none = await handleTaskRead(
			{ query: "auth", issue_ref: "888", owner: "test", repo, json: true },
			db,
			mockVectorStore()
		);
		expect((none.structuredContent as { total: number }).total).toBe(0);
		db.close();
	});

	it("issue_ref alone (no query) enters SEARCH mode and lists only linked tasks", async () => {
		const db = await createTestStore();
		const repo = "issue-ref-only";
		await seedLinkedFixture(db, repo);

		const result = await handleTaskRead({ issue_ref: "544", owner: "test", repo, json: true }, db, mockVectorStore());
		const structured = result.structuredContent as { total: number; results: { rows: unknown[][] } };
		// IR-001 links #544; IR-002 has no ref at all → only IR-001 survives.
		expect(structured.total).toBe(1);
		expect(structured.results.rows).toHaveLength(1);
		expect(structured.results.rows[0][1]).toBe("IR-001");
		expect(structured.results.rows[0][10]).toBe("issue");

		const textResult = await handleTaskRead(
			{ issue_ref: "544", owner: "test", repo, json: false },
			db,
			mockVectorStore()
		);
		expect(getPrimaryTextContent(textResult)).toContain("### Results: 1 tasks linked to issue #544");
		db.close();
	});

	it("a bare number query ('544') is NOT treated as an issue token — both items are text matches", async () => {
		const db = await createTestStore();
		const repo = "issue-ref-bare-number";
		await seedLinkedFixture(db, repo);

		const result = await handleTaskRead({ query: "544", owner: "test", repo, json: true }, db, mockVectorStore());
		const structured = result.structuredContent as { results: { rows: unknown[][] } };
		expect(structured.results.rows).toHaveLength(2);
		for (const row of structured.results.rows) {
			// No issue intent in the query → nothing is marked "linked",
			// even though IR-001 still carries [#544] in issue_refs.
			expect(row[10]).toBe("text");
		}
		const byCode = new Map(structured.results.rows.map((r) => [r[1], r]));
		expect(byCode.get("IR-001")![9]).toBe("#544");
		expect(byCode.get("IR-002")![9]).toBe("");
		db.close();
	});

	it("TASK-436: issue_ref-only search fetches comments ONLY for tasks not already linked via title/description", async () => {
		const db = await createTestStore();
		const repo = "issue-ref-gated-fetch";
		await seedLinkedFixture(db, repo);
		// IR-001 carries [#544] in its TITLE (pre-matched by the filter);
		// IR-002 has no structural ref anywhere — its comments are the only
		// place a #544 link could hide.
		const tasks = db.tasks.getTasksByRepo("test", repo);
		const ir001 = tasks.find((t) => t.task_code === "IR-001")!;
		const ir002 = tasks.find((t) => t.task_code === "IR-002")!;

		const spy = vi.spyOn(db.taskComments, "getTaskCommentsByTaskIds");
		const result = await handleTaskRead({ issue_ref: "544", owner: "test", repo, json: true }, db, mockVectorStore());

		// The batched comment fetch runs ONCE and covers only the tasks that
		// could gain information from their comments — never the pre-matched
		// IR-001 (whose title already satisfies the filter).
		expect(spy).toHaveBeenCalledTimes(1);
		const fetchIds = spy.mock.calls[0][0] as string[];
		expect(fetchIds).toContain(ir002.id);
		expect(fetchIds).not.toContain(ir001.id);

		// Filter semantics unchanged: only the linked task survives.
		expect((result.structuredContent as { total: number }).total).toBe(1);
		spy.mockRestore();
		db.close();
	});

	it("TASK-436: generic text query does NOT read comments — issue_refs comes from title/description only", async () => {
		const db = await createTestStore();
		const repo = "issue-ref-generic-gate";
		// The only #701 reference lives in a comment (same shape as the
		// comment-link test) — if the gate leaked, a generic "auth" query
		// would surface it via a comment fetch.
		await handleTaskWrite(
			{
				owner: "test",
				repo,
				task_code: "IR-003",
				phase: "refactor",
				title: "Refactor auth module",
				description: "Clean up the auth flow",
				status: "pending",
				json: true,
				agent: "test",
				role: "dev"
			},
			db,
			vectors
		);
		await handleTaskWrite(
			{
				owner: "test",
				repo,
				code: "IR-003",
				status: "in_progress",
				comment: "Root cause found, tracked in #701",
				agent: "test",
				role: "dev"
			},
			db,
			vectors
		);

		const spy = vi.spyOn(db.taskComments, "getTaskCommentsByTaskIds");
		const result = await handleTaskRead({ query: "auth", owner: "test", repo, json: true }, db, mockVectorStore());
		const structured = result.structuredContent as { total: number; results: { rows: unknown[][] } };

		// No issue intent → comments are never fetched...
		expect(spy).not.toHaveBeenCalled();
		// ...and issue_refs is honestly filled from title/description alone:
		// the comment-only ref #701 does NOT appear on a generic query.
		expect(structured.total).toBe(1);
		const row = structured.results.rows[0];
		expect(row[1]).toBe("IR-003");
		expect(row[9]).toBe("");
		expect(row[10]).toBe("text");

		// Same task on an issue-scoped search DOES surface the comment ref
		// (the gate only applies to non-issue queries).
		const scoped = await handleTaskRead(
			{ query: "auth", issue_ref: "701", owner: "test", repo, json: true },
			db,
			mockVectorStore()
		);
		const scopedRows = (scoped.structuredContent as { results: { rows: unknown[][] } }).results.rows;
		expect(scopedRows[0][9]).toBe("#701");
		expect(scopedRows[0][10]).toBe("issue");

		spy.mockRestore();
		db.close();
	});

	it("TASK-437: comment-ref detection survives the >500 id batch boundary in getTaskCommentsByTaskIds", async () => {
		const db = await createTestStore();
		const repo = "issue-ref-chunk-500";
		const LINKED_CODE = "CHK-519";
		// 520 tasks: 519 filler (no refs) + 1 whose ONLY #701 link lives in a
		// comment. All `backlog` → ordered by created_at ASC (queries.ts:
		// taskStatusOrderBy), so CHK-519 (created last) lands at the tail
		// (index 519) — INSIDE the SECOND 500-chunk of the batched comment
		// fetch. This is the boundary the regression must hold.
		for (let i = 0; i < 520; i++) {
			const code = i === 519 ? LINKED_CODE : `CHK-${i}`;
			await handleTaskWrite(
				{
					owner: "test",
					repo,
					task_code: code,
					phase: "fix",
					title: `Filler task ${i}`,
					description: "no refs here",
					status: "backlog",
					json: true,
					agent: "test",
					role: "dev"
				},
				db,
				vectors
			);
		}
		// Attach the #701 reference ONLY as a status-transition comment on the
		// tail task (comment-only, no title/description ref) — keeps it in the
		// backlog group so it stays at the chunk-2 position.
		await handleTaskWrite(
			{
				owner: "test",
				repo,
				code: LINKED_CODE,
				status: "backlog",
				comment: "root cause tracked in #701",
				agent: "test",
				role: "dev"
			},
			db,
			vectors
		);

		const spy = vi.spyOn(db.taskComments, "getTaskCommentsByTaskIds");
		const result = await handleTaskRead({ issue_ref: "701", owner: "test", repo, json: true }, db, mockVectorStore());
		const structured = result.structuredContent as { total: number; results: { rows: unknown[][] } };

		// >500 task ids were handed to the batched fetcher in ONE call — the
		// 500-chunk split happens internally, so this proves the >500 path is
		// exercised (not just the first chunk).
		expect(spy).toHaveBeenCalledTimes(1);
		expect((spy.mock.calls[0][0] as string[]).length).toBeGreaterThan(500);
		// The link that lives in chunk 2 is still detected correctly.
		expect(structured.total).toBe(1);
		expect(structured.results.rows[0][1]).toBe(LINKED_CODE);
		expect(structured.results.rows[0][9]).toBe("#701");
		expect(structured.results.rows[0][10]).toBe("issue");
		spy.mockRestore();
		db.close();
	});

	it("TASK-437: query '#544' (hash prefix) normalizes to issue token 544 and links the task", async () => {
		const db = await createTestStore();
		const repo = "issue-ref-hash-query";
		await seedLinkedFixture(db, repo);

		// "#544" → extractQueryIssueTokens strips the '#' to token "544", so
		// IR-001 (which carries [#544] in its title) is matched as a structural
		// link, not a bare text hit.
		const result = await handleTaskRead({ query: "#544", owner: "test", repo, json: true }, db, mockVectorStore());
		const structured = result.structuredContent as { total: number; results: { rows: unknown[][] } };
		expect(structured.total).toBe(1);
		const row = structured.results.rows[0];
		expect(row[1]).toBe("IR-001");
		expect(row[9]).toBe("#544");
		expect(row[10]).toBe("issue");

		// Text mode states the linkage explicitly (hash-prefixed query is still
		// parsed as an issue intent, not a fuzzy text match).
		const text = getPrimaryTextContent(
			await handleTaskRead({ query: "#544", owner: "test", repo, json: false }, db, mockVectorStore())
		);
		expect(text).toContain('### Results: 1 tasks for "#544"');
		expect(text).toContain("- 1 linked to issue #544 · 0 text matches");
		db.close();
	});

	it("TASK-437: plural 'issues 544' query is detected as an issue token and links the task", async () => {
		const db = await createTestStore();
		const repo = "issue-ref-plural";
		// A task whose text literally contains the plural phrase "issues 544"
		// AND carries the structural #544 ref.
		await handleTaskWrite(
			{
				owner: "test",
				repo,
				task_code: "ISS-001",
				phase: "fix",
				title: "Fix regression issues 544 [#544]",
				description: "Flaky on CI, needs investigation",
				status: "pending",
				json: true,
				agent: "test",
				role: "dev"
			},
			db,
			vectors
		);

		// "issues 544" → QUERY_ISSUE_WORD_RE matches the plural form → token
		// "544" (same as the singular "issue 544").
		const result = await handleTaskRead(
			{ query: "issues 544", owner: "test", repo, json: true },
			db,
			mockVectorStore()
		);
		const structured = result.structuredContent as { total: number; results: { rows: unknown[][] } };
		expect(structured.total).toBe(1);
		const row = structured.results.rows[0];
		expect(row[1]).toBe("ISS-001");
		expect(row[9]).toBe("#544");
		expect(row[10]).toBe("issue");

		// Plural phrasing still renders the singular "issue" label + token.
		const text = getPrimaryTextContent(
			await handleTaskRead({ query: "issues 544", owner: "test", repo, json: false }, db, mockVectorStore())
		);
		expect(text).toContain('### Results: 1 tasks for "issues 544"');
		expect(text).toContain("- 1 linked to issue #544 · 0 text matches");
		db.close();
	});

	it("TASK-437: a #ref present ONLY in the DESCRIPTION (not the title) is detected as a link", async () => {
		const db = await createTestStore();
		const repo = "issue-ref-description";
		await handleTaskWrite(
			{
				owner: "test",
				repo,
				task_code: "DESC-001",
				phase: "fix",
				title: "Investigate sporadic crash",
				description: "Root cause traced to module X; see #544 for the upstream report",
				status: "pending",
				json: true,
				agent: "test",
				role: "dev"
			},
			db,
			vectors
		);

		// issue_ref search (no query) lists the whole repo, then filters by the
		// structural ref. The description-only #544 must be caught by the
		// title+description scan — NOT require a comment fetch.
		const spy = vi.spyOn(db.taskComments, "getTaskCommentsByTaskIds");
		const result = await handleTaskRead({ issue_ref: "544", owner: "test", repo, json: true }, db, mockVectorStore());
		const structured = result.structuredContent as { total: number; results: { rows: unknown[][] } };

		// Detected from title+description → pre-matched, so no comment I/O.
		expect(spy).not.toHaveBeenCalled();
		expect(structured.total).toBe(1);
		const row = structured.results.rows[0];
		expect(row[1]).toBe("DESC-001");
		expect(row[9]).toBe("#544");
		expect(row[10]).toBe("issue");
		spy.mockRestore();
		db.close();
	});
});
