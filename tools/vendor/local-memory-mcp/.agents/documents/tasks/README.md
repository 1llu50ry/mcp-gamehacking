# Tasks — Index (Blueprint Phase 1)

> **Bridge note:** This `tasks/` directory is the **canonical** Phase 1 tasks surface per the blueprint (`tasks/{backlog,roadmap,sprints}/`). It does not duplicate execution detail — it indexes and links to the source of truth. Legacy file-based tracking historically lived in `../_tasks/` and was bridged via `../_tasks/BRIDGE.md` (legacy fallback removed after the P-03 cutover; do not author new tasks there). For the live task system use the MCP tools (`task-read` / `task-write` / `claim-manage`); this directory is the **docs index**, not the runtime store.

Canonical docs live elsewhere — this index points to them, per the Documentation Map in [`AGENTS.md`](../../../AGENTS.md) and [`../brief.md`](../brief.md).

## Structure

| Path                                           | Content                                                                             | Status         |
| :--------------------------------------------- | :---------------------------------------------------------------------------------- | :------------- |
| [`backlog.md`](backlog.md)                     | Prioritized backlog P-01..P-05 (open gaps from the Phase 1 audit; P-04 Done-as-S01) | ✓ bridge       |
| [`roadmap.md`](roadmap.md)                     | Timeline P0–P8A + S01..S04 (what shipped, what is partial/missing, what is next)    | ✓ bridge       |
| [`sprints/manifest.md`](sprints/manifest.md)   | Sprint inventory (scope, cadence, Done definition) — authored in parallel           | planned        |
| [`sprints/sprint-01.md`](sprints/sprint-01.md) | Sprint 01 — `application/` + `design/flows/` bridges (G3 gate)                      | planned (Done) |

`sprints/` is created by the parallel sprint task; this README and the two sibling bridges reference `sprints/manifest.md` and `sprints/sprint-01.md` as the planned canonical locations. Do not duplicate sprint detail here — link to them.

## Canonical vs legacy

| Location            | Role                                                         | Lifecycle                                                               | Author new work?                                                    |
| :------------------ | :----------------------------------------------------------- | :---------------------------------------------------------------------- | :------------------------------------------------------------------ |
| `tasks/` (this dir) | Canonical Phase 1 docs index (`backlog`/`roadmap`/`sprints`) | Maintained — single source for planning docs                            | **Yes** — backlog/roadmap/sprints only                              |
| `../_tasks/`        | Legacy file-based fallback (MCP unavailable)                 | Frozen — one file: `testing-standardization.md` (REFACTOR-TST-000..014) | No — use MCP `task-write`; `_tasks/` is compat only via `BRIDGE.md` |
| MCP runtime         | Live task store (SQLite `tasks` table)                       | Authoritative for execution                                             | Yes — via `task-write` (phase+title+description)                    |

Legacy detail historically stayed in `../_tasks/testing-standardization.md` (13-task standardization initiative, source of backlog context; legacy fallback removed after the P-03 cutover). This `tasks/` surface summarizes and links — it does not re-author that file.

## Links

- **Application surface:** [`../application/README.md`](../application/README.md) · [`../application/modules/manifest.md`](../application/modules/manifest.md) (6 modules) · [`../application/presentation-brief.md`](../application/presentation-brief.md) (G3 gate)
- **Design contract:** [`../design/README.md`](../design/README.md) (blueprint `architecture`/`domain`/`database`/`flows`/`decisions` + `codebase-index`/`ui` extensions) · [`../design/flows/README.md`](../design/flows/README.md)
- **Testing standard:** [`../testing.md`](../testing.md) (canonical) · [`../application/testing/README.md`](../application/testing/README.md) (bridge)
- **Analysis & audits:** [`../application/testing/benchmarks/testing-gap-analysis.md`](../application/testing/benchmarks/testing-gap-analysis.md) · [`../application/testing/benchmarks/README.md`](../application/testing/benchmarks/README.md) · [`../design/ui/audits/dashboard-audit-2026-08-11.md`](../design/ui/audits/dashboard-audit-2026-08-11.md)
- **Decisions:** [`../design/decisions`](../design/decisions) (ADR-001..008, SPEC-001) · [`../design/decisions/`](../design/decisions/)
- **Requirements:** [`../requirements/`](../requirements/) (BRD/PRD/FSD/TDD, acceptance criteria, user stories)
- **Operations:** [`../application/modules/codebase-index`](../application/modules/codebase-index)
- **Tool contract (runtime):** `src/mcp/prompts/server/instructions.md` · Tool definitions `src/mcp/types/tool-definitions/`

## Guidance for authors

- **Backlog is indexed, not executed here.** Execution lives in MCP (`task-write` → `claim-manage` → `in_progress` → `completed`). `backlog.md` mirrors the audit gaps; keep it in sync when MCP tasks are registered.
- **Roadmap is a timeline, not a plan.** `roadmap.md` records Phase/Status; sprint detail lives in `sprints/` — do not duplicate it.
- **Bridge style — link, don't duplicate.** Every section that has a canonical doc links to it; no prose is copied. If a fact changes, update the canonical — the bridge follows.
- **No implementation code in this tree.** Docs only (`*.md`/`*.mdx` per agent scope).
