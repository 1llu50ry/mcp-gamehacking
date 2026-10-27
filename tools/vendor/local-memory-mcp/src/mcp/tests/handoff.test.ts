import { describe, it, expect, beforeEach } from "vitest";
import { SQLiteStore, createTestStore } from "../storage/sqlite";
import { HandoffEntity, AmbiguousHandoffError } from "../entities/handoff";

describe("Handoff and Claim Storage", () => {
	let store: SQLiteStore;
	let handoffs: HandoffEntity;

	beforeEach(async () => {
		store = await createTestStore();
		handoffs = store.handoffs;
	});

	describe("Handoffs", () => {
		it("should create and retrieve a handoff", () => {
			const handoff = handoffs.createHandoff({
				owner: "test",
				repo: "test-repo",
				from_agent: "agent-a",
				to_agent: "agent-b",
				summary: "Need help with X",
				context: { key: "value" }
			});

			expect(handoff.id).toBeDefined();
			expect(handoff.repo).toBe("test-repo");
			expect(handoff.from_agent).toBe("agent-a");
			expect(handoff.to_agent).toBe("agent-b");
			expect(handoff.status).toBe("pending");
			expect(handoff.context).toEqual({ key: "value" });

			const retrieved = handoffs.getHandoffById(handoff.id);
			expect(retrieved).toBeDefined();
			expect(retrieved?.id).toBe(handoff.id);
		});

		it("should list handoffs with filters", () => {
			handoffs.createHandoff({ owner: "test", repo: "repo-1", from_agent: "a", summary: "1" });
			handoffs.createHandoff({ owner: "test", repo: "repo-1", from_agent: "a", to_agent: "b", summary: "2" });
			handoffs.createHandoff({ owner: "test", repo: "repo-2", from_agent: "a", summary: "3" });

			const allRepo1 = handoffs.listHandoffs({ owner: "test", repo: "repo-1" });
			expect(allRepo1.length).toBe(2);

			const toB = handoffs.listHandoffs({ owner: "test", repo: "repo-1", to_agent: "b" });
			expect(toB.length).toBe(1);
			expect(toB[0].summary).toBe("2");
		});

		it("should update handoff status", () => {
			const handoff = handoffs.createHandoff({ owner: "test", repo: "test-repo", from_agent: "a", summary: "1" });
			expect(handoff.status).toBe("pending");

			const success = handoffs.updateHandoffStatus(handoff.id, "accepted");
			expect(success).toBe(true);

			const updated = handoffs.getHandoffById(handoff.id);
			expect(updated?.status).toBe("accepted");
		});

		// FIX-023: short-id prefix resolution — the list view renders an 8-char
		// prefix, so lookup by that prefix must resolve the same row.
		describe("short-id prefix resolution (FIX-023)", () => {
			const NOW = "2024-01-01T00:00:00.000Z";

			/** Insert a handoff row with an explicit id (createHandoff uses randomUUID). */
			function insertWithId(id: string, summary = "seeded"): void {
				store.db
					.prepare(
						`INSERT INTO handoffs (id, owner, repo, from_agent, to_agent, task_id, summary, context, status, created_at, updated_at, expires_at)
						 VALUES (?, 'test', 'test-repo', 'agent-a', NULL, NULL, ?, '{}', 'pending', ?, ?, NULL)`
					)
					.run(id, summary, NOW, NOW);
			}

			it("positive: a unique 8-char prefix resolves to the handoff", () => {
				const handoff = handoffs.createHandoff({
					owner: "test",
					repo: "test-repo",
					from_agent: "agent-a",
					summary: "prefix resolution"
				});
				const prefix = handoff.id.slice(0, 8);

				const resolved = handoffs.getHandoffById(prefix);
				expect(resolved).not.toBeNull();
				expect(resolved?.id).toBe(handoff.id);
				expect(resolved?.summary).toBe("prefix resolution");
			});

			it("positive: resolveHandoffId returns the full id for a unique prefix", () => {
				const handoff = handoffs.createHandoff({
					owner: "test",
					repo: "test-repo",
					from_agent: "agent-a",
					summary: "resolve id"
				});
				expect(handoffs.resolveHandoffId(handoff.id.slice(0, 8))).toBe(handoff.id);
			});

			it("positive: full UUID lookup is unchanged", () => {
				const handoff = handoffs.createHandoff({
					owner: "test",
					repo: "test-repo",
					from_agent: "agent-a",
					summary: "full uuid"
				});
				expect(handoffs.resolveHandoffId(handoff.id)).toBe(handoff.id);
				expect(handoffs.getHandoffById(handoff.id)?.id).toBe(handoff.id);
			});

			it("negative: an ambiguous prefix throws AmbiguousHandoffError listing candidates", () => {
				const a = "abcdef01-1111-4111-8111-111111111111";
				const b = "abcdef01-2222-4222-8222-222222222222";
				insertWithId(a, "first");
				insertWithId(b, "second");

				expect(() => handoffs.getHandoffById("abcdef01")).toThrowError(AmbiguousHandoffError);
				try {
					handoffs.getHandoffById("abcdef01");
					throw new Error("expected AmbiguousHandoffError");
				} catch (err) {
					expect(err).toBeInstanceOf(AmbiguousHandoffError);
					const ambiguous = err as AmbiguousHandoffError;
					expect(ambiguous.code).toBe("AMBIGUOUS_ID");
					expect(ambiguous.matches).toEqual([a, b]);
					expect(ambiguous.message).toContain(a);
					expect(ambiguous.message).toContain(b);
				}
			});

			it("negative: an unknown prefix returns null (not-found)", () => {
				handoffs.createHandoff({
					owner: "test",
					repo: "test-repo",
					from_agent: "agent-a",
					summary: "only one"
				});
				expect(handoffs.getHandoffById("deadbeef")).toBeNull();
				expect(handoffs.resolveHandoffId("deadbeef")).toBe("deadbeef");
			});

			it("positive: updateHandoffStatus accepts a unique short-id prefix", () => {
				const handoff = handoffs.createHandoff({
					owner: "test",
					repo: "test-repo",
					from_agent: "agent-a",
					summary: "update by prefix"
				});
				const success = handoffs.updateHandoffStatus(handoff.id.slice(0, 8), "accepted");
				expect(success).toBe(true);
				expect(handoffs.getHandoffById(handoff.id)?.status).toBe("accepted");
			});

			it("negative: updateHandoffStatus on an ambiguous prefix throws before writing", () => {
				const a = "fade0001-1111-4111-8111-111111111111";
				const b = "fade0001-2222-4222-8222-222222222222";
				insertWithId(a);
				insertWithId(b);

				expect(() => handoffs.updateHandoffStatus("fade0001", "accepted")).toThrowError(AmbiguousHandoffError);
				expect(handoffs.getHandoffById(a)?.status).toBe("pending");
				expect(handoffs.getHandoffById(b)?.status).toBe("pending");
			});

			it("negative: a non-hex string is not prefix-resolved (exact miss → null)", () => {
				handoffs.createHandoff({
					owner: "test",
					repo: "test-repo",
					from_agent: "agent-a",
					summary: "wildcard guard"
				});
				// A '%' wildcard must not broaden into a match.
				expect(handoffs.getHandoffById("%")).toBeNull();
			});
		});
	});

	describe("Claims", () => {
		it("should create and retrieve a claim", () => {
			// First, ensure the task exists since there's a foreign key constraint
			store.db.exec(`INSERT INTO tasks (id, owner, repo, task_code, title, status, created_at, updated_at) 
                VALUES ('task-1', '', 'test-repo', 'T-1', 'Test', 'pending', '2023-01-01', '2023-01-01')`);

			const claim = handoffs.claimTask({
				owner: "test",
				repo: "test-repo",
				task_id: "task-1",
				agent: "agent-a",
				role: "developer"
			});

			expect(claim.id).toBeDefined();
			expect(claim.task_id).toBe("task-1");
			expect(claim.agent).toBe("agent-a");
			expect(claim.role).toBe("developer");
			expect(claim.released_at).toBeNull();

			const retrieved = handoffs.getClaim("task-1");
			expect(retrieved).toBeDefined();
			expect(retrieved?.agent).toBe("agent-a");
		});

		it("should release a claim", () => {
			store.db.exec(`INSERT INTO tasks (id, owner, repo, task_code, title, status, created_at, updated_at) 
                VALUES ('task-2', '', 'test-repo', 'T-2', 'Test', 'pending', '2023-01-01', '2023-01-01')`);

			handoffs.claimTask({ owner: "test", repo: "test-repo", task_id: "task-2", agent: "agent-a" });

			let activeClaim = handoffs.getClaim("task-2");
			expect(activeClaim).not.toBeNull();

			const success = handoffs.releaseClaim("task-2", "agent-a");
			expect(success).toBe(true);

			activeClaim = handoffs.getClaim("task-2");
			expect(activeClaim).toBeNull();
		});

		it("should auto-release previous claim when new one is made", () => {
			store.db.exec(`INSERT INTO tasks (id, owner, repo, task_code, title, status, created_at, updated_at) 
                VALUES ('task-3', '', 'test-repo', 'T-3', 'Test', 'pending', '2023-01-01', '2023-01-01')`);

			const claim1 = handoffs.claimTask({ owner: "test", repo: "test-repo", task_id: "task-3", agent: "agent-a" });
			const claim2 = handoffs.claimTask({ owner: "test", repo: "test-repo", task_id: "task-3", agent: "agent-b" });

			const activeClaim = handoffs.getClaim("task-3");
			expect(activeClaim?.id).toBe(claim2.id);
			expect(activeClaim?.agent).toBe("agent-b");

			const allClaims = handoffs.listClaims({ owner: "test", repo: "test-repo" });
			expect(allClaims.length).toBe(2);

			const c1 = allClaims.find((c) => c.id === claim1.id);
			expect(c1?.released_at).not.toBeNull();
		});
	});
});
