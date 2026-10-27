# Memory Search — Hybrid FTS5 + Vector Search

> **Module:** `memory` · **Feature:** Hybrid Search (FTS5 lexical + 384-dim vector semantic) · **Tools:** `memory-read` (search/detail/recap) · **Storage:** `memories` + `memories_fts` + `memory_vectors` + `kg_degrees`

## 1. Overview

Memory Search is the retrieval backbone of the local-memory MCP. It fuses two complementary signals — **FTS5 lexical** (`unicode61` tokenizer, `*` prefix matching) and **vector semantic** (`Xenova/all-MiniLM-L6-v2`, 384-dim) — into a single hybrid ranking that returns scoped, relevance-ordered memories. The feature is exposed via `memory-read` in three modes: `query→SEARCH`, `id/code→DETAIL`, `none→RECAP`. Search honors `owner`/`repo` isolation, tag/folder/branch/language scope, `is_global` broadcast, and `include_archived` toggle.

The design defers trigram mid-word matching and offloads embeddings to an async queue (migration v09), giving lexical immediacy with eventual semantic convergence (<1s typical).

## 2. User Stories

| #   | As a ...             | I want ...                                                                    | So that ...                                                     |
| --- | -------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | Agent (S0 hydrate)   | to recall memories relevant to my current task via `memory-read(query)`       | I start with prior decisions and patterns without hallucinating |
| 2   | Agent (during work)  | to search with inline tags like `tag:a,b lang:ts` auto-extracted into filters | I can narrow scope without learning structured param syntax     |
| 3   | Agent (detail fetch) | to fetch a memory by `code` or `id` after a prompt injection                  | I get full context for a referenced decision                    |
| 4   | Orchestrator (recap) | to call `memory-read` with no params and get a repo summary                   | I brief the team without scanning all memories                  |
| 5   | Reviewer / Dashboard | to list memories with pagination and see `hit_count`/`recall_rate`            | I audit utility and decay                                       |

## 3. Business Logic (Pseudocode)

```text
function hybridSearch(query, scope, opts):
  tags = extractInlineTags(query)        // src/mcp/utils/query-tags.ts
  residual = stripTags(query, tags)      // avoid FTS tokenizing "lang:ts"
  lexical = fts5Search(residual, scope, tags)  // unicode61, prefix *, BM25
  if vectorAvailable and residual.nonEmpty:
    embedding = embed(residual)          // Xenova 384-dim, cached
    candidates = vectorSearch(embedding, scope,
                              cap=VECTOR_CANDIDATE_CAP=100,
                              min=VECTOR_MIN_CANDIDATES=10)
    fused = reciprocalRankFusion(lexical, candidates, weights={fts:0.5, vec:0.5})
  else:
    fused = lexical
  fused = applyScopeFilters(fused, scope, tags, is_global, folder, branch, language)
  fused = applyTimeDecay(fused, decay_days=7, rate=0.5, min_importance=1)
  fused = paginate(fused, opts.limit, opts.offset)
  for m in fused: increment hit_count, update last_used_at
  log action_log {action:"memory-read", query, result_count}
  return fused

// Write path (offloaded embeddings):
on memory-write create/update:
  write row to memories, FTS index updated synchronously
  enqueue queue_jobs row (embedding outbox)
  worker leases batch (EMBEDDING_QUEUE_BATCH_SIZE=32), embeds, upserts memory_vectors
  // searchability window: lexical immediate, semantic <1s
```

Invariants: `WriteLock` serializes mutations; soft-delete via `status`/`deleted_at`; `supersedes` archives predecessor.

## 4. Sequence Diagram

```mermaid
sequenceDiagram
    participant Agent
    participant MCP as memory-read
    participant Tag as query-tags
    participant FTS as memories_fts
    participant Vec as memory_vectors
    participant Queue as queue_jobs
    participant DB as memories

    Agent->>MCP: memory-read(query, scope, limit)
    MCP->>Tag: extractInlineTags(query)
    Tag-->>MCP: {tags, residual}
    MCP->>FTS: BM25 search residual + scope filters
    FTS-->>MCP: lexical hits [id, rank]
    alt vector available & residual non-empty
        MCP->>Vec: cosine similarity (embedding of residual)
        Vec-->>MCP: semantic candidates (cap 100, min 10)
        MCP->>MCP: RRF fuse lexical + semantic
    else lexical only (minimal profile or empty residual)
        MCP->>MCP: use lexical ranking
    end
    MCP->>DB: fetch rows + apply decay + paginate
    DB-->>MCP: memory objects
    MCP->>DB: bump hit_count / last_used_at (async)
    MCP-->>Agent: ranked memories + total
    Note over Queue: Write path: memory-write enqueues<br/>queue_jobs; worker embeds & upserts<br/>memory_vectors — semantic lag <1s
```

## 5. Data Model

```mermaid
erDiagram
    memories ||--o| memory_vectors : "1:1 embedding"
    memories ||--o{ memories_fts : "FTS5 index"
    memories ||--o{ memory_summary : "per repo rollup"
    memories {
        TEXT id PK
        TEXT type
        TEXT title
        TEXT content
        INTEGER importance
        TEXT scope_owner
        TEXT scope_repo
        TEXT scope_branch
        TEXT scope_folder
        TEXT scope_language
        TEXT tags
        TEXT metadata
        INTEGER is_global
        TEXT status
        TEXT supersedes
        TEXT expires_at
        INTEGER hit_count
        INTEGER recall_count
        REAL recall_rate
        TEXT last_used_at
        TEXT created_at
        TEXT updated_at
    }
    memory_vectors {
        TEXT memory_id PK_FK
        BLOB vector
        INTEGER vector_version
        TEXT updated_at
    }
    memories_fts {
        TEXT rowid
        TEXT title
        TEXT content
        TEXT tags
    }
    queue_jobs {
        TEXT id PK
        TEXT payload
        TEXT status
        TEXT leased_at
    }
```

Indexes: `idx_memories_scope_type_created`, `idx_memories_scope_hit_count`; FTS5 `memories_fts` with `unicode61`; vector table no index (brute-force cosine, bounded candidate cap).

## 6. Public Interface

| Tool             | Mode              | Key Params                                                                                                          | Returns                                                |
| :--------------- | :---------------- | :------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------- |
| `memory-read`    | SEARCH            | `query`, `owner`/`repo`, `tags`, `scope{branch,folder,language}`, `is_global`, `include_archived`, `limit`/`offset` | Ranked `Memory[]` + `total`                            |
| `memory-read`    | DETAIL            | `id`/`code` or `ids`/`codes` (bulk)                                                                                 | Full `Memory` object(s) with `hit_count`/`recall_rate` |
| `memory-read`    | RECAP             | (no query/id) + `owner`/`repo`                                                                                      | `memory_summary` + recent activity stats               |
| `memory-write`   | CREATE/UPDATE/ACK | `type`, `title`, `content`, `importance`, `scope`, `tags`, `acknowledge`                                            | Created/updated `Memory` + queued embedding job        |
| `memory-delete`  | DELETE            | `id`/`code` or `ids`/`codes`                                                                                        | Soft-delete confirmation                               |
| `repo-summarize` | ROLLUP            | `owner`, `repo`, `signals[]`                                                                                        | Updated `memory_summary`                               |

Inline tag syntax (auto-extracted): `tag:a,b`, `lang:ts`, `branch:main`, `folder:src/mcp` — unknown keys stay free-text.

## 7. Dependencies

- **Runtime profile** `MCP_RUNTIME_PROFILE`: `full` (eager queue worker + model), `balanced` (lazy on first semantic op), `minimal` (lexical only).
- **Embedding model** `Xenova/all-MiniLM-L6-v2` via `@xenova/transformers` — network on first download, cached thereafter.
- **Queue config:** `EMBEDDING_QUEUE_BATCH_SIZE=32`, `POLL_INTERVAL_MS=500`, `LEASE_MS=60000`, `BACKFILL_CAP=2000`.
- **Search bounds:** `VECTOR_CANDIDATE_CAP=100`, `VECTOR_MIN_CANDIDATES=10`, `WAL_CHECKPOINT_INTERVAL_MS=10000`.
- **Upstream:** `src/mcp/utils/query-tags.ts`, `src/mcp/storage/sqlite.ts`, `src/mcp/services/memory*`, `src/mcp/entities/knowledge-graph/`.

## 8. Limitations

| Limitation                   | Detail                                                                    | Mitigation                                             |
| :--------------------------- | :------------------------------------------------------------------------ | :----------------------------------------------------- |
| No trigram mid-word match    | FTS5 `unicode61` + `*` prefix only; substring mid-word not guaranteed     | Use semantic vector for conceptual recall              |
| Semantic lag window          | Vectors offloaded; brief window (<1s) where new memories are lexical-only | FTS covers immediacy; RRF converges after worker batch |
| `minimal` profile no vectors | Semantic enrichment unavailable                                           | Lexical search remains functional                      |
| Tag extraction scope         | Only known keys (`tag`, `lang`/`language`, `branch`, `folder`) extracted  | Unknown keys intentionally remain free-text            |
| WAL checkpoint interval      | 10s floor between checkpoints under write burst                           | Tuned via `WAL_CHECKPOINT_INTERVAL_MS`                 |

## 9. Compliance

- **Scope isolation:** every query filtered by `owner`/`repo` unless `is_global`; dashboard merges by short `repo` only for display (ADR-008).
- **Attribution:** `agent`/`role`/`model` auto-populated from session (`MCP_CLIENT_NAME`/`MCP_MODEL` fallback) on `memory-write`.
- **Anti-hallucination:** similarity threshold for conflict detection is `0.85` (`MEMORY_CONFLICT_THRESHOLD`), not 0.55 (legacy).
- **Action log:** every `memory-read`/`write`/`delete` emits `action_log` row for audit.
- **Standards gate:** S1 `standard-read` hydrate before implementation that consumes recalled memories.

## 10. UI Layout

Dashboard `Memories` tab (`src/dashboard/ui/src/lib/components/Memory*.svelte`):

- **List view:** paginated cards with `title`, `type` badge, `importance` (1-5 dots), `scope` chips (`owner/repo`, `branch`, `folder`), `tags`, `hit_count`/`recall_rate`, `last_used_at` relative time.
- **Search bar:** single input supporting inline `key:value` tags with chip preview; debounced hybrid search.
- **Detail drawer:** full `content` markdown, metadata JSON, supersedes chain, KG entity links, acknowledge action.
- **Repo filter:** dropdown by short `repo` (merged owners) + owner badge per row; `is_global` rows highlighted.
- **States:** loading skeleton, empty (no memories), error (DB unreachable), stale (worker lag indicator).

## 11. Implementation Tasks

| #   | Task                                                                 | Scope                                                                        |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | FTS5 migration v10 + `unicode61` tokenizer + `memories_fts` triggers | `src/mcp/storage/migrations/v10-*.ts`                                        |
| 2   | Vector table + embedding queue outbox (v09) + worker lease/backoff   | `src/mcp/storage/migrations/v09-*.ts`, `src/mcp/services/embedding-queue.ts` |
| 3   | `memory-read` hybrid fusion (RRF) + inline tag extraction            | `src/mcp/tools/memory.read.ts`, `src/mcp/utils/query-tags.ts`                |
| 4   | `memory-write` conflict check (0.85) + supersedes + soft-delete      | `src/mcp/tools/memory.write.ts`                                              |
| 5   | `repo-summarize` rollup + `memory_summary` maintenance               | `src/mcp/tools/repo-summarize.ts`                                            |
| 6   | Dashboard memories tab + search bar + detail drawer                  | `src/dashboard/ui/src/lib/components/Memory*.svelte`                         |

## 12. Cross-References

- API contracts: `../../api/memory/api-memory.md` · `../api/memory/api-memory-read.md` · `../api/memory/api-memory-write.md` · `../api/memory/api-memory-delete.md` · `../api/memory/api-repo-summarize.md`
- Module landings: `../standards/overview.md` · `../handoffs/overview.md` · `../codebase-index/overview.md` · `../dashboard/overview.md` · `../context/overview.md`
- Testing: `../../testing.md` · `../../../testing/memory/memory-search.test.md` · `src/mcp/tests/memory*.test.ts` · `src/mcp/tests/fixtures/`
- Design: `../../../design/domain/domain.md` (§1 Memory, §10 Observation) · `../../../design/database/schema.md` (§ `memories`, `memory_vectors`, `memories_fts`, `memory_summary`, `queue_jobs`)
- Decisions: `../../../design/decisions/ADR-008-global-vs-scoped-ownership-and-dashboard-repo-view.md`
- Manifest: `../manifest.md` · Tool contract: `../../../../src/mcp/prompts/server/instructions.md`

---

_Feature owner: `documentation` agent · Last verified: 2026-09-07 against `src/mcp/tools/memory*.ts`, `src/mcp/utils/query-tags.ts`, and `src/mcp/utils/constants.ts`._
