# Sprint 01 — Docs Retrofit 2026-09-07

> **G3 gate.** Closes the blueprint Phase 1 `tasks/` gap + `application/`/`design/flows/` bridges. Bridge style — link, don't duplicate.

## Goals

- Satisfy blueprint `tasks/{backlog,roadmap,sprints}` contract (P-01..P-03).
- Land G3 `application/` + `design/flows/` surface consumed by this sprint's `tasks/` bridges.
- Freeze legacy `_tasks/` — canonical cutover to `tasks/` + `_tasks/BRIDGE.md`.

## Deliverables

| #   | Artifact                                                                                      | Commit                 | Links                                                                                                                                                                                                                                  |
| :-- | :-------------------------------------------------------------------------------------------- | :--------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `application/` — 6-module manifest, `api/README`, `testing/README`, `presentation-brief` (G3) | `ce708d1`              | [`../../application/README.md`](../../application/README.md) · [`../../application/modules/manifest.md`](../../application/modules/manifest.md) · [`../../application/presentation-brief.md`](../../application/presentation-brief.md) |
| 2   | `design/README` + `design/flows/README` — blueprint `flows/` bridge                           | `ce708d1`              | [`../../design/README.md`](../../design/README.md) · [`../../design/flows/README.md`](../../design/flows/README.md)                                                                                                                    |
| 3   | Prior audit D2–D6 — wireframes, sections, traceability, links, brief                          | `d6dc4ce`              | `git show d6dc4ce --stat` · [`../../design/ui/wireframes/`](../../design/ui/wireframes/) · [`../../design/ui/wireframes/codebase-index.md`](../../design/ui/wireframes/codebase-index.md)                                              |
| 4   | `tasks/{README,backlog}` + `roadmap` + `sprints/{manifest,sprint-01}` + `_tasks/BRIDGE`       | `5df5f0e` + this patch | [`../README.md`](../README.md) · [`../backlog.md`](../backlog.md) · [`../roadmap.md`](../roadmap.md) · [`manifest.md`](manifest.md)                                                                                                    |

Prior wireframes/mermaid D2–D6 content (flows D2, wireframes D3, sections D4, traceability D5, mermaid D6) is the pre-S01 audit that S01 retrofits — not re-authored here; see `d6dc4ce` diff and `design/` docs above.

## DONE criteria

- [x] `tasks/README` + `backlog` + `roadmap` + `sprints/manifest` + `sprints/sprint-01` exist and link without duplication
- [x] `_tasks/BRIDGE.md` points to canonical `tasks/` — no new tasks authored in `_tasks/`
- [x] `application/` + `design/flows/` referenced — not re-documented
- [x] Docs-only, no implementation code / no tests added

## Appendix

- Backlog execution detail: `../../_tasks/testing-standardization.md` (REFACTOR-TST-000..014 — 13 tasks; TST-003..011 suite, `d5a94d7`, §7.1 of [`../../testing.md`](../../testing.md); legacy fallback removed post-cutover)
- Sprint manifest (next: S02 doc-sync, S03 CI, S04 coverage): [`manifest.md`](manifest.md)
- Backlog gaps P-01..P-05: [`../backlog.md`](../backlog.md)
