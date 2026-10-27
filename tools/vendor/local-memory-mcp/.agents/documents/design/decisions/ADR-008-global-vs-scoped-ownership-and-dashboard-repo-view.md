# ADR-008 — Global vs Scoped Ownership and Dashboard Repo-Only View

**Date:** 2026-09-06
**Status:** Accepted
**Deciders:** Muhammad Rheza Alfin
**Tags:** `owner-repo`, `is-global`, `dashboard`, `scoping`

> **IMPLEMENTED (docs-only):** the dashboard cross-owner repo view is documented as intentional (repo-only reads merge across owners sharing the short repo name); which tables allow global vs must-be-scoped is decided and the unified representation (`repo NOT NULL` + `is_global`) is recommended. No behavior change — `memories.repo` is already `NOT NULL` + `is_global`; `coding_standards.repo` unification is deferred. Codebase owner isolation is explicitly out-of-scope. See `src/mcp/prompts/server/instructions.md` § Data Scoping and `AGENTS.md` § Persistence.

## Context

Two ownership inconsistencies have been filed as bugs but are intentional trade-offs:

1. **Dashboard repo-only reads merge cross-owner.** `MemoryService.list` and `TaskService.list` call `listMemoriesForDashboard({ repo })` / `getTasksByRepo("", repo, ...)` with an empty owner (see `src/dashboard/services/memory.service.ts:32`, `src/dashboard/services/task.service.ts:89`). A `GET /api/memories?repo=my-app` therefore returns rows where `repo = 'my-app'` regardless of `owner` — i.e., `alice/my-app` and `bob/my-app` are merged into one view. The same applies to tasks, task-stats, and action-log aggregates.

2. **Global vs scoped representation diverged.** `memories` uses `repo TEXT NOT NULL` + `is_global INTEGER NOT NULL DEFAULT 0` (`v01-initial-schema.ts:27`, `memories.is_global`) and scopes reads as `((owner = ? AND repo = ?) OR is_global = 1)` when owner is present (`src/mcp/entities/memory/search.ts:26`, `src/mcp/entities/memory/queries.ts:getByCode`). `coding_standards` uses `repo TEXT` (nullable) + `is_global` and scopes as `((owner = ? AND repo = ?) OR is_global = 1)` / `(repo = ? OR is_global = 1)` (`src/mcp/entities/standard/filters.ts:60`). The nullable `repo` predates the `is_global` flag and allows `repo IS NULL` globals that cannot be distinguished from "missing repo" without the flag.

3. **Codebase index is repo-keyed, not owner-keyed.** `codebase_files` / `codebase_symbols` / `codebase_references` are keyed on `repo` only (no `owner` column). `CodebaseFileEntity.getFilesByRepo(repo)` / `CodebaseSymbolEntity.getSymbolsByRepo(repo)` already aggregate across owners by design. Adding owner isolation would require a schema + FTS + service rewrite.

## Decision Drivers

- Dashboard is an **operational console** for the single DB on the host (`~/.config/local-memory-mcp/memory.db` or `MEMORY_DB_PATH`). Operators expect "show me `my-app`" to mean "every row with that short name on this machine", not "only rows for one GitHub owner".
- Global rows (`is_global = 1`) are the **project-level broadcast** mechanism surfaced by `memory-read` / `standard-read` as `((owner AND repo) OR is_global)` so an agent scoped to `owner/repo` still sees shared standards and cross-repo memories.
- Strict owner isolation on the dashboard **would break** the existing repo switcher and per-repo stats caches (`src/dashboard/services/statsCache.ts`, `DASHBOARD_STATS_TTL_MS`) which are keyed on `repo` only.
- Representation drift (`repo NULL` vs `repo NOT NULL`) complicates query builder uniformity and invites a class of "NULL vs empty string vs is_global" bugs.

## Considered Options

### A. Keep cross-owner dashboard view, clarify as feature (chosen)

Keep `owner = ""` reads on the dashboard; document as intentional; add owner badges in the UI so users can distinguish sources.

- **Pros:** zero migration, preserves existing UX, honest about what the DB actually stores.
- **Cons:** a user with two owners sharing the same short repo name sees a mixed list (mitigated by badges + owner column).

### B. Isolate dashboard by owner (rejected)

Require `?owner=` on every dashboard request and scope all reads to `(owner, repo)`.

- **Pros:** strict multi-tenant isolation.
- **Cons:** breaks current repo-only UX, requires dashboard session identity, forces migration of every service and cache key; vector candidate pools would split per owner.

### C. Global representation — unify on `repo NOT NULL + is_global` (recommended)

Make every table that supports global carry `repo TEXT NOT NULL` + `is_global INTEGER NOT NULL DEFAULT 0`, with global rows stored as `(repo = <canonical-repo>, is_global = 1)` rather than `(repo IS NULL)`.

- **Pros:** one query pattern, no tri-state (NULL/empty/1), FTS joins stay uniform, indexes on `(owner, repo)` work for globals too.
- **Cons:** requires a migration for `coding_standards.repo` (currently nullable) — deferred; the nullable form remains backward-compatible in the interim.

## Decision Outcome

### 1. Dashboard cross-owner repo view is intentional (feature, not bug)

- Dashboard `GET /api/memories?repo=X`, `GET /api/tasks?repo=X`, and stats/coordination controllers are **repo-scoped** (`owner` is intentionally empty). The resulting merge across owners sharing the same short `repo` name is the intended operational view for a single-host SQLite deployment.
- Consumers that need per-owner isolation must use the **MCP tool surface** (`memory-read`, `task-read`, `standard-read`) with explicit `owner` + `repo`, or per-code queries `getByCode({ code, owner, repo })` which already enforce `((owner AND repo) OR is_global)`.
- **UI note (owner badge):** each dashboard list row that carries `owner` SHOULD render a small owner badge (e.g., `vheins`) next to the repo/title so a mixed-repo view is self-explanatory. Badge is informational only — it does not imply row-level ACL.

### 2. Which tables allow global vs must-be-scoped

| Table(s)                                                                                                 |     Allows `is_global = 1`     | Rationale                                                                                                                             |
| -------------------------------------------------------------------------------------------------------- | :----------------------------: | ------------------------------------------------------------------------------------------------------------------------------------- |
| `memories`                                                                                               |            **Yes**             | Cross-repo knowledge; stored `repo NOT NULL` + `is_global`. Reads include globals when owner is present (`search.ts` / `queries.ts`). |
| `coding_standards`                                                                                       |            **Yes**             | Cross-repo norms; currently `repo TEXT` nullable + `is_global`. Target: `repo NOT NULL` + `is_global` (deferred migration).           |
| `tasks`                                                                                                  |             **No**             | Execution-scoped; must be addressable by `(owner, repo, task_code)` uniqueness (`idx_tasks_code_owner_repo`). No `is_global` column.  |
| `task_comments`                                                                                          |             **No**             | Child of `tasks` (`task_id` FK); inherits task scope. `owner` present for audit display only.                                         |
| `observations` / `entities` / `relations`                                                                |   **No** (KG is repo-scoped)   | `entities` is now `(name, repo)` PK per v33 (`v33-kg-repo-identity.ts`); every helper scopes on `repo`. No global KG.                 |
| `exploration_observations`                                                                               |             **No**             | Per-repo exploration evidence; scoped on `repo`.                                                                                      |
| `reuse_telemetry` / `action_log` / `queue_jobs` / `memory_vectors` / `task_vectors` / `standard_vectors` |             **No**             | Telemetry, audit, and queue state are per-repo (or per-entity); never global.                                                         |
| `codebase_files` / `codebase_symbols` / `codebase_references`                                            | **N/A** (repo-keyed by design) | No `owner` column; isolation out-of-scope (see §3).                                                                                   |

### 3. Unified representation

- **Recommended (new tables and future migrations):** `repo TEXT NOT NULL` + `is_global INTEGER NOT NULL DEFAULT 0` (+ `owner TEXT NOT NULL DEFAULT ''`). Global rows store a concrete `repo` value and `is_global = 1`; the scope predicate is `((owner = ? AND repo = ?) OR is_global = 1)` when owner is given, otherwise `(repo = ? OR is_global = 1)`. This matches `memories` already.
- **Legacy (`coding_standards`):** `repo TEXT` (nullable) + `is_global` remains valid until migrated. Treat `repo IS NULL` as legacy-global equivalent of `is_global = 1`; new writes SHOULD set `repo` explicitly and rely on `is_global`. The existing filters in `src/mcp/entities/standard/filters.ts` already handle both forms.
- **Non-global tables:** `repo TEXT NOT NULL`, no `is_global` column, queries use strict `owner = ? AND repo = ?` (or `repo = ?` when owner intentionally empty for dashboard — see §1).

### 4. Codebase owner isolation is out-of-scope (already decided)

`CODEBASE_REPOS_DIR` is dashboard-only (`src/dashboard/services/codebase.service.ts`); the MCP server indexes `CWD` only. The codebase index lives in the same DB (`codebase_*`) but is partitioned by `repo` string only. Adding `owner` to the codebase schema, re-indexing FTS `codebase_symbols_fts`, and plumbing owner through `codebase-index` / `codebase-read` is **out-of-scope** for this ADR and will not be pursued without a separate proposal. Callers who need per-owner code separation should use distinct `repo` identifiers.

## Consequences

**Positive:**

- Ownership semantics are explicit and auditable — no more "is this a bug?" questions about dashboard merging.
- Query builders converge: one canonical scope predicate for global-capable tables.
- Owner badges make the mixed view legible without splitting the view.

**Negative:**

- Dashboard cannot serve as a strict per-owner isolation boundary; ACL-minded deployments must front the dashboard with `DASHBOARD_TOKEN` and keep per-owner DBs separate if they need isolation.
- `coding_standards.repo` remains nullable until a migration is scheduled — the interim carries both `NULL` and `is_global` handling.

**Neutral:**

- No code change in this ADR — docs-only. Future `coding_standards` migration would be a non-breaking additive tightening (`NULL` → NOT NULL + backfill).

## Related

- `AGENTS.md` § Persistence, search & env
- `src/mcp/prompts/server/instructions.md` § Data Scoping
- `src/mcp/storage/migrations/v01-initial-schema.ts`, `v05-composite-owner-repo-indexes.ts`, `v33-kg-repo-identity.ts`
- `src/mcp/entities/memory/search.ts`, `src/mcp/entities/memory/queries.ts`, `src/mcp/entities/standard/filters.ts`
- `src/dashboard/services/memory.service.ts`, `src/dashboard/services/task.service.ts`

## Implementation Plan

1. Add this ADR and reference it from `instructions.md` § Data Scoping and `AGENTS.md`.
2. Add owner badge guidance to the dashboard UI when rendering mixed-owner repo views (informational, no behavior change required for this ADR).
3. (Deferred) Migrate `coding_standards.repo` to `TEXT NOT NULL` and backfill legacy `NULL` globals to `(repo, is_global)` form under a new migration version.
