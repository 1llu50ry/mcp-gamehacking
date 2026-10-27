# ADR-011 — Split `memory.db` Per Domain

**Date:** 2026-09-19
**Status:** Accepted
**Deciders:** Muhammad Rheza Alfin
**Tags:** `storage`, `sqlite`, `wal`, `domain-isolation`, `derived-db`

> **DECISION: keep the single-file hot store.** A full or hybrid per-domain split of `memory.db` is **rejected** for now. The measured contention is concentrated on the single writer and is already mitigated by WAL + `busy_timeout` + bounded retry + the one-daemon HTTP transport (ADR-010). The existing partial splits (`codebase.db` as `derived`, `cold-archive.db`) are preserved as-is. This ADR records the evaluation, the domain/table inventory, and the conditions under which a future split would be re-opened (see §7). No source code is changed by this ADR.

## Context

The task (TASK-428) asks whether `memory.db` should be split into one SQLite file per domain — `standards.db`, `tasks.db`, `memories.db`, `handoffs.db`, etc. — so that a lock held by one domain's writer does not stall every other domain.

The current deployment is a single-file SQLite store. `SQLiteStore` opens exactly one `better-sqlite3` connection (`src/mcp/storage/sqlite.ts:103`) and holds it for the process lifetime; every one of the ~20 `BaseEntity` subclasses (`src/mcp/storage/base.ts:94`) shares that one connection. Writes are serialized at the SQLite level (`BEGIN IMMEDIATE` via `BaseEntity.transaction()`, `src/mcp/storage/base.ts:126-140`) and optionally at the file level (`WriteLock`, `src/mcp/storage/write-lock.ts:34`).

Two partial physical splits already exist and are load-bearing:

1. **`codebase.db`** — attached as schema `derived` via `ATTACH DATABASE ? AS derived` (`src/mcp/storage/derived-db.ts:105`). It holds the codebase family (`codebase_files`, `codebase_symbols`, `codebase_references`) plus **all** `*_vectors` tables (`memory_vectors`, `task_vectors`, `standard_vectors`) and the `codebase_symbols_fts` FTS5 index (`src/mcp/storage/derived-db.ts:34-41`, `:56`).
2. **`cold-archive.db`** — a **separate connection** (`src/mcp/storage/cold-archive.ts:114`), not an `ATTACH`, holding `cold_memories` (TASK-036).

The task's motivating claim is lock contention in the multi-client HTTP daemon, where many clients share **one** store, so "a lock contention hits all domains". ADR-010 established that one-daemon/many-client deployment (`ADR-010-streamable-http-transport.md:9-17`). This ADR tests whether per-domain file separation is the correct next step or whether the contention is already handled.

### Why now

The question is timely because the one-daemon HTTP transport (ADR-010) concentrates many clients on one SQLite writer, and ADR-009 (optional multi-database support) explicitly defers the storage-port abstraction but flags that `ATTACH`/`derived` and the non-atomic cross-file migration boundary "must be redesigned" before any adapter claims equivalent atomicity (`ADR-009-optional-multi-database-support.md:15`, `:44`, `:47`). A per-domain file split is a _storage-boundary_ change in the same family, so it deserves an explicit decision rather than an implicit drift.

## Complete Domain / Table Inventory

Every table in the schema, mapped to its logical domain and current physical file. Source: `src/mcp/storage/migrations/` (v01–v38, `SCHEMA_VERSION = 38` at `src/mcp/storage/migrations/index.ts:43`) and `src/mcp/storage/derived-db.ts`.

| Domain             | Table                                                            | Definition (file:line)                                                                             | Physical file today                         |
| :----------------- | :--------------------------------------------------------------- | :------------------------------------------------------------------------------------------------- | :------------------------------------------ |
| Memories           | `memories`                                                       | `migrations/v01-initial-schema.ts:26`                                                              | `memory.db`                                 |
| Memories           | `memories_fts` (FTS5, external-content)                          | `migrations/v10-memories-fts.ts:25`                                                                | `memory.db`                                 |
| Memories           | `memory_summary`                                                 | `migrations/v01-initial-schema.ts:57` (PK rebuilt `v03-fix-memory-summary-pk.ts:20-39`)            | `memory.db`                                 |
| Memories           | `memory_tags` (normalized, FK CASCADE)                           | `migrations/v14-normalized-tag-indexes.ts:46-68`                                                   | `memory.db`                                 |
| Memories           | `memories_archive`                                               | `migrations/v01-initial-schema.ts:161`                                                             | `memory.db`                                 |
| Memories (vector)  | `memory_vectors`                                                 | `migrations/v01-initial-schema.ts:65`                                                              | **`codebase.db` (`derived`)**               |
| Tasks              | `tasks`                                                          | `migrations/v01-initial-schema.ts:72`                                                              | `memory.db`                                 |
| Tasks              | `task_comments` (FK→tasks CASCADE)                               | `migrations/v01-initial-schema.ts:107`                                                             | `memory.db`                                 |
| Tasks              | `claims` (FK→tasks CASCADE)                                      | `migrations/v01-initial-schema.ts:222`                                                             | `memory.db`                                 |
| Tasks (vector)     | `task_vectors`                                                   | `migrations/v07-task-vectors.ts:1`                                                                 | **`codebase.db` (`derived`)**               |
| Standards          | `coding_standards`                                               | `migrations/v01-initial-schema.ts:126`                                                             | `memory.db`                                 |
| Standards          | `coding_standards_fts` (FTS5)                                    | `migrations/v04-coding-standards-fts.ts:17`                                                        | `memory.db`                                 |
| Standards          | `standard_tags` / `standard_stack` (FK CASCADE)                  | `migrations/v14-normalized-tag-indexes.ts:46-68`                                                   | `memory.db`                                 |
| Standards (vector) | `standard_vectors`                                               | `migrations/v01-initial-schema.ts:153`                                                             | **`codebase.db` (`derived`)**               |
| Handoffs           | `handoffs` (FK→tasks SET NULL)                                   | `migrations/v01-initial-schema.ts:199`                                                             | `memory.db`                                 |
| Knowledge graph    | `entities` / `relations` / `observations`                        | `migrations/v01-initial-schema.ts:240`, `:253`, `:270` (rebuilt `v33-kg-repo-identity.ts`)         | `memory.db`                                 |
| Knowledge graph    | `kg_degrees` (WITHOUT ROWID) + triggers                          | `migrations/v22-kg-degree-cache.ts:30`, `:41-56`                                                   | `memory.db`                                 |
| Knowledge graph    | `entity_names_fts` (FTS5)                                        | `migrations/v15-entity-names-fts.ts:60` (rebuilt `v33-kg-repo-identity.ts:113`)                    | `memory.db`                                 |
| Observations       | `exploration_observations` / `exploration_evidence` (FK CASCADE) | `migrations/v30-exploration-observations.ts:9`, `:24` (+ `v31-observation-freshness.ts`)           | `memory.db`                                 |
| Telemetry          | `reuse_telemetry_hourly`                                         | `migrations/v32-reuse-telemetry.ts:9`                                                              | `memory.db`                                 |
| Audit              | `action_log`                                                     | `migrations/v01-initial-schema.ts:183`                                                             | `memory.db`                                 |
| Queue              | `queue_jobs`                                                     | `migrations/v09-embedding-queue-jobs.ts:15` (+ `content_hash` `v16-queue-jobs-content-hash.ts:26`) | `memory.db`                                 |
| Bug reports        | `bug_reports`                                                    | `migrations/v38-bug-reports.ts:9`                                                                  | `memory.db`                                 |
| Codebase (derived) | `codebase_files`                                                 | `migrations/v01-initial-schema.ts:284`                                                             | **`codebase.db` (`derived`)**               |
| Codebase (derived) | `codebase_symbols`                                               | `migrations/v01-initial-schema.ts:300`                                                             | **`codebase.db` (`derived`)**               |
| Codebase (derived) | `codebase_symbols_fts` (FTS5, external-content)                  | `migrations/v01-initial-schema.ts:335` (rebuilt `v18-symbols-fts-signature.ts`)                    | **`codebase.db` (`derived`)**               |
| Codebase (derived) | `codebase_references`                                            | `migrations/v21-codebase-references.ts:36` (+ `v23`, `v26`)                                        | **`codebase.db` (`derived`)**               |
| Codebase (dead)    | `codebase_symbol_vectors`                                        | `migrations/v06-codebase-symbol-vectors.ts:9`, **dropped** `v35-drop-codebase-symbol-vectors.ts`   | removed                                     |
| Cold archive       | `cold_memories`                                                  | `src/mcp/storage/cold-archive.ts:133`                                                              | **`cold-archive.db` (separate connection)** |

**FTS5 count:** 4 virtual tables total — `memories_fts`, `coding_standards_fts`, `entity_names_fts` in `memory.db`; `codebase_symbols_fts` in `codebase.db`.

**Physical files today:** `memory.db` (main), `codebase.db` (attached `derived`), `cold-archive.db` (separate connection).

## Decision Drivers

- **Measured contention.** The concurrent-workload benchmark (TASK-480, commit `fa636be`) reports **0.0% contention, 0 busy errors, 0 timeouts, 0 `lockWait` ms in every scenario** (`readers_only`, `writers_only`, `mixed`, `multi_client`), with genuine `worker_threads` + `SharedArrayBuffer` overlap — e.g. `multi_client` 6 clients / 2R+4W at 2668 ops/s with integrity OK (`.agents/documents/application/testing/benchmarks/concurrent-workload-bench.md:47-50`, `:66-100`).
- **Contention is concentrated on the single writer, not cross-domain.** SQLite WAL serializes _all_ writers regardless of which domain the row belongs to. Splitting files only helps if distinct domains are written concurrently _and_ the same file's writer is the bottleneck. The benchmark does not show that.
- **Existing cross-domain atomicity is load-bearing.** `purgeEntityAndCleanup()` deletes an entity _and_ its `queue_jobs` rows in **one** `BEGIN IMMEDIATE` transaction (`src/mcp/utils/purge-entity-cleanup.ts:120-164`; queue delete at `:160`). A per-domain split would break this into non-atomic cross-file work.
- **`withExclusiveWrite` already isolates compound sequences** process-wide (`src/mcp/storage/sqlite.ts:203-205`, `src/mcp/storage/write-lock.ts:99-123`), covering the maintenance sweep, indexing, and task→memory archival.
- **Cost.** 38 raw-SQL migrations run on the single connection inside per-migration transactions (`src/mcp/storage/migrations/index.ts:150-188`); a split multiplies migration, backup, and verification surface.

## Trade-Off Analysis

### (a) Lock / contention isolation between domains

**What a split buys:** each file gets its own writer lock, so a `tasks` write would not block a `standards` write _in principle_. But under the current model every write already funnels through the _same_ `better-sqlite3` connection and the _same_ `WriteLock` file target (`src/mcp/storage/sqlite.ts:174`, `src/mcp/storage/write-lock.ts:57-65`), so the writer is serialized before SQLite is even reached. Splitting files would require per-domain connections and per-domain locks — a substantial rewrite of `BaseEntity`'s single-connection assumption (`src/mcp/storage/base.ts:94`).

**Evidence:** the benchmark shows no contention to isolate. The single-writer serialization is not the observed bottleneck at the tested concurrency (4–6 clients).

### (b) LOSS of cross-domain transaction atomicity

This is the strongest argument **against** splitting. Concrete cross-domain atomic mutations:

- `purgeEntityAndCleanup()` — entity delete/cancel + coordination cleanup + `DELETE FROM queue_jobs` in one transaction (`src/mcp/utils/purge-entity-cleanup.ts:120-164`).
- Task→memory archival — `archiveTasksToMemory()` reads `tasks` + `task_comments` then writes `memories`, wrapped in one `withExclusiveWrite` (`src/mcp/tools/task.helpers.ts:129-219`; caller `src/mcp/tools/task-write/update-status.ts:114`).
- Maintenance sweep — decay, archive, cold offload, `action_log` prune, observation/relation prune, incremental vacuum, and a `memory_summary` write under **one** `withExclusiveWrite` (`src/mcp/services/maintenance-job.ts:132-194`).

A per-domain split makes these non-atomic across files. SQLite `ATTACH` does **not** restore atomicity: `runDerivedMigration()` is explicitly _not_ wrapped in a transaction because "WAL makes cross-file transactions non-atomic" (`src/mcp/storage/derived-db.ts:330-332`). Losing atomicity here risks orphaned `queue_jobs`, half-archived tasks, and partially-purged entities.

### (c) Cross-DB JOIN vs `ATTACH`

`ATTACH` on the **same connection** already supports cross-schema JOINs and they work today:

- `derived.memory_vectors mv JOIN main.memories m` (`src/mcp/entities/memory.vector.ts:53`)
- `derived.task_vectors tv JOIN main.tasks t` (`src/mcp/entities/task/entity.ts:431`)
- `derived.standard_vectors sv JOIN main.coding_standards cs` (`src/mcp/entities/standard/entity.ts:419`)

So a split does not _force_ abandoning SQL JOINs — but each additional attached file adds a connection-level schema, and **cross-database foreign keys are impossible** (SQLite rejects an FK whose target lives in another database; `src/mcp/storage/derived-db.ts:20-24`). Existing intra-domain FKs (`task_comments`→`tasks`, `claims`→`tasks`, `memory_tags`→`memories`, `standard_tags`→`coding_standards`) would have to stay together, which constrains the split boundaries to the FK-connected components in the inventory above.

### (d) FTS5 per file

FTS5 external-content tables require their shadow tables and `content=` target in the **same** database (`src/mcp/storage/derived-db.ts:16-19`, MEM-132). Therefore:

- `memories_fts` must stay with `memories`.
- `coding_standards_fts` must stay with `coding_standards`.
- `entity_names_fts` must stay with the KG tables.
- `codebase_symbols_fts` already moved with the codebase family into `codebase.db`.

A per-domain split would create 3 additional FTS5 indexes in 3 new files, each needing its own rebuild/verify path. No functional gain — the FTS constraint is _already_ satisfied by the existing `derived` boundary.

### (e) Migration & backup complexity

Today: 38 migrations on one connection, each in a transaction (`src/mcp/storage/migrations/index.ts:150-188`), plus a one-time derived copy with count verification (`src/mcp/storage/derived-db.ts:294-319`). A full split means a schema-version table and migration runner **per file**, plus a copy+verify+cutover for each new file. Backups go from one file (plus WAL) to N files, each needing a consistent checkpoint to be independently restorable — a large operational regression for a self-hosted local-first tool.

### (f) Impact on `withWrite` / `withExclusiveWrite` and the single-connection model

`withWrite()` is now a fast path that runs the body inline with **no** file lock, relying on `BEGIN IMMEDIATE` + `busy_timeout` (`src/mcp/storage/write-lock.ts:79-81`, `src/mcp/storage/sqlite.ts:189-191`). `withExclusiveWrite()` takes the proper-lockfile on the single DB file (`src/mcp/storage/write-lock.ts:99-123`). A split forces:

- a `WriteLock` instance **per file** (lock target = DB file path, `src/mcp/storage/write-lock.ts:57-65`), so compound mutations spanning domains would need multi-lock acquisition with deadlock-avoidance ordering;
- `BaseEntity` to know which connection owns its table — every one of the ~20 subclasses currently assumes the one injected `db` (`src/mcp/storage/base.ts:94`, instances built at `src/mcp/storage/sqlite.ts:156-173`).

This is the same "storage-port" refactor ADR-009 defers (`ADR-009-optional-multi-database-support.md:45`, `:75`). Doing it for a file split pre-empts and complicates the future adapter work.

### (g) WAL / checkpoint per file

Each file gets its own WAL and checkpoint policy. Today there is one startup `wal_checkpoint(PASSIVE)` (`src/mcp/storage/sqlite.ts:140`) and one throttled `refresh()` checkpoint every `WAL_CHECKPOINT_INTERVAL_MS = 10_000` (`src/mcp/storage/sqlite.ts:217-226`, `src/mcp/utils/constants.ts:188`). With N files, checkpointing becomes N-way, and a reader can observe **different** files at different points in time (no single consistent snapshot across the set) — a real semantic regression for `agent-context`, which blends memories + tasks + standards + handoffs.

## Decision

**Keep the single-file hot store. Reject a full split. Reject a hot-domain hybrid split.**

The three options were weighed as follows:

1. **Full split (all domains into separate files)** — _rejected_. No measured contention to isolate; loses cross-domain atomicity for `purgeEntityAndCleanup`, task→memory archival, and the maintenance sweep; multiplies migration/backup/WAL complexity; forces the deferred storage-port refactor prematurely.
2. **Hybrid (only hot domains split out)** — _rejected_. The "hot" domains are exactly the ones with the strongest cross-domain atomic dependencies (`memories`, `tasks`, `coding_standards`), so a hybrid split removes the most contention value while keeping the atomicity cost. The existing `derived` split already moved the _derived/vector_ data — the part with the weakest atomicity coupling and the largest write volume (index rebuilds) — which is the correct boundary.
3. **Keep single file + WAL tuning (chosen)** — _accepted_. WAL + `synchronous=NORMAL` + `busy_timeout=30s` + bounded transient-write retry + the one-daemon HTTP transport (ADR-010) already deliver the isolation goal. The benchmark shows 0.0% contention at the tested concurrency.

**Justification, grounded in data:** contention is concentrated on the single writer (inherent to SQLite WAL) and is already mitigated; it is **not** shown to be cross-domain. The existing partial splits (`codebase.db`, `cold-archive.db`) already capture the genuinely separable data. The cost/benefit of further splitting is negative today.

### Re-open conditions (when to revisit)

A future ADR may re-open a split if **any** of the following becomes true and is evidenced:

- The benchmark is re-run at materially higher concurrency (e.g. ≥ 16 concurrent writers) and shows non-zero `busy`/`timeout`/`lockWait` concentrated in one domain.
- A single domain's write volume (e.g. codebase indexing or embedding queue) grows enough to dominate WAL growth and checkpoint time for the whole store.
- The storage-port abstraction from ADR-009 is implemented, at which point per-domain physical separation becomes a cheap configuration of the port rather than a bespoke rewrite.

## Consequences

**Positive:**

- No change to the storage model: `BaseEntity`'s single-connection assumption, `WriteLock`, and the 38-migration runner all remain valid.
- Cross-domain atomicity is preserved for purge, archival, and the maintenance sweep.
- Backup/restore stays single-file (`memory.db` + WAL), matching the local-first posture.
- The decision is recorded with evidence, so the "should we split?" question is closed rather than drifting.

**Negative:**

- A genuine future cross-domain write bottleneck would require re-opening this decision and implementing the storage-port prerequisite first.
- The single-writer serialization remains inherent to SQLite; the mitigation is _latency absorption_ (`busy_timeout`, retry), not true write parallelism.

**Neutral:**

- No code change in this ADR — design/docs only.
- The existing `derived` (`codebase.db`) and `cold-archive.db` boundaries are unchanged and remain the model for any future separation.

## Cross-Domain Reads Without Cross-File JOINs

If a split were ever implemented, cross-domain reads must **not** rely on cross-file JOINs (they are non-atomic and add connection coupling). The repository already demonstrates the correct pattern:

- `agent-context` performs **separate per-domain reads** — `db.memories.*`, `db.tasks.getTasksByMultipleStatuses` (`src/mcp/tools/agent-context.ts:177`), `db.handoffs.listHandoffs` (`:188`), `db.standards.search` (`:191`), `db.explorationObservations.list` (`:194`), `db.codebaseSymbols.*` (`:204`, `:221`), `db.codebaseReferences.getReferencesByFile` (`:216`) — then merges and ranks **in memory** in `rankAndPackContext()` (`src/mcp/tools/agent-context-compiler.ts:120-186`).
- `SystemEntity` aggregates cross-domain stats via separate queries rather than one cross-domain JOIN (`src/mcp/entities/system/entity.ts:49-51`, `:76-130`, `:225-344`).

Any future split MUST follow this "read-per-domain, merge-in-process" contract. `ATTACH` on a single connection may be used for _same-process_ convenience reads, but MUST NOT be relied upon for atomicity.

## Staged Migration Plan (conditional — only if re-opened)

Recorded here for completeness; **not** authorized by this ADR.

1. **Prerequisite:** implement the ADR-009 storage-port abstraction (driver-neutral contract, transaction/error semantics, migration ownership).
2. **Copy:** for each candidate domain file, create the file, `ATTACH` it, and copy tables with `INSERT OR REPLACE` keyed on PK, verifying row counts — mirroring `copyTable()` (`src/mcp/storage/derived-db.ts:294-319`).
3. **Verify:** compare per-table counts and run integrity checks; do **not** wrap cross-file work in a transaction (WAL makes it non-atomic — `src/mcp/storage/derived-db.ts:330-332`).
4. **Cutover:** retire the `main`-side tables only after verification, exactly as `runDerivedMigration()` does (`src/mcp/storage/derived-db.ts:334-370`).
5. **Rollback:** the copy is additive (`INSERT OR REPLACE`) and the `main` tables are dropped only after verification, so a crash mid-migration leaves the `main` tables intact and the migration is retried on the next startup (`src/mcp/storage/derived-db.ts:325-332`). Rollback = delete the new file and keep serving `main`.

## Consistency with ADR-008 and ADR-009

- **ADR-008 (ownership):** unaffected. A file split does not change `owner`/`repo`/`is_global` scoping; every table keeps its current scope predicate. The inventory above matches ADR-008's table classification (`ADR-008-global-vs-scoped-ownership-and-dashboard-repo-view.md:60-69`).
- **ADR-009 (adapter):** consistent and complementary. ADR-009 defers multi-database support behind a storage port; this ADR declines to pre-empt that port with a bespoke file split. Both treat the `derived` `ATTACH` boundary and the non-atomic cross-file migration as the constraints to respect, not to expand (`ADR-009-optional-multi-database-support.md:15`, `:44`, `:47`, `:78`).

## Acceptance Criteria for TASK-429

If the implementation task is _not_ a split (the recommended path), TASK-429 should be scoped as **verification and hardening only**:

1. **Documented decision:** this ADR exists and is linked from `README.md` in `design/decisions/`; `ADR-009` references it as the file-split evaluation.
2. **Contention regression guard:** a repeatable benchmark (extending `scripts/bench/concurrent-eval/`) asserts `busy`/`timeout`/`lockWait` remain 0 at the currently supported concurrency, so a future regression that _would_ justify a split is detectable.
3. **No atomicity regressions:** tests cover `purgeEntityAndCleanup` (entity + `queue_jobs` in one transaction, `src/mcp/utils/purge-entity-cleanup.ts:120-164`), task→memory archival (`src/mcp/tools/task-write/update-status.ts:114`), and the maintenance sweep (`src/mcp/services/maintenance-job.ts:132-194`) — all must remain single-transaction/`withExclusiveWrite`.
4. **No code change** to the storage layer beyond tests/docs: `BaseEntity` stays single-connection, `WriteLock` stays single-target, migrations stay on one connection.

If, and only if, the re-open conditions in §Decision are met, TASK-429 becomes the storage-port prerequisite from ADR-009 — not a direct file split.

## References

- `src/mcp/storage/sqlite.ts` — single connection, WAL/busy_timeout/wal_autocheckpoint, `withWrite`/`withExclusiveWrite`, entity construction, checkpoints
- `src/mcp/storage/base.ts` — `BaseEntity` single-connection model, `transaction()`/`BEGIN IMMEDIATE`, transient-error retry, ~20 subclasses
- `src/mcp/storage/write-lock.ts` — `withLock` fast path, `withExclusiveLock` proper-lockfile, per-file lock target
- `src/mcp/storage/derived-db.ts` — `ATTACH DATABASE … AS derived`, `DERIVED_TABLES`, FTS5 same-DB constraint, non-atomic cross-file migration
- `src/mcp/storage/cold-archive.ts` — separate cold-archive connection
- `src/mcp/storage/migrations/` — 38 numbered migrations, `SCHEMA_VERSION = 38`
- `src/mcp/utils/purge-entity-cleanup.ts` — cross-domain atomic purge (entity + `queue_jobs`)
- `src/mcp/services/maintenance-job.ts` — single-`withExclusiveWrite` maintenance sweep
- `src/mcp/tools/task.helpers.ts`, `src/mcp/tools/task-write/update-status.ts` — task→memory archival across domains
- `src/mcp/tools/agent-context.ts`, `src/mcp/tools/agent-context-compiler.ts` — cross-domain reads without cross-file JOINs
- `.agents/documents/application/testing/benchmarks/concurrent-workload-bench.md` — TASK-480 contention evidence (0.0%)
- `scripts/bench/concurrent-eval/contention-guard.mjs` — TASK-429 contention regression guard (asserts `busy`/`timeout`/`lockWait` stay 0; fails the benchmark run on regression)
- `src/mcp/tests/sqlite.wal-contention.perf.test.ts` — TASK-424 WAL write-contention load test (N concurrent `SQLiteStore` connections on one file; asserts busy/locked == 0)
- `.agents/documents/design/decisions/ADR-008-global-vs-scoped-ownership-and-dashboard-repo-view.md` — ownership/scoping
- `.agents/documents/design/decisions/ADR-009-optional-multi-database-support.md` — storage-port deferral
- `.agents/documents/design/decisions/ADR-010-streamable-http-transport.md` — one-daemon/many-client contention mitigation
- `.agents/documents/design/decisions/adr-002-codebase-index.md` — historical "unified storage" rationale (later reversed by the `derived` split)
