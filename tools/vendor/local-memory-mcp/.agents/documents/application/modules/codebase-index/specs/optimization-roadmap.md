# Optimization Roadmap

> **Status (verified 2026-08-04)**: ALL `OPT-*` findings are **FIXED** and verified in code — DRY (01-07), Code Quality (01-04), Performance (01-11), Structure (01-05), Feature/Flow (01-04, FLOW-01..03), Observability (01). Shared modules: `utils/hybrid-search.ts`, `utils/purge-entity-cleanup.ts`, `utils/mcp-error.ts`, `utils/coordination.ts`, `utils/auto-infer.ts`, `utils/mcp-response.ts`, `utils/action-log.ts` (POLICY 2), `utils/scoring.ts`, `utils/chunk.ts`; migrations split into versioned `vNN-*.ts`; dashboard `services/` layer complete (incl. `statsCache.ts`); KG list endpoints paginated + truncated probe; Arena polling visibility-gated. Only residual decisions: OPT-PERF-03 serial worker loop deferred (not a bottleneck — see memory), dashboard single-delete paths still bypass `purgeEntityAndCleanup` (documented in code).
>
> **Scope**: `vheins/local-memory-mcp` — TypeScript MCP memory server (`src/mcp/`, 385 TS files) + Svelte dashboard (`src/dashboard/`, 88 svelte files). 559 files, 6064 symbols (codebase index).
> **Method**: Evidence-based code analysis (codebase index + source reads). All findings are structural — visible in code. Runtime claims flagged `[benchmark]` where unverified.
> **Created**: 2026-08-02 · **Tasks**: 35 implementation tasks registered in MCP under phase `optimize-*` (codes `OPT-*`).

---

## 1. Executive Summary

The codebase is healthy at the architecture level — the ADR Simplification (44→15 tools at the time, now **20 canonical tools (19 + prompt-read)** — `codebase-index` and `codebase-read` joined the unified set later; see `buildExecutors` in `src/mcp/tools/index.ts` — SPEC-001 hybrid scoring, KG atomic writes) landed cleanly. The optimization opportunities cluster into five themes:

| Theme                | Count       | Highest Impact                                                                                       |
| :------------------- | :---------- | :--------------------------------------------------------------------------------------------------- |
| **DRY violations**   | 7 findings  | Hybrid search triplicated 3×, claim lifecycle duplicated, delete skeleton triplicated                |
| **Performance**      | 11 findings | O(N²) KG transactions per doc, unconditional dashboard polling, full-scan KG enrichment on hot reads |
| **Structure**        | 5 findings  | Missing dashboard `services/` layer, inconsistent entity split, oversized files                      |
| **Code quality**     | 4 findings  | Inconsistent error envelope, dead `handoff.manage.ts` (435 lines), type-safety gaps                  |
| **Features / Flows** | 7 findings  | Legacy coordination shim in UI, unpaginated KG lists, no bulk task/standard actions                  |

**Recommended execution order** (dependencies respected — see §6): DRY extraction first (removes duplication the later tasks would otherwise replicate), then code-quality cleanup, then performance, then features, with observability (`OPT-OBS-01`) instrumented early so every later perf fix is measurable.

---

## 2. DRY Findings

| Code         | Severity | Effort | Issue                                                                                                                                 | Evidence                                                                                                                                                                                                                      |
| :----------- | :------- | :----- | :------------------------------------------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPT-DRY-01` | high     | M      | Hybrid-search orchestration copy-pasted across 3 engines (fetchLimit magic, vector fallback, catch+rescore, sort, guarantee-1, slice) | `tools/memory.read.ts:88-358` · `tools/task-read/search.ts:52-281` · `tools/standard-read/search.ts:169-407`                                                                                                                  |
| `OPT-DRY-02` | high     | M      | Claim/release/list lifecycle implemented twice (claim.manage vs legacy handoff.manage); copies already diverged                       | `tools/claim.manage.ts:44-83,109-125,194-214` · `tools/handoff.manage.ts:37-49,261-343,388-434` _(historical — file removed in OPT-CODE-02)_                                                                                  |
| `OPT-DRY-03` | high     | S      | Byte-identical delete skeleton + queue purge + KG cleanup triplicated                                                                 | `tools/memory.delete.ts:85-129` · `standard.delete.ts:81-124` · `task.delete.ts:84-125`                                                                                                                                       |
| `OPT-DRY-04` | medium   | S      | Three divergent domain-score, two recency, two confidence implementations (different denominators/thresholds)                         | `utils/scoring.ts:48,68` vs `task-read/search.ts:26-31` vs `standard-read/search.ts:118-159`                                                                                                                                  |
| `OPT-DRY-05` | medium   | S      | Action-log extraction duplicated across transports + reads non-existent `structuredData` (silent metadata loss)                       | `tools/index.ts:84-100` · `router.ts:195-213` · `utils/mcp-response.ts:40,117-119`                                                                                                                                            |
| `OPT-DRY-06` | medium   | M      | Auto-infer mode dispatch hand-rolled ~7× with diverging semantics                                                                     | `memory.read.ts:71-82` · `task-read/index.ts:55-90` · `standard-read/index.ts` · `handoff.read.ts:244-278` · `codebase.read.ts`                                                                                               |
| `OPT-DRY-07` | low      | S      | Table envelope `{schema, columns, rows, count, total, offset, limit}` built 7+ times                                                  | `memory.read.ts:333-340` · `task-read/search.ts:220-231` · `task-read/list.ts:47-60` · `standard-read/search.ts:377-389` · `handoff.read.ts:177-212` · `handoff.manage.ts:146-181` _(historical)_ · `claim.manage.ts:194-214` |

---

## 3. Code Quality Findings

| Code          | Severity | Effort | Issue                                                                                                                       | Evidence                                                                                                                                                                          |
| :------------ | :------- | :----- | :-------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPT-CODE-01` | high     | M      | Same failure produces 3 error shapes (isError result vs thrown exception vs hand-built isError) depending on transport/tool | `tools/index.ts:260-266` · `router.ts:78-81` · `task-read/index.ts:25-36` · `handoff.manage.ts:120-132` _(historical)_ · `memory.read.ts:72`                                      |
| `OPT-CODE-02` | high     | S      | `handoff.manage.ts` (435 lines) fully unreferenced — dead weight keeping duplicate logic live-looking                       | `tools/handoff.manage.ts:51-434` _(historical — file deleted by this fix)_                                                                                                        |
| `OPT-CODE-03` | medium   | S      | Sentinel `""` ids, `!` assertions, post-parse `as` casts discarding Zod narrowing                                           | `memory.delete.ts:22-24` · `standard.delete.ts:21-23` · `task.delete.ts:16-26` · `handoff.manage.ts:296,417` _(historical)_ · `memory.read.ts:72` · `memory-write/helpers.ts:157` |
| `OPT-CODE-04` | medium   | S      | Delete not-found semantics differ across the 3 delete tools                                                                 | `memory.delete.ts:69-75` · `standard.delete.ts:67-71` · `task.delete.ts:16-26`                                                                                                    |

---

## 4. Performance Findings

| Code          | Severity | Effort | Issue                                                                                                               | Evidence                                                                                                        |
| :------------ | :------- | :----- | :------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------- |
| `OPT-PERF-01` | high     | M      | O(N²) separate `BEGIN IMMEDIATE` transactions per KG document (N obs + N(N−1)/2 relations)                          | `kg-archivist/extract.ts:412-436` · `entities/knowledge-graph/entity.ts:119-157,171-200`                        |
| `OPT-PERF-02` | high     | M      | Agent Arena fires 5 req/repo every 2.5s unconditionally; no SSE fallback; runs when tab hidden                      | `dashboard/ui/src/lib/composables/useAgentArena.ts:82-92,169`                                                   |
| `OPT-PERF-03` | medium   | M      | Worker does 1 DB read per claimed job (32/batch) + serialized KG writes                                             | `embedding-queue/worker.ts:240-252,255-273`                                                                     |
| `OPT-PERF-04` | medium   | M      | KG-context enrichment runs unbounded `INSTR` full-scan on every task-read/memory read                               | `kg-archivist/query.ts:34-51` · `entities/knowledge-graph/queries.ts:150-178` · `memory.read.ts:343-351`        |
| `OPT-PERF-05` | medium   | S      | `action_log` row written on every tool call including reads; unbounded growth                                       | `tools/index.ts:273` · `utils/action-log.ts:42-54`                                                              |
| `OPT-PERF-06` | medium   | M      | Global dashboard stats recomputed (16+ aggregate queries) on every repo select/refresh, invariant between mutations | `entities/system/entity.ts:218-326` · `dashboard/ui/src/lib/composables/useApp.ts:148`                          |
| `OPT-PERF-07` | medium   | M      | Tag/stack filters use `LIKE '%…%'` (unindexable full scan); FTS doesn't cover tags                                  | `entities/memory.vector.ts:70-72` · `entities/memory/entity.ts:402,459` · `entities/standard/entity.ts:133-140` |
| `OPT-PERF-08` | medium   | M      | codebase ARCHITECTURE mode materializes all files+symbols per request (O(symbols))                                  | `tools/codebase.read.ts:228-231` · `entities/codebase-symbol.ts:98-121`                                         |
| `OPT-PERF-09` | low      | S      | Redundant two-layer write exclusion per write call `[benchmark]`                                                    | `storage/write-lock.ts:38-62,83-107` · `storage/base.ts:27`                                                     |
| `OPT-PERF-10` | low      | S      | Second fallback query whenever candidates < 5 (doubles small-corpus search cost)                                    | `entities/memory.vector.ts:130-151`                                                                             |
| `OPT-PERF-11` | low      | S      | `db.prepare()` per call + dynamic IN-lists miss prepare cache on hot loops                                          | `storage/base.ts:30-48` · `entities/memory/entity.ts:170-186`                                                   |

---

## 5. Structure, Feature & Flow Findings

### Structure

| Code         | Severity | Effort | Issue                                                                                                | Evidence                                                                                                                                           |
| :----------- | :------- | :----- | :--------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPT-STR-01` | medium   | M      | Dashboard declares `services/` but it doesn't exist; controllers fat + touch db directly             | `dashboard/controllers/*.ts` (→ `lib/context.ts:7`) · `CodebaseController.ts` (387 ln)                                                             |
| `OPT-STR-02` | low      | S      | `unifiedGraph.routes.ts` breaks kebab-case convention                                                | `dashboard/routes/unifiedGraph.routes.ts`                                                                                                          |
| `OPT-STR-03` | medium   | M      | Entity dir-split applied to only 3 entities; standard/KG/system monolithic (KG = 637 ln)             | `entities/memory/entity.ts:4` + `entities/memory/entity.ts:758` · `entities/standard/entity.ts:436` · `entities/knowledge-graph/entity.ts:637`     |
| `OPT-STR-04` | medium   | L      | 10 files >400 lines; `migrations.ts` = 1274 mixing domains                                           | `storage/migrations/` (split into `index.ts` + versioned `vNN-*.ts`) · `entities/memory/entity.ts` · `tools/memory.read.ts` (561 → now 435) · etc. |
| `OPT-STR-05` | low      | S      | Triple schema entry (`schemas.ts` → `schemas/` → `schemas/index.ts`); dotted handlers remain largest | `tools/schemas.ts:2` · `tools/memory.read.ts` (561 → now 435 after OPT-DRY-06 split) · `tools/codebase.read.ts:451`                                |

### Feature / Flow / Observability

| Code          | Severity | Effort | Issue                                                                                                  | Evidence                                                                                                                                                                |
| :------------ | :------- | :----- | :----------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPT-FEAT-01` | high     | M      | Dashboard keeps 6 legacy coordination handlers for tool names no longer registered; UI depends on them | `dashboard/controllers/SystemController.ts:209-231` · `useAgentArena.ts:89` · `HandoffsPanel.svelte:51`                                                                 |
| `OPT-FEAT-02` | medium   | S      | KG list endpoints unpaginated + unbounded                                                              | `dashboard/controllers/KGController.ts:15,39` · `entities/knowledge-graph/entity.ts:368-388`                                                                            |
| `OPT-FEAT-03` | low      | S      | `truncated` flag always false (computed after LIMIT clip)                                              | `KGController.ts:58` vs `entities/knowledge-graph/entity.ts:436`                                                                                                        |
| `OPT-FEAT-04` | medium   | M      | No bulk actions for Tasks/Standards (memories only) — multi-round-trip UX gap                          | `dashboard/ui/src/lib/api.ts:170-175` · `MemoriesController.ts:147-174`                                                                                                 |
| `OPT-FLOW-01` | medium   | S      | Code-addressed detail reads burn 2 DB queries (id-or-code ambiguity)                                   | `tools/memory.read.ts:433`                                                                                                                                              |
| `OPT-FLOW-02` | medium   | M      | `memory-synthesize` bypasses unified tool plumbing (legacy tool names, re-fetched data)                | `tools/memory.synthesize.ts:84-88,202-248,250-304` _(historical — shipped as the canonical `synthesize` tool in `tools/index.ts` with `sampleMessage`/`elicit` wiring)_ |
| `OPT-FLOW-03` | low      | S      | Every update fully re-embeds + re-extracts KG, no content-diff dedup                                   | `embedding-queue/types.ts` · `tools/memory-write/create.ts` · `kg-archivist/relations.ts`                                                                               |
| `OPT-OBS-01`  | medium   | S      | Dispatch core logs no durations; worker stats no latency; no metrics endpoint                          | `tools/index.ts:219-270` · `embedding-queue/worker.ts:82-88,401-413`                                                                                                    |

---

## 6. Dependency Graph & Execution Order

```
OPT-DRY-02 ──► OPT-CODE-02 ──► OPT-FEAT-01   (claim lifecycle: extract → delete → port UI)
OPT-DRY-03 ──► OPT-CODE-04                  (delete skeleton → unified semantics)
OPT-PERF-01 ──► OPT-PERF-03                 (KG batching → worker coalescing)
OPT-FEAT-02 ──► OPT-FEAT-03                 (pagination → truncated flag)
OPT-OBS-01  (instrument early: makes OPT-PERF-* measurable)
```

**Suggested waves** (respects dependencies; parallel-safe within wave):

1. **Wave 1 — Foundations**: `OPT-DRY-01..03`, `OPT-CODE-01..02`, `OPT-OBS-01` (no deps; removes duplication + dead code + adds measurement)
2. **Wave 2 — Consolidation**: `OPT-DRY-04..07`, `OPT-CODE-03`, `OPT-CODE-04` (after `OPT-DRY-03`), `OPT-STR-01..05`, `OPT-FLOW-01`
3. **Wave 3 — Performance**: `OPT-PERF-01`, `OPT-PERF-02`, `OPT-PERF-04`, `OPT-PERF-05`, `OPT-PERF-06`, `OPT-PERF-08`; then `OPT-PERF-03` (after 01), `OPT-PERF-07`, `OPT-PERF-09..11`
4. **Wave 4 — Features/Flows**: `OPT-FEAT-01` (after `OPT-CODE-02`), `OPT-FEAT-02`, `OPT-FEAT-04`, `OPT-FLOW-02`; then `OPT-FEAT-03` (after 02), `OPT-FLOW-03`

---

## 7. Quick Wins (low effort, high signal)

| Task                                          | Effort | Why first                                      |
| :-------------------------------------------- | :----- | :--------------------------------------------- |
| `OPT-CODE-02` delete dead `handoff.manage.ts` | S      | −435 lines, removes the duplicate-logic anchor |
| `OPT-DRY-03` purge helper                     | S      | −3 near-identical delete skeletons             |
| `OPT-PERF-05` skip action_log on reads        | S      | removes a write from every read hot path       |
| `OPT-FLOW-01` single detail lookup            | S      | halves code-addressed detail cost              |
| `OPT-FEAT-03` truncated flag fix              | S      | one-line dead-signal repair                    |
| `OPT-STR-02` route rename                     | S      | convention restore                             |

---

## 8. Per-Task Acceptance Criteria

Each `OPT-*` task in MCP carries: issue → evidence → proposed fix → acceptance criteria. Verify every task with the pipeline: **impl → code-review → test → commit** (`tester` scope = affected module; never full suite). Performance tasks must be measured before/after once `OPT-OBS-01` ships (`/api/system/metrics`); `OPT-PERF-09` is explicitly gated on a benchmark before implementation.
