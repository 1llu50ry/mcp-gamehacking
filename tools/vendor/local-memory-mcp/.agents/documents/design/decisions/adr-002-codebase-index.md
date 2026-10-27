# ADR-002 — Codebase Index

- **Status:** Accepted
- **Date:** 2026-07-22
- **Author:** backend agent (Composite Senior Authority)
- **Supersedes:** None
- **Superseded by:** None

>

---

## Context

The local-memory-mcp project needs a Codebase Index feature that allows AI agents to search for functions, classes, interfaces, types, and other structural entities within the project's source code. This enables agents to understand codebases without reading files sequentially, providing structured symbol information on demand.

The feature must integrate with the existing MCP server architecture, reuse the SQLite database, and follow established patterns for entities, tool registration, and resource management.

---

## Decision 1: Use web-tree-sitter WASM Bindings for Node.js Parsing

**Choice:** `web-tree-sitter` npm package with `@tree-sitter-grammars/tree-sitter-typescript` grammar WASM.

**Alternatives considered:**

| Alternative                    | Pros                                         | Cons                                                                                                  |
| :----------------------------- | :------------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| `tree-sitter` (native binding) | Fastest, mature                              | Requires native build tools (node-gyp, Python, C compiler); fragile in CI; platform-specific binaries |
| `web-tree-sitter` (WASM)       | Pure Node.js, no native deps, cross-platform | ~30% slower than native; async initialization                                                         |
| `@babel/parser`                | No WASM, pure JS, huge ecosystem             | JavaScript/TypeScript only; not extensible to other languages; AST shape different from tree-sitter   |
| `typescript` compiler API      | Official, type-checked                       | Full type resolution overhead for simple symbol extraction; not extensible to non-TS languages        |

**Rationale:** `web-tree-sitter` WASM bindings align with the project's existing approach of using `@xenova/transformers` (ONNX WASM). The project has no native build dependency and runs on any Node.js platform. WASM performance is acceptable for indexing (<60s for 10K files). Language grammar selection is consistent across languages — extending to Python, Rust, Go, and PHP later requires only loading additional grammar WASM files, not changing the parsing infrastructure.

---

## Decision 2: Store Indexed Data in Existing SQLite Database (New Tables)

**Choice:** Add 4 new tables (`codebase_files`, `codebase_symbols`, `codebase_relations`, `codebase_index_queue`) to the existing `memory.db`, managed by the existing `MigrationManager`.

**Alternatives considered:**

| Alternative                       | Pros                             | Cons                                                                                                 |
| :-------------------------------- | :------------------------------- | :--------------------------------------------------------------------------------------------------- |
| Separate `codebase.db` file       | Isolation, independent lifecycle | Two databases to manage, migrate, and backup; custom connection management; can't share transactions |
| In-memory only (no persistence)   | Zero storage overhead            | Full re-index on every session start; loses incremental benefit                                      |
| Compressed JSON files per project | Portable, git-friendly           | No SQL query support; custom search implementation needed; perf degrades with project size           |
| Embedded KV store (e.g., LMDB)    | High performance for key-value   | Added dependency; unfamiliar API; no SQL queries; harder to debug                                    |

**Rationale:** The existing SQLite database already uses WAL mode, has a proven migration system, and is accessible by both the MCP server and dashboard. Adding tables to the same database means no additional connection management, unified backup/restore, and the ability to join across tables if needed in the future (e.g., linking codebase symbols to knowledge graph entities). The migration system (`MigrationManager`) supports versioned additive changes and has been battle-tested through v1→v2.

---

## Decision 3: Incremental Indexing with File Checksum Comparison (SHA-256)

**Choice:** Store a SHA-256 checksum per file in `codebase_files.checksum`. On re-index, compute the current checksum and compare against stored value. Only re-parse changed files.

**Alternatives considered:**

| Alternative              | Pros                      | Cons                                                                                                                                          |
| :----------------------- | :------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| mtime comparison         | Fast, no hash computation | Unreliable — mtime changes without content change (git checkout, touch); mtime may not change after content modification in some environments |
| git diff                 | Precise change detection  | Requires git; doesn't work on non-git projects; significant overhead                                                                          |
| Full re-index every time | Simple, no complexity     | Unacceptably slow for large projects on every session start                                                                                   |
| File size comparison     | Simple                    | Fails on size-preserving edits; false negatives                                                                                               |

**Rationale:** SHA-256 provides cryptographic certainty that content has changed. While it adds ~1-2ms per file for hashing, this is negligible compared to tree-sitter parsing time (10-50ms per file). Incremental indexing is critical for the auto-index-on-start feature — re-parsing 10,000 files when only 3 changed would waste time and tokens.

---

## Decision 4: Single-Pass Parsing for MVP, Multi-Pass for Phase 1.1+

**Choice:** MVP (Phase 1.0) performs a single parse pass per file, extracting only declarations (function, class, interface, type, enum, exported variables). Relation resolution (calls, imports, extends, implements) is deferred to Phase 1.1 as a second pass.

**Alternatives considered:**

| Alternative                        | Pros                         | Cons                                                                                                                                             |
| :--------------------------------- | :--------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| Full two-pass from MVP             | No architecture rework later | Adds 2-3 days to MVP delivery; relation resolution is complex (name ambiguity, cross-file resolution); delays the core value of `search_symbols` |
| Parse all in one pass              | Most efficient               | AST tree must be traversed for both declarations and call expressions simultaneously; visitor logic becomes complex and harder to extend         |
| Lazy resolution (resolve on query) | No storage for relations     | Every query becomes a partial re-parse; defeats the purpose of indexed search                                                                    |

**Rationale:** The MVP must deliver the core value proposition — "given a symbol name, find its definition, file, and line" — in the shortest viable time. Relations (`trace_symbol`, `CALLS` edges) are a Phase 1.1 feature. Deferring them keeps MVP scope tight and allows the declaration-only parser design to be stabilized before adding resolution complexity. The two-pass architecture is designed from the start; Phase 1.1 adds the second pass without changing the first.

---

## Decision 5: Parse on Demand + Background Indexing

**Choice:** Indexing can be triggered explicitly via `index_repository` MCP tool. An optional auto-index hook triggers background indexing on MCP server initialization (Phase 1.1). No real-time file watching in MVP.

**Alternatives considered:**

| Alternative                                   | Pros                                | Cons                                                                                                                        |
| :-------------------------------------------- | :---------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| Auto-index only (no manual trigger)           | Agents never need to think about it | Long startup delay for large projects; agents can't control timing; harder to debug                                         |
| File watcher (fs.watch) for real-time updates | Always up to date                   | Complex to implement correctly across platforms; CPU overhead monitoring large trees; requires process lifecycle management |
| Manual trigger only (no auto-index)           | Explicit, predictable               | Agents must remember to index; extra tool call in every session                                                             |

**Rationale:** Parse on demand with explicit `index_repository` gives agents control while keeping the implementation simple. Auto-index on start (Phase 1.1) adds convenience for the common case. File watching is explicitly excluded from MVP — it adds significant complexity for marginal value in an agent-driven workflow where agents already know when they need fresh index data.

---

## Consequences

### Positive

- **No native dependencies**: WASM-only approach maintains the project's zero-native-build philosophy.
- **Unified storage**: Single database simplifies backup, migration, and dashboard access.
- **Incremental updates**: Subsequent indexing runs are 10-100x faster than the first.
- **Phased delivery**: MVP delivers core value fast; architecture designed for future phases.
- **Consistent patterns**: Follows existing entity, migration, and tool registration patterns — reduces cognitive load.

### Negative

- **WASM startup latency**: tree-sitter WASM initialization adds ~500ms-1s to first parse call.
- **No type resolution**: tree-sitter provides syntactic trees, not semantic type graphs. Cross-file type resolution is limited to name matching (future LSP integration would be needed for full type fidelity).
- **Multi-language parsing**: Go, Python, PHP, Rust, Java, Dart, Kotlin, Ruby, Swift, C, and C++ visitors added in v0.21.0. See [Feature Overview](https://github.com/vheins/local-memory-mcp/wiki/features/Codebase-Index) for the full language matrix.
- **Database growth**: Indexing large projects adds up to 150MB to `memory.db`, increasing memory usage and backup size.
- **Staleness window**: Between edits and next index run, symbols may be stale. Agents may see outdated results.

### Mitigations

- WASM initialization runs once at module load and is cached.
- Name-based cross-file resolution for Phase 1.1 provides adequate call-graph quality for agent use cases.
- Multi-language support is additive — grammar loading is identical, only visitors differ; a `LanguageVisitor` interface abstracts this.
- Database growth is proportional to project size and expected; WAL mode prevents write contention.
- The `lastIndexedAt` timestamp is exposed via `index_status` so agents can assess staleness.
