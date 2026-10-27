# Roadmap — Phase 1 Timeline

> **Bridge style — link, don't duplicate.** Timeline only; sprint detail lives in [`sprints/manifest.md`](sprints/manifest.md). Canonical sources linked per row.

## Timeline P0–P8A

| Phase     | Scope                                                                                               | Status             | Canonical                                                                                                                                                |
| :-------- | :-------------------------------------------------------------------------------------------------- | :----------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0**    | Bootstrap — repo, SQLite `memory.db`, MCP stdio scaffold                                            | **DONE**           | [`AGENTS.md`](../../../AGENTS.md) · `src/mcp/server.ts`                                                                                                  |
| **P1–P6** | Memory / Tasks / Standards / Handoffs / Codebase Index / Dashboard (20 tools, 32 prompts, Svelte 5) | **Partial**        | [`../brief.md`](../brief.md) · [`../application/modules/manifest.md`](../application/modules/manifest.md) · [`../design/README.md`](../design/README.md) |
| **P7–P8** | Hardening — perf, coverage, CI gate                                                                 | **Missing**        | `../_tasks/testing-standardization.md` (REFACTOR-TST-003..014; legacy fallback removed post-cutover)                                                     |
| **P8A**   | Presentation cut — `application/` + `design/flows/` bridges (11 files)                              | **DONE** `ce708d1` | [`../application/README.md`](../application/README.md) · [`../design/flows/`](../design/flows/README.md)                                                 |

## Sprints

| Sprint  | Scope                                                     | Status                                   | Detail                                                                                        |
| :------ | :-------------------------------------------------------- | :--------------------------------------- | :-------------------------------------------------------------------------------------------- |
| **S01** | Docs Retrofit 2026-09-07 — close `tasks/` gap + G3 gate   | **DONE 2026-09-07**                      | [`sprints/sprint-01.md`](sprints/sprint-01.md)                                                |
| **S02** | Doc-sync & API surface hardening — Part A/B + link repair | **DONE 2026-09-08**                      | [`sprints/sprint-02.md`](sprints/sprint-02.md) · [`sprints/manifest.md`](sprints/manifest.md) |
| **S03** | CI gate — `ci.yml` + coverage blocking (TST-013)          | **CANCELED 2026-09-14**                  | [`sprints/sprint-03.md`](sprints/sprint-03.md) · [`sprints/manifest.md`](sprints/manifest.md) |
| **S04** | Coverage & polish — utils/routes/services/lib/prompts     | **DONE 2026-09-14** (coverage gate moot) | [`sprints/sprint-04.md`](sprints/sprint-04.md) · [`sprints/manifest.md`](sprints/manifest.md) |

## Reading order

1. [`../brief.md`](../brief.md) → [`../application/presentation-brief.md`](../application/presentation-brief.md) (G3 gate)
2. [`backlog.md`](backlog.md) (P-01..P-05 gaps) → this roadmap (timeline)
3. [`sprints/manifest.md`](sprints/manifest.md) → [`sprints/sprint-01.md`](sprints/sprint-01.md) → [`sprints/sprint-02.md`](sprints/sprint-02.md)
4. [`../design/README.md`](../design/README.md) → [`../testing.md`](../testing.md) for execution context
