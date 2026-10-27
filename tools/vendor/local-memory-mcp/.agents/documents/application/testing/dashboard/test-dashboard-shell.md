# Dashboard Shell — Test Scenarios

> Module: `dashboard` · Surfaces: Express REST (`/api/*`, `PORT=3456`, `DASHBOARD_HOST=127.0.0.1`) plus Svelte 5 shell (TopBar, Arena, KG, navigation) · Auth: `DASHBOARD_TOKEN` Bearer gate (none = open) · Build: `dist/dashboard/public/` plus `ensureDashboardBuild()`

## Preconditions

- Store: `createTestStore()` in-memory SQLite for API tests (same DB as MCP). Never touch `storage/memory.db` on disk.
- Environment defaults: `PORT=3456`, `DASHBOARD_HOST=127.0.0.1`, `DASHBOARD_JSON_LIMIT=50mb`, `DASHBOARD_STATS_TTL_MS=30000`, `DASHBOARD_KG_TTL_MS=30000`, `ARENA_OVERVIEW_TTL_MS=5000`, `CODE_GRAPH_MAX_EDGES=400`, `KG_MAX_GRAPH_EDGES=4000`, `KG_MAX_CONTEXT_ENTITIES=50`, `KG_CONTEXT_TEXT_TOKENS=40` (all from `src/mcp/utils/constants.ts` and `src/dashboard/server.ts`).
- Repo-only view (ADR-008): `GET /api/memories?repo=X` and `GET /api/tasks?repo=X` aggregate by short `repo` only (`owner=""` merges owners that share the same short repo). Per-owner isolation via MCP `memory-read` and `task-read` with explicit `owner` and `repo`. Dashboard rows should render owner badge (informational).
- Auth: MCP stdio has no Bearer. Dashboard uses optional `DASHBOARD_TOKEN` (`Authorization: Bearer <token>`); when unset, no gate is applied.
- Build: `npm run dashboard:build` → `dist/dashboard/public/` (`vite build`) plus `tsup` plus `dist/grammars/*.wasm` (via `scripts/copy-grammar-wasm.sh`). `bin/mcp-memory-dashboard.js` throws with actionable message if bundle is stale and cannot rebuild.

## Matrix

| ID       | Scenario                                               | Input                                                                                                                                       | Expected                                                                                                                                        | Type     |
| :------- | :----------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------- | :------- |
| DSH-S-01 | `GET /api/memories?repo=X` repo-only aggregation       | Seed memories for `(vheins, app)` plus `(other, app)`; `GET /api/memories?repo=app`                                                         | Both returned (intentional `owner=""` merge by `MemoryService.list` with short `repo`); owner badge data present                                | positive |
| DSH-S-02 | `GET /api/tasks?repo=X` returns tasks for repo         | Seed tasks for `repo=app` under two owners; `GET /api/tasks?repo=app`                                                                       | Array of tasks for that short `repo` (merged); pagination `limit` and `offset` honored                                                          | positive |
| DSH-S-03 | Stats cache respects TTL                               | Two `GET /api/stats?repo=app` within `DASHBOARD_STATS_TTL_MS=30000` vs after TTL (plus `DASHBOARD_KG_TTL_MS`, `ARENA_OVERVIEW_TTL_MS=5000`) | First cached (no recompute); after TTL recomputed (TTL expiry advances with `vi.useFakeTimers()`)                                               | positive |
| DSH-S-04 | `DASHBOARD_TOKEN` gate when set                        | `DASHBOARD_TOKEN=secret`; `GET /api/memories?repo=app` without token vs with `Authorization: Bearer secret`                                 | 401 without; 200 with correct token; wrong token → 401                                                                                          | positive |
| DSH-S-05 | Open mode when no token                                | No `DASHBOARD_TOKEN` env; `GET /api/memories?repo=app` without `Authorization`                                                              | 200 — unauthenticated access allowed (none = open)                                                                                              | positive |
| DSH-S-06 | Svelte shell renders TopBar plus navigation (STD-002)  | Mount `TopBar.svelte` under `// @vitest-environment jsdom` (FIRST line) via `@testing-library/svelte`                                       | TopBar renders; nav links present; accessibility and focus baseline (STD-002) satisfied                                                         | positive |
| DSH-S-07 | Code-graph respects edge cap                           | Seed repo with more than 800 graph edges; `GET /api/code-graph?repo=app`                                                                    | At most `CODE_GRAPH_MAX_EDGES=400` edges returned; stable truncation                                                                            | positive |
| DSH-S-08 | Knowledge-graph respects edge plus context caps        | Large KG with more than 4000 edges, more than 50 entities; `GET /api/kg/graph?repo=app`                                                     | At most `KG_MAX_GRAPH_EDGES=4000` edges; context enrichment at most `KG_MAX_CONTEXT_ENTITIES=50`, `KG_CONTEXT_TEXT_TOKENS=40`                   | positive |
| DSH-S-09 | Missing `repo` param returns validation error          | `GET /api/memories` (no `repo`) or `GET /api/tasks` (no `repo`)                                                                             | `400 VALIDATION_ERROR` with error envelope `{"schema":"tool-error","code":"..."}`                                                               | negative |
| DSH-S-10 | Unknown route returns 404                              | `GET /api/does-not-exist`                                                                                                                   | `404 NOT_FOUND` with error envelope                                                                                                             | negative |
| DSH-S-11 | Body too large rejected                                | `POST /api/memories` (or any JSON route) with body larger than `DASHBOARD_JSON_LIMIT=50mb`                                                  | `413 Payload Too Large`                                                                                                                         | negative |
| DSH-S-12 | CORS and host binding loopback default                 | `DASHBOARD_HOST=127.0.0.1` (default); request with non-loopback `Host` header                                                               | Bound only to loopback; explicit `0.0.0.0` required to expose; no CORS leak when loopback-only                                                  | security |
| DSH-S-13 | Token not logged                                       | Request with `Authorization: Bearer secret` when `DASHBOARD_TOKEN` set                                                                      | Server logs (`action_log` and stdout) do not contain token value (no secret leak)                                                               | security |
| DSH-S-14 | Cross-site scripting in memory content rendered safely | Memory with `content:"<script>alert(1)</script>"` displayed in Svelte list                                                                  | Rendered as escaped text; no script execution; `svelte-check` still passes                                                                      | security |
| DSH-S-15 | Chaos: concurrent API calls under load                 | 50 parallel `GET /api/stats?repo=app` plus mixed `GET /api/memories?repo=app`                                                               | No `SQLITE_BUSY`; all 200-range responses; cache not corrupted; `WAL_CHECKPOINT_INTERVAL_MS=10000` honored                                      | chaos    |
| DSH-S-16 | Chaos: `ensureDashboardBuild` stale bundle recovery    | Delete `dist/dashboard/public/` then launch `bin/mcp-memory-dashboard.js` with UI source newer than bundle                                  | Bin rebuilds via `vite build` (installed package without `src/` skips rebuild); if build fails, throws with actionable message (not silent 404) | chaos    |

## Helpers

- `createTestServer()` — Express factory with `createTestStore()` injected; use for API integration tests without binding to real `PORT=3456`.
- `mountTopBar()` — helper that mounts `TopBar.svelte` under `// @vitest-environment jsdom` FIRST line via `@testing-library/svelte`; assert nav links.
- `vi.useFakeTimers()` plus `vi.setSystemTime()` — advance past `DASHBOARD_STATS_TTL_MS` and `DASHBOARD_KG_TTL_MS` for DSH-S-03.
- Keep helpers co-located with test file; shared fixtures live under `src/mcp/tests/fixtures/`.

## Environment

| Variable                 | Default            | Relevance                                                           |
| :----------------------- | :----------------- | :------------------------------------------------------------------ |
| `PORT`                   | `3456`             | Express bind port; tests use in-memory server without real bind     |
| `DASHBOARD_HOST`         | `127.0.0.1`        | Loopback-only by default; DSH-S-12 asserts no non-loopback exposure |
| `DASHBOARD_TOKEN`        | `""` (none = open) | Bearer gate; DSH-S-04 and DSH-S-05                                  |
| `DASHBOARD_STATS_TTL_MS` | `30000`            | Stats cache TTL; DSH-S-03                                           |
| `CODE_GRAPH_MAX_EDGES`   | `400`              | Dashboard code-graph edge cap; DSH-S-07                             |
| `KG_MAX_GRAPH_EDGES`     | `4000`             | KG graph edge cap; DSH-S-08                                         |

## Notes

- **Harness**: API tests drive Express in-memory (no real `PORT=3456` bind in tests); UI tests under `// @vitest-environment jsdom` as FIRST line via `@testing-library/svelte` (wired through `vitest.config.ts` `server.deps.inline` plus Svelte plugin). Pure TypeScript tests like `arenaTransformLayout.test.ts` run under `node` and MUST NOT declare jsdom.
- **Build assumption**: `npm run build` does `vite build` → `dist/dashboard/public/` plus `tsup` (mcp plus dashboard servers) plus `scripts/copy-grammar-wasm.sh` → `dist/grammars/*.wasm` plus `scripts/gen-bins.mjs` → `bin/*.js`. `npm run dashboard` serves the built bundle — run `npm run build` (or `npm run dashboard:build`) first.
- **Limits from constants**: All edge caps, TTLs, and JSON limit values are read from `process.env` via `envInt` and `envStr` in `src/mcp/utils/constants.ts` — tests assert against those defaults when env is unset.
- **Types gate**: `npm run type-check` (`tsc` + `tsconfig.test.json` + `svelte-check`) — green tests do not imply type correctness; run after UI file splits.
- **Security**: DSH-S-13 validates no secret leak in logs; DSH-S-14 validates Svelte rendering escapes content (same payload as MEM-S-13, different surface).

## Execution

```bash
bash scripts/copy-grammar-wasm.sh
npx vitest run src/dashboard/tests
npx vitest run src/dashboard/ui   # all 18 UI files
npm run test:integration          # --project integration
npm run test -- --coverage
npm run type-check
```

Live UI work: `npm run dashboard:dev` (`:5173`, proxies `/api` → `:3456`) alongside `npm run dashboard` (`:3456` built bundle).

## Links

- Overview: [overview.md](overview.md)
- Standard: [../../../testing.md](../../../testing.md) §1–9
- API: [../../api/README.md](../../api/README.md) (dashboard REST separate from MCP `tools/call` transport)
- Module: [../../modules/dashboard/overview.md](../../modules/dashboard/overview.md) · Server: `src/dashboard/server.ts` · Bins: `bin/mcp-memory-dashboard.js`
- Compliance: `STD-002` (accessibility, focus, and polling baseline)

## Changelog

| Date | Change |
| :--- | :----- |
| 2026-09-07 | Initial dashboard shell scenarios (repo-only + TTL + token + build) |
