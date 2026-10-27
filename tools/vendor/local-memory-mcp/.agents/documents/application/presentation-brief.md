# Presentation Brief — local-memory-mcp (G3 Gate)

> Bridge doc — points to canonical sources, does not duplicate them. Legacy brief kept at [.agents/documents/brief.md](../brief.md) for compat.

## 1. Overview

`@vheins/local-memory-mcp` v0.46.0 — local-first MCP server giving AI agents long-term memory, task orchestration, and codebase awareness. Dogfoods itself: the repo's own memory lives in `~/.config/local-memory-mcp/memory.db` (platform config dir, created by default; `./storage/memory.db` is used when it already exists; WAL, gitignored). No data leaves the machine; embeddings run locally via ONNX.

## 2. Architecture

Two processes sharing one primary SQLite DB (`memory.db`, `proper-lockfile` writes; archived memories offload to `cold-archive.db`, enabled by default):

- **MCP server** `src/mcp/server.ts` → `dist/mcp/server.js` (stdio, JSON-RPC) — 20 tools, 32 prompts, hybrid search (FTS5 + vectors 40/30/15/15), knowledge graph, embedding outbox worker.
- **Dashboard** `src/dashboard/server.ts` → port 3456 (Express 5 + Svelte 5 via Vite → `dist/dashboard/public/`) — Kanban, Activity, KG viz, Reference catalog, Standards, Handoffs; optional `DASHBOARD_TOKEN`.
- **Codebase index** inside same DB (`codebase_*` tables) — tree-sitter WASM grammars (`dist/grammars/*.wasm`), `codebase-read` modes SEARCH/TRACE/FILE/CONTENT/ARCHITECTURE.
- **Runtime profiles** `MCP_RUNTIME_PROFILE` minimal/balanced/full (default full).

See [Architecture](../design/architecture/architecture.md) · [DB schema](../design/database/schema.md) · Tool contract `src/mcp/prompts/server/instructions.md`.

## 3. Key Features

- **Memory** — FTS5 (`unicode61`, `*` prefix) + 384-dim `Xenova/all-MiniLM-L6-v2` vectors, `scoreHybrid` 40/30/15/15; async embedding queue (migration v9); decay (7-day, rate 0.5).
- **Tasks FSM** — 6 states `backlog→pending→in_progress→completed` (+ `canceled`/`blocked`); `claim-manage` required before `completed` (`est_tokens`).
- **Codebase index** — 15 grammars (14 tree-sitter + Markdown), FTS5 `codebase_symbols_fts` + `codebase_references` edges; `codebase-index`/`codebase-read` mandatory first per tool contract.
- **Dashboard** — 11 tabs workspace-first (`WorkspaceSwitcher`, 9 primitives, lazy split -44%, HiDPI arena) — arena/dashboard/activity/memories/tasks/codebase/handoffs/queue/knowledge-graph/standards/reference.

## 4. Tech Stack

| Layer       | Choice                                                          |
| :---------- | :-------------------------------------------------------------- |
| Language    | TypeScript, Node 22 (CI pin), `tsup` + `vite`, `svelte-check`   |
| Persistence | SQLite `better-sqlite3` (FTS5, WAL) — single `memory.db`        |
| Embeddings  | `@xenova/transformers` `all-MiniLM-L6-v2` (384-dim, ONNX, lazy) |
| Frontend    | Svelte 5 + Vite, Express 5                                      |
| Parsing     | `web-tree-sitter` WASM (`dist/grammars/*.wasm`)                 |
| Protocol    | MCP SDK (stdio), Zod v4 validation, Vitest 4 (`forks` pool)     |

## 5. Roadmap

- **v0.44.1 (2026-09-06)** — `prompt-read` (LIST/DETAIL over 32 prompts), workspace-first dashboard redesign (PRs #104–106: 9 primitives, WorkspaceSwitcher, lazy split, HiDPI), owner-repo hardening (migration v34, ADR-008).
- **This sprint (G3)** — `tasks/` → `application/` migration (modules/manifest.md: 6 modules), presentation-brief gate, docs drift sweep. See [Module Manifest](modules/manifest.md) + `CHANGELOG.md` 0.44.1/0.44.0.

## 6. Risks & Mitigations

| Risk                                                                       | Mitigation                                                                                                            |
| :------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| Perf flakes (`indexing-service autoIndexIfStale` timing, queue contention) | BUSY-as-transient + jittered backoff, chunked backfill/cleanup (v0.40.0); known flake documented in AGENTS.md         |
| Docs drift (tool count, KG MCP tools, DB path)                             | Verified-vs-implementation banners in `architecture.md`/`brd.md`; G3 doc-sync gate                                    |
| SQLite-only (no horizontal scale, WAL lock)                                | `BEGIN IMMEDIATE`, `proper-lockfile` WriteLock, `busy_timeout` 5s; single-host scope is intentional (ADR-001/ADR-008) |

## 7. Next Steps

1. Land `presentation-brief.md` (this file) — G3 gate.
2. Complete `tasks/` → `application/` migration per [manifest.md](modules/manifest.md) (memory/tasks/standards/handoffs/codebase-index/dashboard).
3. Close doc-sync sweep (orphan/missing refs) and tag next patch.

_Legacy brief at [.agents/documents/brief.md](../brief.md) kept for compatibility._
