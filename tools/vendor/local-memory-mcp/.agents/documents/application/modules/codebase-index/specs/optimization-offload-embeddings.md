# Design: Offload ONNX Embedding + KG Extraction from the Write Critical Path

> **Status: ✅ IMPLEMENTED (verified 2026-08-08).** The outbox queue shipped as migration **`v09-embedding-queue-jobs`** (the design proposed v8) with the `embedding-queue` module (`outbox.ts` / `enqueue.ts` / `worker.ts`) and workers in **both** the MCP server (`src/mcp/server.ts`) and the dashboard (`src/dashboard/server.ts`). Observation idempotency (P2: unique `(entity_name, observation)` index) shipped inside v9. A queue-status admin endpoint exists at `/api/queue/status` (`src/dashboard/routes/queue.routes.ts:7`); the failed-job admin surface (list/retry/clear) shipped later in TASK-296 (see §7 P3). The original "not yet implemented" header is kept as the historical record; inline notes mark deviations.

> **Verified (2026-08-10).** Queue-admin is fully shipped (TASK-296 backend + TASK-297 UI): `GET /api/queue/jobs` (paginated, optional `?status=` literal filter defaulting to `pending,poison`, newest-first), `POST /api/queue/jobs/:id/retry`, `POST /api/queue/jobs/:id/clear` (also `DELETE /api/queue/jobs/:id`), and `POST /api/queue/retry-all` — all mounted under `/api/queue` (`src/dashboard/routes/queue.routes.ts:11-15`) with optional `?repo=` scoping (TASK-360) and every mutation inside `db.withWrite`. The dashboard gained the **Queue** tab (App.svelte — after Handoffs, before Knowledge Graph; 11 tabs total) with status cards (pending/claimed/done/failed from `GET /api/queue/status`) and a "Failed jobs" table wired to per-row Re-run/Clear plus Re-run all. The `/health`-adjacent metrics concern is resolved: `GET /api/health` (`system.routes.ts:7` — connected/uptime/version/memoryCount/repoCount/pendingRequests/dbPath) and `GET /api/metrics` (`system.routes.ts:10` — `worker` field = embedding-worker snapshot incl. queue depth + processed/failed/poisoned counters) both exist and are integration-tested.

- **Task**: TASK-002 (optimization) · **Decision memory**: MEM-368 · **Implementation**: TASK-013
- **Repo**: local-memory-mcp · **Scope**: design + shipped implementation note

## 1. Overview

**Problem (verified against source):**

| Site                                                           | Inline work under `store.withWrite` (proper-lockfile)                                                                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/index.ts:291`                                           | Every tool in `WRITE_TOOLS` runs its executor inside `store.withWrite` → the cross-process file lock is held for the _entire_ tool execution, including `await` points. |
| `memory-write/create.ts:69,76`                                 | `vectors.upsert` (ONNX inference, 150–500ms) + `saveExtractions` (compromise NLP + KG writes)                                                                           |
| `memory-write/update.ts:93`                                    | `vectors.upsert` when content changes                                                                                                                                   |
| `memory-write/bulk.ts:132,231,237`                             | N serial `vectors.upsert` + N `saveExtractions`                                                                                                                         |
| `standard-write/create.ts:104,111,120`                         | `vectors.upsert` + `saveExtractions` + `saveStandardRelations`                                                                                                          |
| `standard-write/update.ts:122`, `bulk.ts:95`                   | `vectors.upsert`                                                                                                                                                        |
| `task-write/effects.ts:33`                                     | `tryVectorEmbedding`                                                                                                                                                    |
| `dashboard/controllers/StandardsController.ts:216,226,293,334` | Same pattern in the **dashboard process** (separate process, same `memory.db`)                                                                                          |

**Goal**: move ONNX inference and NLP KG extraction off the request path and out of the file lock, keeping write semantics atomic and conflict checks correct. Embedding/KG are already non-critical (surrounding try/catch, warn-only) — this formalizes that.

**Two verified facts that shape the design:**

1. **`checkConflicts` is ONNX-independent.** `memory-write/helpers.ts:197 → entities/memory.vector.ts:93-106` calls `searchBySimilarity` which uses `computeVector` — pure-JS token-frequency vectors over the `memories` table. The `_vectors`/`_type` params are unused. It **stays synchronous** (see §4).
2. **Reads already tolerate missing vectors.** `memory.read.ts:115` builds candidates via `searchBySimilarity` (pure JS over `memories`), and the ONNX `vectors.search` (line 169) only supplies the `keywordScore` component of the hybrid ranking. **Note (superseded):** at design time memories had **no FTS fallback** — `memories_fts` had been dropped in an earlier migration (`migrations.ts:760-776`). Since then, **migration v10 re-added `memories_fts`** and the 0.30 keyword weight is now fed by a min-max-normalized `bm25()` (`src/mcp/entities/memory/search.ts`, `src/mcp/tools/memory.read.ts`), so the searchability window is even smaller than this design assumed. Standards still have FTS5 (`coding_standards_fts`).

## 2. Architecture Decision

**Recommendation: SQLite-backed outbox job table (`queue_jobs`, migration v9 — shipped) + in-process lease-based worker hosted by both processes.**

| Option                                      | Verdict | Why                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-process async queue                      | ❌      | Jobs lost on process crash; MCP-server-only — dashboard writes (StandardsController) still block; no shared state between processes.                                                                                                                     |
| SQLite-backed job table + in-process worker | ✅      | Crash-safe (jobs persist; lease expiry + reconcile recover); captures enqueues from **both** the MCP server and dashboard; enqueue is a ~µs `INSERT` inside the existing write transaction; worker reuses the ONNX model already loaded in each process. |
| Dedicated worker process                    | ❌      | Extra deployment surface and second model footprint for a local single-user tool; the dashboard/MCP processes are already long-lived hosts.                                                                                                              |

**Concurrency model**: _both_ processes may host a worker (survivability: if the MCP client disconnects, the dashboard keeps draining). Mutual exclusion is by **lease claim** (atomic `UPDATE … WHERE status='pending'`), not by the file lock — inference never happens under `withWrite`. Duplicate processing is additionally made harmless by idempotent writes (vector upserts; `entities`/`relations` `INSERT OR IGNORE`; `observations` made idempotent in Phase 2).

**What stays exactly as-is:**

- `checkConflicts` (both memory & standards) — synchronous, pre-insert, inside the lock (correctness feature, ONNX-independent).
- Read-path `vectors.search` (query embedding) — synchronous (`memory.read.ts:169`, `standard-read/search.ts:224`, `task-read/search.ts:100`, `agent-context.ts:26`, `codebase vector-ranking.ts:33`, `synthesize`).
- Conflict-check **thresholds and semantics** (memory 0.85 TF, standard 0.82).

## 3. Queue Design

### 3.1 Schema (shipped as migration v9)

> The shipped table is `queue_jobs` at migration **v9** (`v09-embedding-queue-jobs.ts`), not the v8 proposed below — v8 was used for the `observations` index. The final DDL uses an `id TEXT PRIMARY KEY` (not INTEGER AUTOINCREMENT), adds `entity_repo`/`locked_by`/`backoff_until` columns, stores snapshot payloads, and includes the observation dedup unique index (`idx_observations_dedup` on `(entity_name, observation)`) that P2 called for.

```sql
CREATE TABLE IF NOT EXISTS queue_jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_kind     TEXT NOT NULL CHECK (entity_kind IN ('memory','standard','task')),
  entity_id       TEXT NOT NULL,
  job_kind        TEXT NOT NULL CHECK (job_kind IN ('embed','embed_kg')),
  payload         TEXT NOT NULL,      -- JSON: { content, title?, owner, repo }
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','done','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  enqueued_at     TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_at      TEXT,
  lease_until     TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at    TEXT,
  last_error      TEXT
);
CREATE INDEX idx_queue_jobs_due ON queue_jobs(status, next_attempt_at);
CREATE UNIQUE INDEX idx_queue_jobs_pending_entity
  ON queue_jobs(entity_kind, entity_id) WHERE status = 'pending';
```

- `job_kind`: `embed` (tasks) vs `embed_kg` (memories, standards — KG extraction + standard relations).
- `entity_kind`/`entity_id` mirror the vector-table keys (`memory_vectors.memory_id`, `standard_vectors.standard_id`, `task_vectors.task_id`) and are used for coalescing. No FK — the worker re-reads the live row by id, so a job whose entity was deleted is a no-op.
- Migration system (`MigrationManager`, per-version `_schema_version` table, transactional application) — v9 is purely **additive**, so it is trivially revertible (§8). The proposal's version numbers below read "v8" only in the original; the shipped migration is v9.

### 3.2 State machine

```
pending ──claim──▶ processing ──success──▶ done
   ▲                    │
   │ lease expiry       │ failure (attempts < max)
   └────────────────────┴──▶ pending (next_attempt_at = now + backoff)
   │                    └ failure (attempts >= max) ──▶ failed (poison)
```

> **Verified (2026-08-10):** the shipped state names are the literal `QueueJobStatus` enum — `pending | claimed | done | poison` (`src/mcp/embedding-queue/types.ts:46`). There is **no `failed` row state**: `failed` exists only as a runtime counter (`src/mcp/embedding-queue/worker.ts:92-95`), and `poison` (attempts >= `EMBEDDING_QUEUE_POISON_THRESHOLD` = 5, `src/mcp/utils/constants.ts:151`) is the terminal failed state. API responses use the literal enum values; the UI renders `poison` as the label "Failed" / "Failed (poison)" — the enum is never renamed.

- **Claim batch** (atomic, no file lock — single SQLite statement):
  ```sql
  UPDATE queue_jobs SET status='processing', claimed_at=datetime('now'),
         lease_until=datetime('now','+60 seconds'), attempts = attempts + 1
  WHERE id IN (SELECT id FROM queue_jobs
               WHERE status='pending' AND next_attempt_at <= datetime('now')
               ORDER BY id LIMIT 32);
  ```
  Followed by `SELECT … WHERE status='processing' AND claimed_at = <this claim timestamp>`.
- **Lease reaper**: on each worker tick, `UPDATE queue_jobs SET status='pending', lease_until=NULL WHERE status='processing' AND lease_until < datetime('now')` — recovers jobs orphaned by a crashed process. Lease = 60s >> one batch.

### 3.3 Worker loop (in-process, cooperative, in both processes)

```
tick:
  reap expired leases
  claim batch (K=32)
  if empty → sleep 50ms → repeat
  [NO file lock here] ONNX batch inference over claimed payloads (grouped by model)
  [file lock, ~ms] db.withWrite(transaction {
      per job: upsertVectorEmbedding (idempotent)        // vector tables
      per job: mark done OR (fail → pending+backoff / failed)
  })
  if job_kind == embed_kg:
     [no lock] compromise extractEntities
     [file lock, ~ms] transaction { INSERT OR IGNORE entities/relations; INSERT observations; mark done }
  repeat immediately if more pending
```

- **Inference never holds the lock.** Only the ~ms DB-write phase (K vector upserts in one transaction) enters `withWrite`, respecting the "writes only under lock" contract.
- **Batch inference** (Phase 3, but designed-in from the start): `@xenova/transformers` `pipeline("feature-extraction", …)` accepts `string[]` → `extractor(texts, { pooling:"mean", normalize:true })` returns `[N, 384]` — one ONNX call per batch of K instead of N serial calls. Grouped by model (single model `all-MiniLM-L6-v2` today → one group; the grouping hook exists for future multi-model).
- **Enqueue API** (called _inside_ the tool's write transaction — see §4):
  ```ts
  enqueueJob(db, { entityKind, entityId, jobKind, payload }); // INSERT … ON CONFLICT (entity_kind, entity_id) WHERE status='pending'
  ```
  `ON CONFLICT … DO UPDATE SET payload=excluded.payload, attempts=0, enqueued_at=…` — the **coalescing/debounce** rule: at most one pending job per entity, always the latest payload.
- **Delete interplay**: entity deletes cascade the vector tables (`memory_vectors`, `standard_vectors`, `task_vectors` all have `ON DELETE CASCADE`). Worker additionally purges `DELETE FROM queue_jobs WHERE entity_id=? AND status='pending'` on delete — trivial, avoids wasted inference. No tombstones needed.

### 3.4 Crash recovery (process dies mid-queue)

1. Jobs in `pending` survive (SQLite, WAL, `synchronous=FULL`).
2. Jobs in `processing` are reclaimed after 60s lease expiry by any live worker.
3. Jobs that were _enqueued but never committed_ cannot exist — enqueue is atomic with the row commit (§4).
4. **Reconcile/backfill** (startup + manual tool): re-enqueue everything missing a vector:
   ```sql
   SELECT m.id, m.content, m.title, m.repo, m.owner FROM memories m
   LEFT JOIN memory_vectors mv ON mv.memory_id = m.id
   WHERE mv.memory_id IS NULL AND m.status='active';   -- same for standards, tasks
   ```
   This is the ultimate guarantee that the searchability window (§5) closes even after an ungraceful kill or a bug that drops jobs.

## 4. Consistency & Failure Handling

### 4.1 Row commit BEFORE enqueue — atomic, no partial state

Every mutation becomes **one** better-sqlite3 transaction: `db.transaction(() => { entity-row insert/update; enqueueJob(...); })` — executed inside the existing `withWrite`. Either both land or neither. Enqueue is ~µs (`INSERT`), so the lock is held only for the commit, never for inference. **Never** enqueue-then-commit (would orphan jobs on crash); never commit-then-enqueue in a separate write (would create a window where a committed row has no job — the reconcile job covers that as a safety net anyway).

Call-site replacements:

- `memory-write/create.ts` — wrap `db.memories.insert(entry)` + enqueue `embed_kg`.
- `memory-write/update.ts` / `bulk.ts` — enqueue `embed_kg` only when `content` changed (preserve current behavior: `update.ts:92` upserts only on content change). Bulk: one enqueue per created/updated entry; per-entity coalescing keeps the queue flat even for 1000-item bulks.
- `standard-write/create|update|bulk` — enqueue `embed_kg` (worker runs `saveExtractions` + `saveStandardRelations`).
- `task-write/effects.ts` — enqueue `embed`.
- `dashboard/StandardsController.ts:216,226,293,334` — replace inline `vectors.upsert` with enqueue (same helper module; both processes import it).

### 4.2 Permanent failure → poison message

- Retry policy: exponential backoff `next_attempt_at = now + min(2^attempts s, 300 s)`, `max_attempts = 5`, then `status='failed'` with `last_error` retained.
- Poison handling: a failed embedding is **benign by design** — the row is committed and remains findable via TF-similarity/FTS; embedding is a ranking enhancement. Failed jobs are surfaced via the queue-status admin view (§7 P3) and are re-runnable (manual `UPDATE status='pending'`) or simply re-covered by the reconcile job. They never block other jobs (claim is per-batch, failures are per-job). **Note (superseded 2026-08-10):** the manual `UPDATE` recovery is now exposed as the admin API — `POST /api/queue/jobs/:id/retry` resets `poison`/`done` → `pending` (attempts=0, `last_error`/backoff cleared), `POST /api/queue/retry-all` bulk-flips every poison row — surfaced in the Queue tab as Re-run / Re-run all (TASK-296/297).
- KG failure behaves exactly like today (warn + continue) — `saveExtractions`/`saveStandardRelations` already swallow errors.

### 4.3 At-least-once is safe (idempotency audit)

| Target                                                 | Mechanism                                                | Idempotent?                                                                                                                                  |
| ------------------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory_vectors` / `standard_vectors` / `task_vectors` | `INSERT … ON CONFLICT DO UPDATE` (single row per entity) | ✅                                                                                                                                           |
| `entities` (name PK)                                   | `INSERT OR IGNORE`                                       | ✅                                                                                                                                           |
| `relations` (PK from/to/type)                          | `INSERT OR IGNORE`                                       | ✅                                                                                                                                           |
| `observations` (random-UUID PK)                        | plain `INSERT`                                           | ❌ **until P2**: add unique index `(entity_name, observation, repo, owner)` + deterministic id (hash of those 4 fields) → `INSERT OR IGNORE` |

Lease mutual exclusion makes duplicates unlikely even before P2; the unique index makes them impossible after.

### 4.4 `checkConflicts` — decision & interaction with async embedding

- **Stays synchronous, inside the lock, pre-insert.** It is a _correctness_ feature: the response (`MEMORY_CONFLICT` rejection with the conflicting memory) is computed before the row exists, and it's pure-JS (no ONNX) so it's cheap (~ms over the tokenized TF path).
- **Interaction with the async embedding of the NEW row: none.** `checkConflicts` reads only the `memories` table and never touches `memory_vectors` — the worker's later write of the new row's vector cannot cause a false self-conflict. Writes are already serialized by the file lock, so no new cross-process race is introduced. (The `vectors` param threaded through `checkConflicts`/`checkCreateConflict` is vestigial — safe to leave or remove.)

## 5. Read-Path Behavior

- **Synchronous query embedding stays.** `vectors.search` (ONNX embedding of the _query_) is required on every semantic search; it is not part of this change. This is the one ONNX call that must remain on the request path (it's already cached-model — fast — and it's a read, never under the lock).
- **Searchability window**: after a write commits but before the worker lands the embedding (typically <1s; seconds for a 1000-item bulk), the row is **absent from `memory_vectors`**, so `vectors.search` yields no score for it (`keywordScore = 0`).
  - **It is still findable**: memory-read's candidate stage (`memory.read.ts:115` `searchBySimilarity`, pure-JS TF over `memories`, ordered `importance DESC, created_at DESC` LIMIT 100) includes the new row — it ranks with its TF `similarityScore` component (weight 0.4) instead of the ONNX keyword score. Standards additionally have FTS5. Detail lookups by id/code are unaffected (direct SQL).
  - **Documented behavior change**: hybrid ranking for a just-written row is temporarily degraded (no keyword contribution) until the vector lands. Acceptable: it converges within the window, and the current inline path already _loses_ the embedding entirely when the model fails — this design is strictly better (eventual convergence + reconcile).
  - **Correction to prior assumptions (superseded by migration v10):** at design time, the memories fallback was TF-similarity, **not FTS** — `memories_fts` was dropped (`migrations.ts:760-776`). That changed after this design shipped: **migration v10 re-added `memories_fts`** and the 0.30 keyword weight is fed by FTS `bm25`, so §5's "optional P3 enhancement" (memories FTS re-add) is now **implemented** — it is no longer optional/unshipped.

## 6. Ordering, Dedupe & Backpressure

### 6.1 Ordering: **last-write-wins per entity** (not FIFO)

Vector tables are single-row upserts keyed by entity id — _any_ final ordering converges to the last processed payload. Two order-sensitive scenarios:

- **update(A) then update(B) for the same id**: coalescing keeps at most one `pending` job per entity, always the latest payload. If A was already claimed (`processing`) when B enqueues, B inserts a fresh pending row; the worker processes A then B → final state = B. Correct either way. **LWW is semantically right**: a stale vector is wrong, an older-write-wins order is meaningless across entities.
- **Cross-entity order**: irrelevant (independent rows). FIFO is best-effort via `ORDER BY id` on claim; no guarantee needed.

### 6.2 Dedupe/debounce

- **Enqueue-side coalescing** (partial unique index + `ON CONFLICT DO UPDATE`) — one pending job per `(entity_kind, entity_id)`, latest payload wins.
- **Batch-side batching** — K=32 texts through one ONNX call, grouped by model (single model today). Fixes the "N serial inferences" hotspot in `bulk.ts` and turns 1000-item bulks into ~32 model calls.

### 6.3 Backpressure

- **No hard cap on enqueue** — writes must never fail because a queue is full; the queue is an enhancement. Growth is bounded by request rate (agent-paced, low).
- **Soft high-water mark**: `pending > 1000` → `logger.warn` + raise batch K (32 → 64) and drop the idle sleep; the worker self-throttles throughput to drain.
- **Drain policy**: worker runs claim→process→claim continuously while work exists; sleeps only when empty.
- **Graceful shutdown (SIGTERM/SIGINT)**: extend the existing handler in `server.ts:118-126` — stop claiming, finish the in-flight batch (timeout 2s), then `db.close()`. A hard kill is safe: in-flight jobs have a 60s lease that any live process reclaims; nothing is lost. Optionally `await worker.flush()` (process until empty, capped) when `MEMORY_QUEUE_FLUSH_ON_EXIT=true` for the dashboard process.
- **Table hygiene**: periodic sweep `DELETE FROM queue_jobs WHERE status IN ('done','failed') AND processed_at < datetime('now','-7 days')` (worker tick + startup).

## 7. Phased Implementation Plan

| Phase                                                    | Scope                                                                                                                                                                                                                                                                                                            | Acceptance criteria                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Revert                                                                                                                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1 — Substrate + memory path (minimal, safe)** ✅      | Migration v9 (`queue_jobs` + coalescing index; proposed as v8). `embedding-queue` module (`enqueueJob`, `EmbeddingQueueWorker`, `reconcileMissingVectors`). Wire worker in MCP `server.ts`. Replace memory-write create/update/bulk inline `vectors.upsert` + `saveExtractions` with transactional enqueue.      | Memory-write p50 lock-held time < 20ms (was 150–500ms). New rows have embeddings within 5s. Memory search & conflict behavior identical to today. Reconcile fills a row deleted from `memory_vectors` on next boot. ✅ shipped (v9, TASK-013) — lock-held time target met in practice; batch K is env-tunable (`EMBEDDING_QUEUE_BATCH_SIZE`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Smallest diff: restore the inline `await` calls; leave/keep v9 table (additive). `DROP TABLE queue_jobs` + `DELETE FROM _schema_version WHERE version=9` for full rollback. |
| **P2 — All writers + cross-process** ✅                  | Enqueue in standard-write (create/update/bulk incl. `saveStandardRelations`), task-write (`embed`), dashboard StandardsController. Enable worker in dashboard process (lease mutual exclusion). `observations` unique index + deterministic id (at-least-once safety). Startup reconcile for all 3 entity kinds. | Dashboard standard edits never block on ONNX; concurrent MCP+dashboard writes drain with zero duplicate observations; kill -9 mid-batch → remaining jobs reprocessed. ✅ shipped — dashboard worker in `src/dashboard/server.ts`; `observations` dedup unique index in v9.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Worker in dashboard behind `ENABLE_QUEUE_WORKER=false` env flag; MCP worker keeps draining.                                                                                 |
| **P3 — Batching, backpressure, observability, admin** ✅ | K=32 batched inference grouped by model; high-water mark + adaptive batch; queue metrics (depth, p95 process time, failure rate) via structured logs + `/health`-adjacent stats; failed-job admin (re-run/clear); purge sweep; optional memories FTS re-add for window keyword coverage.                         | 1000-item bulk drains in <30s; queue empty after 60s idle; poison jobs visible & re-runnable; queue table size bounded by sweep. — **Shipped**: K=32 batching + adaptive backoff + purge + poison caps are in `src/mcp/utils/constants.ts` + `embedding-queue/worker.ts`; queue observability exposed at `/api/queue/status` (`queue.routes.ts:7`); **failed-job admin (TASK-296)** — `GET /api/queue/jobs` (list, optional `?status=` literal filter, default `pending,poison`, newest-first), `POST /api/queue/jobs/:id/retry`, `POST`/`DELETE /api/queue/jobs/:id` (clear), `POST /api/queue/retry-all` (`queue.routes.ts:11-15`) — plus the **Queue tab UI** (TASK-297: status summary + Failed-jobs table with per-row Re-run/Clear and Re-run all; 11th tab after Handoffs). The optional **memories FTS re-add shipped separately as migration v10** (§5's "optional P3 enhancement"). The former **NEXT PHASE** remainder (GUI admin for failed-job re-run/clear; `/health`-adjacent queue metrics) is now shipped: `GET /api/health` (`system.routes.ts:7`) and `GET /api/metrics` (`system.routes.ts:10` — `worker` field = embedding-worker snapshot incl. queue depth + processed/failed/poisoned counters) both exist and are integration-tested. | Pure additions — each toggleable independently.                                                                                                                             |

**Revertibility note**: P1 is the only phase that changes the memory write path; its revert is a one-diff restoration of the current inline behavior. P2/P3 are additive. Every phase is independently ship/rollback-able.

## 8. Risks & Mitigations

| #   | Failure mode                                                  | Impact                                                | Mitigation                                                                                                                                                                                         |
| --- | ------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Process crash mid-queue**                                   | Orphaned `processing` jobs; rows missing vectors      | 60s lease expiry + reaper; reconcile/backfill at startup; enqueue atomic with commit → no orphaned-enqueue state; at-least-once safe by idempotency                                                |
| 2   | **DB contention (worker vs writer)**                          | Worker's batched writes compete with tool writes      | Worker writes batched into one ~ms transaction under `withWrite`; `busy_timeout=30000` already set; inference (the slow part) never touches the DB or lock                                         |
| 3   | **Memory growth (worker)**                                    | Tensor/array accumulation over long sessions          | Bounded batch K=32; drop references after each batch; model already resident in both processes (no new footprint if workers run in-process); `--max-old-space-size` unchanged                      |
| 4   | **ONNX model failure / degraded env**                         | Embeddings never land                                 | Existing warn-and-continue semantics preserved; poison at 5 attempts; reconcile re-attempts on next boot; TF-similarity search unaffected                                                          |
| 5   | **Double processing (both workers)**                          | Duplicate observations; wasted inference              | Lease claim is atomic; `observations` unique index (P2) removes last non-idempotent target; vectors/entities/relations already idempotent                                                          |
| 6   | **Queue unbounded growth**                                    | Table bloat                                           | Soft high-water mark + adaptive drain; 7-day purge sweep; enqueue is µs so writes never block regardless                                                                                           |
| 7   | **Regression: tests asserting immediate vector availability** | Post-write assertions on `memory_vectors` become racy | Search-path tests are unaffected (searchBySimilarity reads `memories`); any write-path test asserting vector presence must be updated to poll or invoke the worker — flagged as P1 acceptance item |
| 8   | **Stale vectors after update crash**                          | Content updated, old vector persists                  | Vector upsert runs on latest committed payload (LWW); reconcile covers rows whose `updated_at` > `memory_vectors.updated_at` as a P3 hardening option                                              |

## 9. Related artifacts

- Decision memory: `MEM-368` (async embedding/KG outbox: SQLite queue_jobs + lease worker)
- Implementation task: `TASK-013` (Implement embedding/KG offload queue per TASK-002 design) ✅ **completed**
