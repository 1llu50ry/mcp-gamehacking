import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestStore, SQLiteStore } from "../storage/sqlite";
import { Outbox, enqueueTask, enqueueMemory, enqueueStandard } from "../embedding-queue/outbox";
import { taskJobPayload, memoryJobPayload, standardJobPayload } from "../embedding-queue/enqueue";
import { embedPayloadContentHash } from "../embedding-queue/content-hash";
import { currentEmbeddingModelVersion } from "../storage/embedding-model";
import type { Task } from "../types";
import { makeTask, makeMemory, makeStandard, getJob, REPO } from "./embedding-queue.helpers";

// ---------------------------------------------------------------------------
// Content-hash dedup regression tests (OPT-FLOW-03).
// `Outbox.enqueue` (→ `enqueueEmbeddingJob`) is the SINGLE choke point for
// every enqueue site. It computes `embedPayloadContentHash` over exactly the
// embed/KG-relevant payload fields (text/content/title/parentId/decisionRefs/
// context/stack) and, when an existing non-NULL hash matches AND the row is
// not poisoned, leaves the row untouched and returns `false` — no redundant
// ONNX inference / KG extraction. These tests lock in that contract and its
// edge cases (poison recovery, NULL pre-v16 rows, insert-only backfill).
//
// Split out from embedding-queue.test.ts (TASK-427 refactor) as its own file
// to stay within the 500-line maintainability limit; fixtures are shared from
// embedding-queue.helpers.ts.
// ---------------------------------------------------------------------------

describe("OPT-FLOW-03 — content-hash dedup", () => {
	let db: SQLiteStore;
	let outbox: Outbox;

	beforeEach(async () => {
		db = await createTestStore();
		outbox = new Outbox(db);
	});

	afterEach(() => {
		db.close();
	});

	describe("1. identical-content re-enqueue → dedup", () => {
		it("positive: identical content returns false and leaves the row untouched", () => {
			const task = makeTask();
			db.tasks.insertTask(task);

			// First enqueue inserts the row and stamps the computed hash.
			const payload = taskJobPayload(task);
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(true);
			const before = getJob(db, "task", task.id)!;
			expect(before.content_hash).toBe(embedPayloadContentHash(payload));

			// Identical content re-enqueue → deduped (false), row byte-identical.
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(false);
			const after = getJob(db, "task", task.id)!;
			expect(after.status).toBe(before.status);
			expect(after.attempts).toBe(before.attempts);
			expect(after.payload).toBe(before.payload);
			expect(after.content_hash).toBe(before.content_hash);
			expect(after.updated_at).toBe(before.updated_at);
		});

		it("negative: a completed ('done') row is NOT LWW-reset to pending on identical re-enqueue", () => {
			const task = makeTask();
			db.tasks.insertTask(task);
			const payload = taskJobPayload(task);
			outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload });

			// Row already processed (status 'done'). A broken dedup would LWW-reset
			// it to pending (attempts=0); correct dedup keeps it exactly as-is.
			db.db
				.prepare("UPDATE queue_jobs SET status = 'done', attempts = 4, last_error = NULL WHERE entity_id = ?")
				.run(task.id);
			const before = getJob(db, "task", task.id)!;

			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(false);
			const after = getJob(db, "task", task.id)!;
			expect(after.status).toBe("done");
			expect(after.attempts).toBe(4);
			expect(after.payload).toBe(before.payload);
		});

		it("boundary: a metadata-only touch (tags/priority/updated_at) is deduped, a content change is not", () => {
			const task = makeTask();
			db.tasks.insertTask(task);
			outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload: taskJobPayload(task) });

			// Touch update: only metadata + updated_at bump, no embed/KG field
			// (title/description/decisionRefs/parentId) changed → same hash → dedup.
			const touched = {
				...task,
				tags: ["urgent"],
				priority: 1 as Task["priority"],
				updated_at: new Date().toISOString()
			};
			expect(
				outbox.enqueue({
					kind: "task",
					id: task.id,
					repo: task.repo,
					owner: task.owner,
					payload: taskJobPayload(touched)
				})
			).toBe(false);

			// A real content change (description) produces a different hash → LWW.
			const changed = { ...touched, description: "A completely different description" };
			expect(
				outbox.enqueue({
					kind: "task",
					id: task.id,
					repo: task.repo,
					owner: task.owner,
					payload: taskJobPayload(changed)
				})
			).toBe(true);
		});
	});

	describe("2. changed-content re-enqueue → LWW reset", () => {
		it("positive: a content change returns true, resets the row to pending with a new payload + new content_hash", () => {
			const task = makeTask();
			db.tasks.insertTask(task);

			const original = taskJobPayload(task);
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload: original })).toBe(
				true
			);
			const before = getJob(db, "task", task.id)!;
			expect(before.content_hash).toBe(embedPayloadContentHash(original));

			// Simulate a completed row so the reset to pending is observable.
			db.db.prepare("UPDATE queue_jobs SET status = 'done', attempts = 3 WHERE entity_id = ?").run(task.id);

			// Title change → text = title + "\n" + description changes → LWW reset.
			const updated = { ...task, title: "Changed title", updated_at: new Date().toISOString() };
			const changed = taskJobPayload(updated);
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload: changed })).toBe(
				true
			);

			const after = getJob(db, "task", task.id)!;
			expect(after.status).toBe("pending");
			expect(after.attempts).toBe(0);
			expect(after.content_hash).toBe(embedPayloadContentHash(changed));
			expect(after.content_hash).not.toBe(before.content_hash);
			// Payload carries the new title/description (LWW merges newest write).
			expect(JSON.parse(after.payload as string)).toMatchObject({
				text: "Changed title\nAlice worked on the deployment for Acme Corp"
			});
		});

		it("negative: identical content is NOT LWW-reset to pending — the processed row is left alone", () => {
			const task = makeTask();
			db.tasks.insertTask(task);
			const payload = taskJobPayload(task);
			outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload });

			// Row already processed. A broken LWW (missing dedup guard) would reset
			// it to pending attempts=0 on ANY re-enqueue; correct dedup keeps it as-is.
			db.db.prepare("UPDATE queue_jobs SET status = 'done', attempts = 5 WHERE entity_id = ?").run(task.id);

			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(false);
			const after = getJob(db, "task", task.id)!;
			expect(after.status).toBe("done");
			expect(after.attempts).toBe(5);
			expect(after.content_hash).toBe(embedPayloadContentHash(payload));
		});
	});

	describe("3. poisoned rows bypass dedup (never stranded)", () => {
		it("positive: identical content on a poison row returns true and resets poison → pending", () => {
			const task = makeTask();
			db.tasks.insertTask(task);
			const payload = taskJobPayload(task);
			outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload });

			// The exact same content previously poisoned this row.
			db.db.prepare("UPDATE queue_jobs SET status = 'poison' WHERE entity_id = ?").run(task.id);

			// Unlike a healthy row, a poison row with unchanged hash MUST be
			// re-enqueued (LWW reset to pending) so it gets another chance.
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(true);
			const after = getJob(db, "task", task.id)!;
			expect(after.status).toBe("pending");
			expect(after.attempts).toBe(0);
			expect(after.content_hash).toBe(embedPayloadContentHash(payload));
		});

		it("negative: once recovered to pending, identical content dedups normally again", () => {
			const task = makeTask();
			db.tasks.insertTask(task);
			const payload = taskJobPayload(task);
			outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload });

			db.db.prepare("UPDATE queue_jobs SET status = 'poison' WHERE entity_id = ?").run(task.id);
			// Recovery: the touch update resets poison → pending.
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(true);
			expect(getJob(db, "task", task.id)!.status).toBe("pending");

			// Now that the row is pending with a matching (non-poison) hash, the
			// dedup engages again — a duplicate is no longer queued.
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(false);
		});
	});

	describe("4. NULL content_hash (pre-v16 row) is never deduped", () => {
		it("positive: identical content on a NULL-hash row returns true and stamps the hash", () => {
			const task = makeTask();
			db.tasks.insertTask(task);
			const payload = taskJobPayload(task);
			outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload });

			// Simulate a row enqueued before migration v16 (no hash stored).
			db.db.prepare("UPDATE queue_jobs SET content_hash = NULL WHERE entity_id = ?").run(task.id);
			expect(getJob(db, "task", task.id)!.content_hash).toBeNull();

			// Identical content but an unknown stored hash → must re-enqueue (so the
			// first v16 write computes and stores the hash) instead of assuming dedup.
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(true);
			const after = getJob(db, "task", task.id)!;
			expect(after.content_hash).toBe(embedPayloadContentHash(payload));
			expect(after.content_hash).not.toBeNull();
		});

		it("negative: after the hash is stamped, an identical re-enqueue dedups", () => {
			const task = makeTask();
			db.tasks.insertTask(task);
			const payload = taskJobPayload(task);
			outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload });

			db.db.prepare("UPDATE queue_jobs SET content_hash = NULL WHERE entity_id = ?").run(task.id);
			// Stamps the hash.
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(true);

			// Now the guard is armed — identical content is a no-op.
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(false);
		});
	});

	describe("5. backfill (enqueueIfAbsent) is insert-only and stores the hash", () => {
		it("positive: an absent task is backfilled with a non-null content_hash", () => {
			const absent = makeTask({ title: "Absent dedup task" });
			db.tasks.insertTask(absent);

			const enqueued = outbox.backfillMissingVectors(100);
			expect(enqueued).toBe(1);

			const row = getJob(db, "task", absent.id)!;
			expect(row).toBeDefined();
			expect(row.status).toBe("pending");
			expect(row.attempts).toBe(0);
			expect(row.content_hash).toBe(embedPayloadContentHash(taskJobPayload(absent)));
			expect(row.content_hash).not.toBeNull();
		});

		it("negative: an existing row whose vector is current is never touched (attempts/status preserved, not deduped away)", () => {
			const absent = makeTask({ title: "Absent dedup task" });
			const existing = makeTask({ title: "Existing dedup task" });
			db.tasks.insertTask(absent);
			db.tasks.insertTask(existing);

			// The existing task is already queued and in a processed state.
			outbox.enqueue({
				kind: "task",
				id: existing.id,
				repo: existing.repo,
				owner: existing.owner,
				payload: taskJobPayload(existing)
			});
			db.db
				.prepare("UPDATE queue_jobs SET status = 'done', attempts = 4, last_error = 'FK failure' WHERE entity_id = ?")
				.run(existing.id);

			// Its vector is already stamped with the current content_hash +
			// model_version, so `needsReembed` is false and the backfill must not
			// revive the terminal row. (PERF-FIX-001: a terminal `done` row whose
			// vector genuinely needs a re-embed IS revived to pending — see
			// embedding-queue.backfill-idempotent.test.ts. This case stays a
			// no-op because the vector is current.)
			db.tasks.upsertTaskVectorEmbedding(existing.id, [0.1, 0.2], {
				contentHash: embedPayloadContentHash(taskJobPayload(existing)),
				modelVersion: currentEmbeddingModelVersion()
			});

			const enqueued = outbox.backfillMissingVectors(100);
			// Only the absent task is inserted — the existing row is untouched.
			expect(enqueued).toBe(1);

			const existingRow = getJob(db, "task", existing.id)!;
			expect(existingRow.status).toBe("done");
			expect(existingRow.attempts).toBe(4);
			expect(existingRow.last_error).toBe("FK failure");
			expect(existingRow.content_hash).toBe(embedPayloadContentHash(taskJobPayload(existing)));

			// The absent task was inserted fresh.
			const absentRow = getJob(db, "task", absent.id)!;
			expect(absentRow.attempts).toBe(0);
			expect(absentRow.status).toBe("pending");
		});
	});

	describe("6. Outbox.enqueue contract + all enqueue sites store the hash", () => {
		it("Outbox.enqueue returns boolean: false on identical re-enqueue, true on changed content", () => {
			const task = makeTask();
			db.tasks.insertTask(task);
			const first = {
				kind: "task" as const,
				id: task.id,
				repo: task.repo,
				owner: task.owner,
				payload: taskJobPayload(task)
			};

			expect(outbox.enqueue(first)).toBe(true);
			// Same entity, identical payload → deduped (boolean false).
			expect(outbox.enqueue(first)).toBe(false);

			// Different entity, fresh insert → boolean true.
			const other = makeTask();
			db.tasks.insertTask(other);
			expect(outbox.enqueue({ ...first, id: other.id, payload: taskJobPayload(other) })).toBe(true);
		});

		it("enqueueMemory / enqueueStandard / enqueueTask still insert a fresh job with a non-null content_hash", () => {
			const memory = makeMemory();
			db.memories.insert(memory);
			const standard = makeStandard();
			db.standards.insert(standard);
			const task = makeTask();
			db.tasks.insertTask(task);

			enqueueMemory(db, memory);
			enqueueStandard(db, standard);
			enqueueTask(db, task);

			const memoryRow = getJob(db, "memory", memory.id)!;
			expect(memoryRow).toBeDefined();
			expect(memoryRow.content_hash).toBe(
				embedPayloadContentHash(
					memoryJobPayload({
						title: memory.title,
						content: memory.content,
						owner: "test",
						repo: REPO,
						updatedAt: memory.updated_at
					})
				)
			);
			expect(memoryRow.content_hash).not.toBeNull();

			const standardRow = getJob(db, "standard", standard.id)!;
			expect(standardRow).toBeDefined();
			expect(standardRow.content_hash).toBe(embedPayloadContentHash(standardJobPayload(standard)));
			expect(standardRow.content_hash).not.toBeNull();

			const taskRow = getJob(db, "task", task.id)!;
			expect(taskRow).toBeDefined();
			expect(taskRow.content_hash).toBe(embedPayloadContentHash(taskJobPayload(task)));
			expect(taskRow.content_hash).not.toBeNull();
		});

		it("a memory title change IS a content change (title is hashed)", () => {
			const memory = makeMemory();
			db.memories.insert(memory);
			const original = memoryJobPayload({
				title: memory.title,
				content: memory.content,
				owner: "test",
				repo: REPO,
				updatedAt: memory.updated_at
			});
			outbox.enqueue({ kind: "memory", id: memory.id, repo: REPO, owner: "test", payload: original });

			// text = content (unchanged) but title changed → different hash → LWW.
			const retitled = { ...memory, title: "A brand new memory title" };
			const changed = memoryJobPayload({
				title: retitled.title,
				content: retitled.content,
				owner: "test",
				repo: REPO,
				updatedAt: retitled.updated_at
			});
			expect(embedPayloadContentHash(changed)).not.toBe(embedPayloadContentHash(original));
			expect(outbox.enqueue({ kind: "memory", id: memory.id, repo: REPO, owner: "test", payload: changed })).toBe(true);
			expect(getJob(db, "memory", memory.id)!.content_hash).toBe(embedPayloadContentHash(changed));
		});
	});

	describe("7. array-hash order-sensitivity (TASK-177 review NIT)", () => {
		it("positive: re-enqueue with reordered decisionRefs returns true + new content_hash", () => {
			const original = makeTask({
				metadata: { decision_refs: ["A", "B"] as string[] }
			});
			db.tasks.insertTask(original);
			const firstPayload = taskJobPayload(original);

			// First enqueue inserts the row.
			expect(
				outbox.enqueue({
					kind: "task",
					id: original.id,
					repo: original.repo,
					owner: original.owner,
					payload: firstPayload
				})
			).toBe(true);
			const firstHash = getJob(db, "task", original.id)!.content_hash;
			expect(firstHash).toBe(embedPayloadContentHash(firstPayload));

			// Same entity, reordered decisionRefs → different hash → LWW reset.
			const reordered = { ...original, metadata: { decision_refs: ["B", "A"] as string[] } };
			const secondPayload = taskJobPayload(reordered);
			expect(embedPayloadContentHash(secondPayload)).not.toBe(embedPayloadContentHash(firstPayload));

			expect(
				outbox.enqueue({
					kind: "task",
					id: original.id,
					repo: original.repo,
					owner: original.owner,
					payload: secondPayload
				})
			).toBe(true);
			const secondHash = getJob(db, "task", original.id)!.content_hash;
			expect(secondHash).toBe(embedPayloadContentHash(secondPayload));
			expect(secondHash).not.toBe(firstHash);
		});

		it("negative: identical order preserves dedup (false, row untouched)", () => {
			const task = makeTask({
				metadata: { decision_refs: ["X", "Y", "Z"] as string[] }
			});
			db.tasks.insertTask(task);
			const payload = taskJobPayload(task);

			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(true);
			const firstHash = getJob(db, "task", task.id)!.content_hash;

			// Re-enqueue with IDENTICAL decisionRefs order → deduped.
			expect(outbox.enqueue({ kind: "task", id: task.id, repo: task.repo, owner: task.owner, payload })).toBe(false);
			const row = getJob(db, "task", task.id)!;
			expect(row.content_hash).toBe(firstHash);
			expect(row.status).toBe("pending");
			expect(row.attempts).toBe(0);
		});
	});
});
