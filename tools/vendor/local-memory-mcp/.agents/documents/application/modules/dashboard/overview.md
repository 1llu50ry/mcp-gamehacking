# Dashboard Module

> Human inspector for `memory.db` — Svelte 5 + Vite → `dist/dashboard/public/`, Express 5 on port 3456 (host `127.0.0.1`, optional `DASHBOARD_TOKEN`).

## Navigation (v0.44.1)

Workspace-first via `WorkspaceSwitcher` (9 shared primitives, lazy route splitting -44%, HiDPI arena). 11 tabs in `App.svelte` tab bar: arena (default), dashboard, activity, memories, tasks, **codebase**, handoffs, **queue**, knowledge-graph, standards, reference. `src/dashboard/ui/src/views/` holds tab views.

## Key routes

| Concern | Path                                                                                            |
| :------ | :---------------------------------------------------------------------------------------------- |
| Server  | `src/dashboard/server.ts` (entry), `src/dashboard/routes/*.ts`                                  |
| UI      | `src/dashboard/ui/src/App.svelte`, `src/dashboard/ui/src/lib/`, `views/`                        |
| API     | `/api/memories`, `/api/tasks`, `/api/codebase/*`, `/api/queue/*`, `/api/health`, `/api/metrics` |

Build: `npm run build` (vite + tsup + `scripts/copy-grammar-wasm.sh` + `scripts/gen-bins.mjs`). Dev: `npm run dashboard:dev` (:5173 proxy → :3456). See [brief.md](../../../brief.md) and [design/ui/](../../../design/ui/).
