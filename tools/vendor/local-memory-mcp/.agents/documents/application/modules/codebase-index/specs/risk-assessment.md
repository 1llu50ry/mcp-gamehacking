# Risk Assessment — Codebase Index

> **Methodology**: Risk = Likelihood × Impact. Each risk rated for probability (1-5) and severity (1-5).
> **Response strategies**: Avoid, Mitigate, Transfer, Accept.

>
> **IMPLEMENTED (verified 2026-08-10, TASK-325):** the 2026-08-08 "confidence labeling NEXT PHASE" claim is superseded for the **dashboard KG graph**: per-edge confidence labels are shipped on the KG `relations` table (migration **v24**, `confidence REAL NOT NULL DEFAULT 1.0`, `src/mcp/storage/migrations/v24-relations-confidence.ts:61-64`; UI rendering in TASK-330). Shipped form differs from R-18's design-intent mitigation: instead of the `confirmed`/`ambiguous`/`best_effort` enum on call edges, it is a numeric `0..1` insert-time constant (0.55 auto-extraction, 0.8 semantic, 0.9 codebase, 1.0 manual — first-write-wins under `INSERT OR IGNORE`). The `codebase_references` table itself still carries **no** confidence column — R-18's call-edge-level labels remain design intent only.

---

## Risk Register

| ID   | Risk Category   | Risk Description                                                                                                  | Likelihood | Impact | RPN | Response     | Mitigation                                                                                                                                                            |
| :--- | :-------------- | :---------------------------------------------------------------------------------------------------------------- | :--------: | :----: | :-: | :----------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | **Technical**   | tree-sitter WASM build fails or is incompatible with the Node.js runtime version used by local-memory-mcp         |     3      |   5    | 15  | **Mitigate** | Pin `web-tree-sitter` version; test against Node 18/20/22 in CI; maintain regex-based fallback parser for critical declaration types (functions, exports)             |
| R-02 | **Technical**   | tree-sitter grammar update breaks AST shape, causing silent symbol extraction failures                            |     2      |   4    |  8  | **Mitigate** | Pin grammar versions in `package.json`; write integration tests with known source files and expected symbol outputs; CI runs on grammar version bumps                 |
| R-03 | **Technical**   | Parsing very large files (>50K lines) causes OOM crash or hangs the MCP server                                    |     3      |   4    | 12  | **Mitigate** | Pre-scan file size before parsing; skip files >50K lines; apply AST depth limit on files >10K lines; run parse in a separate async context with timeout               |
| R-04 | **Technical**   | FTS5 (SQLite full-text search) performance degrades on indexes with >500K symbols                                 |     2      |   3    |  6  | **Mitigate** | Benchmark with 500K synthetic symbols; add dedicated FTS5 indexes; fall back to `LIKE` query if FTS5 is not available                                                 |
| R-05 | **Technical**   | Memory leak from tree-sitter WASM instance across repeated parse calls                                            |     3      |   3    |  9  | **Mitigate** | Reuse a single tree-sitter WASM instance; monitor heap usage in long-running sessions; implement periodic instance refresh                                            |
| R-06 | **Technical**   | SQLite schema migration conflicts with local-memory-mcp's existing tables or migration system                     |     2      |   3    |  6  | **Mitigate** | Prefix all codebase tables with `codebase_`; use `CREATE TABLE IF NOT EXISTS` (idempotent migrations); test against existing `memory.db` schemas                      |
| R-07 | **Technical**   | Concurrent index requests cause data corruption or duplicate symbols                                              |     2      |   4    |  8  | **Mitigate** | Implement in-memory mutex to serialize index operations; use SQLite transactions for atomic batch writes                                                              |
| R-08 | **Technical**   | Symlink cycles cause infinite recursion in file discovery                                                         |     2      |   3    |  6  | **Avoid**    | Track visited inodes during directory walk; hard limit on directory depth (100 levels)                                                                                |
| R-09 | **Operational** | Index becomes stale (file modified after index), causing agents to receive outdated symbol data                   |     4      |   3    | 12  | **Mitigate** | Store per-file `indexed_at` timestamp; incremental re-index on session start; provide `force_reindex` option; surface staleness in tool responses                     |
| R-10 | **Operational** | SQLite database grows excessively large (>1GB) from code graph data, affecting overall MCP performance            |     2      |   3    |  6  | **Mitigate** | Estimate: 100K LOC ≈ 50MB; set a storage budget warning at 500MB; provide `prune_index` tool to remove old/unused indexes                                             |
| R-11 | **Operational** | Disk space exhaustion from large project indexes on resource-constrained environments (CI, small VMs)             |     1      |   4    |  4  | **Accept**   | Document storage requirements (50MB per 100K LOC); allow configurable index location; warn on low disk space                                                          |
| R-12 | **Operational** | Indexing blocks MCP server startup, delaying agent session initialization                                         |     3      |   2    |  6  | **Mitigate** | Run auto-index asynchronously with progress feedback; MCP tools work without waiting for index to complete (return empty results with "indexing in progress" message) |
| R-13 | **Delivery**    | Scope creep — team adds cross-file call resolution, LSP integration, or other Phase 2 features to MVP scope       |     4      |   2    |  8  | **Avoid**    | Enforce strict MVP boundary per `mvp-scope.md`; reject features beyond M1-M5 for MVP; document all deferrals with rationale                                           |
| R-14 | **Delivery**    | Dependency unavailable — `web-tree-sitter` or grammar WASM packages are removed from npm or have breaking changes |     1      |   5    |  5  | **Mitigate** | Vendor grammar WASM files in the repo (or download at install time from a pinned release); maintain set of known-good versions                                        |
| R-15 | **Delivery**    | Underestimated effort for tree-sitter visitor implementation (AST querying for TypeScript is non-trivial)         |     4      |   3    | 12  | **Mitigate** | Allocate 4 days for parser task (T3); prototype with simple declaration extraction first; defer complex AST patterns (decorators, generics) to Phase 2                |
| R-16 | **Technical**   | Binary file detection via null-byte check produces false positives (e.g., UTF-16 text files with null bytes)      |     2      |   2    |  4  | **Accept**   | False positives are low-impact (file skipped, can be re-included via config); log all skipped files for audit                                                         |
| R-17 | **Technical**   | `ignore` package (`.gitignore` parsing) has edge cases with nested `.gitignore` files or complex pattern syntax   |     2      |   2    |  4  | **Accept**   | Use well-tested `ignore` npm package; unit test against known `.gitignore` edge cases (inverted patterns, negation, double-star)                                      |
| R-18 | **Technical**   | Cross-file call resolution produces incorrect edges due to dynamic dispatch or ambiguous names                    |     3      |   3    |  9  | **Mitigate** | Label all call edges with confidence level (`confirmed`, `ambiguous`, `best_effort`); document limitations in tool responses; allow manual edge correction via API    |

---

## Risk Heatmap

```
                    Likelihood
              1 (Rare)  2 (Unlikely)  3 (Possible)  4 (Likely)  5 (Almost Certain)
    5 (Critical)  R-14              |               |             |
    4 (High)      R-11              |  R-02, R-08   |  R-01, R-03 |  R-09
Impact
    3 (Medium)    |              R-04, R-06    |  R-05, R-12   |  R-15      |
                  |                           |  R-18         |            |
    2 (Low)       |              R-16, R-17   |  R-13         |            |
    1 (Negligible)|                           |               |            |
```

## Top 5 Risks Requiring Action

| Rank | ID   | RPN | Risk                           | Action Owner | Due             |
| :--- | :--- | :-: | :----------------------------- | :----------- | :-------------- |
| 1    | R-01 | 15  | tree-sitter WASM compatibility | Engineering  | Before Sprint 1 |
| 2    | R-03 | 12  | OOM on large files             | Engineering  | Sprint 1 — T3   |
| 3    | R-09 | 12  | Index staleness                | Product      | Sprint 2 — T9   |
| 4    | R-15 | 12  | Underestimated parser effort   | Engineering  | Sprint 1 — T3   |
| 5    | R-05 |  9  | Memory leak from WASM instance | Engineering  | Sprint 1 — T3   |

## Risk Response Plan

### Immediate Actions (Before Sprint 1)

1. **R-01**: Create a spike ticket to prove tree-sitter WASM works in the project's Node.js version and existing toolchain. Fallback: if WASM is incompatible, use regex-based extraction for MVP.
2. **R-15**: Prototype tree-sitter visitor on 3 fixture files (functions, classes, interfaces) before committing to full parser implementation.

### During Sprint 1

3. **R-03**: Implement file size pre-check and AST depth limiter in T3. Test against a 100K-line generated file.
4. **R-05**: Profile memory after parsing 1000 files. If leak >10MB, add periodic WASM instance refresh.

### During Sprint 2

5. **R-09**: Implement per-file `indexed_at` tracking in T9. Add staleness warning to tool responses.

## Monitoring Cadence

| Risk | Monitoring Method                             | Frequency      |
| :--- | :-------------------------------------------- | :------------- |
| R-01 | CI test run with tree-sitter parse            | Every commit   |
| R-03 | Heap snapshot after each index run            | After Sprint 1 |
| R-04 | Search latency P99 metric                     | After Sprint 1 |
| R-05 | Heap snapshot comparison across parse batches | Weekly         |
| R-09 | Index age check on session start              | Every session  |
| R-13 | MVP scope checklist in PR reviews             | Every PR       |
