# Sprints — Manifest

> Bridge inventory — link, don't duplicate. Execution lives in MCP task runtime.

## Status

| Sprint  | Title                                                                             | Date       | Status                        | Detail                                                                                                |
| :------ | :-------------------------------------------------------------------------------- | :--------- | :---------------------------- | :---------------------------------------------------------------------------------------------------- |
| **S01** | Docs Retrofit — `application/` + `design/flows/` + `tasks/` gap + G3 gate         | 2026-09-07 | **DONE**                      | [`sprint-01.md`](sprint-01.md)                                                                        |
| **S02** | Doc-sync & API surface hardening — Part A/B, link repair, catalog enrichment      | 2026-09-08 | **DONE**                      | [`sprint-02.md`](sprint-02.md) · [`../../application/api/README.md`](../../application/api/README.md) |
| **S03** | CI gate — `ci.yml` (PR + main: type-check, lint, test --coverage blocking)        | —          | **CANCELED** (2026-09-14)     | [`sprint-03.md`](sprint-03.md) · `../../_tasks/testing-standardization.md` TST-013                    |
| **S04** | Coverage & polish — `utils`/`routes`/`services`/`lib`/`prompts` + perf follow-ups | 2026-09-14 | **DONE** (coverage gate moot) | [`sprint-04.md`](sprint-04.md) · TASK-059                                                             |

## Cadence & Done definition

- **Cadence:** S01 shipped as retrofit (no fixed cadence); S02..S04 follow backlog priority P-01 (P1) → P-05 (P2) per [`../backlog.md`](../backlog.md).
- **Scope:** `tasks/` tracks the Phase 1 gaps only (max 5 items per [`../backlog.md`](../backlog.md) rules). New work → MCP `task-write`.
- **Done:** Sprint doc exists + linked from [`../README.md`](../README.md) + [`../roadmap.md`](../roadmap.md), no duplication of canonical sources, legacy `_tasks/` untouched for new work.

## Links

- Timeline: [`../roadmap.md`](../roadmap.md)
- Index: [`../README.md`](../README.md)
- Backlog: [`../backlog.md`](../backlog.md)
- Legacy bridge: `../../_tasks/BRIDGE.md` (removed post-cutover)
