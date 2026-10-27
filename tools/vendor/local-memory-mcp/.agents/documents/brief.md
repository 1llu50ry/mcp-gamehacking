# Brief — local-memory-mcp

## Overview

`@vheins/local-memory-mcp` is a local-first MCP server that gives AI agents
long-term memory, task orchestration, and codebase awareness. All data stays on
machine in local SQLite (`memory.db`; archived memories offload to `cold-archive.db`,
enabled by default). A Svelte dashboard provides a
human inspector for tasks, memories, and knowledge.

## Architecture

Two processes share `memory.db` (WAL mode, `proper-lockfile` writes):

- **MCP server** (`src/mcp/server.ts` → `dist/mcp/server.js`, stdio) — 20 tools,
  32 prompts, hybrid search (FTS5 + ONNX vectors 40/30/15/15), knowledge graph.
- **Dashboard** (`src/dashboard/server.ts` → port 3456, Express + Svelte 5) —
  Kanban, Activity, KG viz, Reference catalog, Standards, Handoffs.

See [Architecture Overview](design/architecture/architecture.md), [DB schema](design/database/schema.md),
[Design decisions](design/decisions/) and [Canonical ADRs](design/decisions/README.md).

## Key Features

- **20 MCP tools** — `memory-read/write/delete`, `task-read/write/delete`,
  `standard-read/write/delete`, `claim-manage`, `handoff-read/write`,
  `codebase-index`, `codebase-read`, `agent-context`, `synthesize`,
  `repo-summarize`, `prompt-read` (LIST/DETAIL over 32 prompts).
- **32 prompts** — engineering roles & workflows (`src/mcp/prompts/definitions/`).
- **Dashboard** — 11 tabs incl. Arena, Codebase, Queue; force-directed KG canvas.
- **Codebase index** — tree-sitter WASM (14 grammars + Markdown), FTS5 +
  `codebase_references` edges; `codebase-read` modes SEARCH/TRACE/FILE/CONTENT/ARCHITECTURE.
- **Soul maintenance** — decay (7-day, rate 0.5, threshold 1) + async embedding
  outbox (migration v9, `MCP_RUNTIME_PROFILE` minimal/balanced/full).

## Tech Stack

| Layer          | Choice                                                     |
| :------------- | :--------------------------------------------------------- |
| Language       | TypeScript (Node 22, `tsup` + `vite`)                      |
| Persistence    | SQLite (`better-sqlite3`, FTS5, WAL)                       |
| Embeddings     | `@xenova/transformers` (`all-MiniLM-L6-v2`, 384-dim, ONNX) |
| Frontend       | Svelte 5 + Vite, Express 5                                 |
| Codebase parse | `web-tree-sitter` WASM (`dist/grammars/*.wasm`)            |
| Protocol       | MCP SDK (stdio), Zod v4 validation                         |
| Tests          | Vitest 4 (`forks` pool)                                    |

## Links

- Tool contract: `src/mcp/prompts/server/instructions.md`
- API docs: `.agents/documents/application/api/` · Operations: `.agents/documents/application/modules/codebase-index/`
