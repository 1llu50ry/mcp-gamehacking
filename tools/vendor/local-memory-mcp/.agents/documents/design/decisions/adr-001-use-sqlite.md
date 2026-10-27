# ADR-001 — Use SQLite

## Title

Use SQLite and ONNX Transformers for Local Storage & Search

## Context

The system requires a persistent storage layer that supports complex full-text queries, combined with semantic vector search capabilities. The data must remain entirely local to ensure user privacy for proprietary codebases.

## Decision

We will use `better-sqlite3` as our core datastore, taking advantage of its synchronous performance and WAL mode for concurrent reads. We will embed `@xenova/transformers` utilizing the ONNX runtime directly in Node.js to generate vector embeddings entirely offline using the `all-MiniLM-L6-v2` model (384-dim vectors).

## Status

**Adopted** — This decision has been implemented and is the foundation of the data layer.

## Consequences

- **Pros:** Zero-configuration deployment for users; 100% privacy; fast read/write speeds (< 50ms queries); single-file portability; WAL mode for concurrent dashboard + MCP server access; FTS5 for full-text search.
- **Cons:** First-time run requires downloading the embedding model (~20-50MB) which may block initial requests if not handled via background workers. Scaling to millions of records might slow down brute-force cosine similarity compared to a dedicated vector DB.

## Implementation Notes

- Database schema versioning via `_schema_version` table (current: v37; see `SCHEMA_VERSION` in `src/mcp/storage/migrations/index.ts`).
- Cross-process write locking via `proper-lockfile` (`WriteLock.withLock()`).
- Default path: platform config dir (e.g. `~/.config/local-memory-mcp/memory.db` on Linux), created if absent; `MEMORY_DB_PATH` overrides and `./storage/memory.db` is used only when it already exists (corrected 2026-09-14 against `src/mcp/storage/sqlite.ts:29-49`).
- Migrations managed by `src/mcp/storage/migrations/` (versioned index — `index.ts` + `vNN-*.ts`).
