# Sprint 02 — Doc-sync & API Surface Hardening

> Follow-up to [S01](sprint-01.md). Bridge style — link, don't duplicate. **Status: DONE 2026-09-08.**

## Goals

- Close Part A/B coverage: API specs + module features + testing references.
- Link repair — orphan/missing refs, stale test paths, tool-count/DB-path drift.
- Catalog enrichment — fills gaps identified in `tasks/backlog` P-05 + G3 follow-up.
- Enrich `application/modules/manifest.md` to full B-Rules table (all 7 modules).
- Land `design/domain/event-storming.md` (timeline + sequence + BC flowchart).

## Deliverables

| #   | Artifact                                          | Scope                                                                        | Canonical link                                                                   |
| :-- | :------------------------------------------------ | :--------------------------------------------------------------------------- | :------------------------------------------------------------------------------- |
| 1   | `application/api/*` — per-module API specs        | 7 modules (memory/tasks/standards/handoffs/codebase-index/dashboard/context) | [`../../application/api/README.md`](../../application/api/README.md)             |
| 2   | `application/modules/*` — per-module feature docs | Features, stories, test specs, output paths, archetype                       | [`../../application/modules/manifest.md`](../../application/modules/manifest.md) |
| 3   | `application/testing/*` — test strategy bridges   | Unit/integration/e2e/perf catalog                                            | [`../../testing.md`](../../testing.md)                                           |
| 4   | Link repair + catalog enrichment                  | Grep inventory of stale refs + orphan cleanup                                | [`manifest.md`](manifest.md) · [`../backlog.md`](../backlog.md) P-05             |
| 5   | `design/domain/event-storming.md`                 | Timeline + sequenceDiagram + BC flowchart + hotspots                         | [`../../design/domain/event-storming.md`](../../design/domain/event-storming.md) |
| 6   | `application/modules/manifest.md` enrichment      | 7-row B-Rules table (Feature/Stories/API/Test/Output/Archetype)              | [`../../application/modules/manifest.md`](../../application/modules/manifest.md) |
| 7   | `tasks/{roadmap,sprints/manifest}` sync           | S02 DONE / S03 PLANNED / S04 PLANNED rows + cadence/Done                     | [`../roadmap.md`](../roadmap.md) · [`manifest.md`](manifest.md)                  |

## Verification

- [x] Every row in deliverables table links to a file that exists on disk
- [x] `application/modules/manifest.md` — 7 modules, all columns filled, <80 lines
- [x] `design/domain/event-storming.md` — 150–250 lines, 3 mermaid diagrams
- [x] No implementation code / no new tests — docs only (read + write tools)

## DONE criteria

- [x] Part A/B catalog linked without duplicating canonical sources
- [x] Stale refs reconciled against `src/mcp/tools/` + `src/mcp/storage/` + `testing.md`
- [x] Roadmap + sprints manifest reflect S02 DONE, S03/S04 PLANNED
- [x] No empty sections or TODOs; all relative links resolve

## Links

- Prior: [S01](sprint-01.md) `ce708d1`/`5df5f0e` · Next: [S03](sprint-03.md) (TST-013)
- Roadmap: [`../roadmap.md`](../roadmap.md) · Backlog: [`../backlog.md`](../backlog.md) P-05
- Domain: [`../../design/domain/event-storming.md`](../../design/domain/event-storming.md)
