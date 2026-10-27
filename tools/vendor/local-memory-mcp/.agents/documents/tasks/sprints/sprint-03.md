# Sprint 03 — CI Gate (TST-013) + Quality Gates

> **CANCELED (2026-09-14).** Operator decision: the blocking CI gate (`ci.yml` + coverage floors) is **not being shipped**. Do not execute. Retained as a historical record only. Bridge style — link, don't duplicate.
>
> _Original intent (superseded):_ Closes backlog hardening item `backlog.md` P-05 follow-up. Unblocks coverage (S04).

## Goals

- Ship blocking CI: `type-check → lint → test --coverage` on PR + `main`.
- Gate `release.yml` on CI success; publish only when green.
- Enforce coverage floors **70 / 70 / 70 / 60** (lines/funcs/branches/stmts) as documented in `testing.md` §7.1.
- Keep `test --coverage` exit-1 non-blocking only until this sprint lands (REFACTOR-TST-013 → blocking).
- Preserve `forks` pool + `jsdom` first-line env rules from `testing.md`.

## Deliverables

| #   | Artifact                        | Detail                                                                 | Canonical                                                               |
| :-- | :------------------------------ | :--------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| 1   | `.github/workflows/ci.yml`      | `type-check` + `lint` + `test --coverage` blocking (PR + `main`)       | `../../_tasks/testing-standardization.md` TST-013                       |
| 2   | `.github/workflows/release.yml` | Gated on CI — no publish when CI fails (`needs: ci` or equivalent)     | `release.yml` (future — gated after `ci.yml` lands)                     |
| 3   | Coverage floors                 | `70/70/70/60` enforced; `vitest --coverage` blocking unmuted           | [`../../testing.md`](../../testing.md) §7.1 · `vitest.config.ts`        |
| 4   | `copy-grammar-wasm.sh` ordering | CI runs grammar WASM build before tests (tree-sitter)                  | [`../../testing.md`](../../testing.md) · `AGENTS.md` verification order |
| 5   | Docs sync                       | `tasks/` bridges + `roadmap` + `manifest` updated; `_tasks/` untouched | [`manifest.md`](manifest.md) · [`../roadmap.md`](../roadmap.md)         |

## Planned acceptance criteria

- [ ] `ci.yml` runs `npm run type-check` → `npm run lint` → `bash scripts/copy-grammar-wasm.sh` → `npm run test -- --coverage --run` as required checks on PR + `main`
- [ ] Coverage gate fails the job when below `70/70/70/60` (no silent pass)
- [ ] `release.yml` declares `needs: ci` (or workflow_run) — blocked on CI failure
- [ ] Docs-only follow-up after CI lands: link `ci.yml` from `roadmap` + `manifest`

## Risks & notes

- `test --coverage` currently exits 1 by design (below floor) — CI flips the floor to blocking; S04 closes the gap to green.
- Native modules (`better-sqlite3`, `tree-sitter`) require `allowScripts` + `--legacy-peer-deps` in CI — keep `package.json` allowlist intact.
- Flaky `autoIndexIfStale` timing already baselined in `testing.md` — quarantine, not gate.

## Links

- Prior: [S02](sprint-02.md) (DONE 2026-09-08) · Next: [S04](sprint-04.md) (TST-006..012)
- Roadmap: [`../roadmap.md`](../roadmap.md) · Backlog: [`../backlog.md`](../backlog.md) P-05
- Testing: [`../../testing.md`](../../testing.md) §7 + `../../_tasks/testing-standardization.md` TST-013
