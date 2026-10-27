# Memory Module

> Durable local-first memory (hybrid search, scoped by `owner/repo`).

## Storage

SQLite `memory.db` (WAL) — `memories` table + FTS5 (`memories_fts`) + 384-dim vectors (`all-MiniLM-L6-v2` via `@xenova/transformers`) + KG tables (`knowledge_entities`, `knowledge_relations`, `knowledge_observations`). Hybrid scoring 40/30/15/15 (FTS/vector/recency/importance).

Details: [brief.md](../../../brief.md), [database schema](../../../design/database/schema.md), [architecture.md](../../../design/architecture/architecture.md).

## Tools (4)

| Tool             | Mode (auto-infer)                                                   | File                              |
| :--------------- | :------------------------------------------------------------------ | :-------------------------------- |
| `memory-read`    | `query`→search · `id/code`→detail · none→recap                      | `src/mcp/tools/memory.read.ts`    |
| `memory-write`   | `content`→create · `id/code`→update/acknowledge · `memories[]`→bulk | `src/mcp/tools/memory.write.ts`   |
| `memory-delete`  | single / bulk soft-delete                                           | `src/mcp/tools/memory.delete.ts`  |
| `repo-summarize` | archive signals → `task_archive`                                    | `src/mcp/tools/repo-summarize.ts` |

Async embedding outbox (migration v9, `MCP_RUNTIME_PROFILE` minimal/balanced/full) — vectors not instant after write. Contract: `src/mcp/prompts/server/instructions.md` · Tool defs: `src/mcp/types/tool-definitions/memory.ts`.
