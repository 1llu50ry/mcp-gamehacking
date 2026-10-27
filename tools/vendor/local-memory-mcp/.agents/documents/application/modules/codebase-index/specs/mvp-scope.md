# MVP Scope — Codebase Index

## MoSCoW Prioritization

>

### Must Have (MVP Gate)

| #   | Feature                          | Rationale                                                                                                                                                    | Acceptance Criteria                                                                                                                                                                          |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | **File discovery and filtering** | Must know which files to parse. Respect `.gitignore`, configurable include/exclude patterns.                                                                 | `Given` a project root, `when` indexing starts, `then` all `.ts`/`.tsx`/`.js`/`.jsx` files are discovered excluding `node_modules` and gitignored paths.                                     |
| M2  | **tree-sitter AST parsing**      | Core parsing engine. Produce AST nodes for functions, classes, methods, interfaces, types, exports.                                                          | `Given` a TypeScript file, `when` parsed via tree-sitter, `then` all top-level declarations (functions, classes, interfaces, types, exports) are extracted with name, span, and doc comment. |
| M3  | **Symbol storage (SQLite)**      | Persist parsed symbols in local-memory-mcp's existing SQLite database. Schema must cover functions, classes, interfaces, types with file path and line span. | `Given` a completed parse, `when` symbols are stored, `then` they are queryable from the `codebase_nodes` and `codebase_edges` tables, linked to their source file.                          |
| M4  | **`search_symbols` MCP tool**    | Primary query tool — search symbols by name (exact, prefix, fuzzy). Return symbol metadata (file, line, type, doc comment).                                  | `Given` an indexed codebase, `when` an agent calls `search_symbols` with `"formatOrder"`, `then` it returns `{ name, kind, file, line, signature }` for all matching symbols.                |
| M5  | **`get_file_symbols` MCP tool**  | List all symbols in a given file — entry point for file-level understanding.                                                                                 | `Given` an indexed file path, `when` `get_file_symbols` is called, `then` all symbols in that file are returned with their metadata.                                                         |

### Should Have (Phase 1.1)

| #   | Feature                         | Rationale                                                                                                                | Effort     |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------- |
| S1  | **Cross-file call resolution**  | Build `CALLS` edges between function/method symbols across files. Enables trace_path.                                    | Medium     |
| S2  | **`trace_path` MCP tool**       | Given a function name, trace inbound or outbound call chains. Returns ordered lists of callers/callees.                  | Medium     |
| S3  | **`get_architecture` MCP tool** | Return high-level structure: file count, symbol counts per kind, entry points (files with exports), dependency clusters. | Low-Medium |
| S4  | **Incremental re-indexing**     | On subsequent runs, only re-parse changed files (via mtime or git diff). Full index on first run only.                   | Medium     |
| S5  | **Auto-index on session start** | When MCP session initializes, index the project root automatically (with file limit guard).                              | Low        |

### Could Have (Phase 1.2)

| #   | Feature                    | Rationale                                                                                                        | Effort              |
| --- | -------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------- |
| C1  | **Dashboard Codebase tab** | Browser-based view of indexed symbols, file tree, and search. Consistent with existing Svelte 5 dashboard.       | Medium              |
| C2  | **3D graph visualization** | Interactive knowledge graph in the dashboard. Fork/adapt codebase-memory-mcp's Force Graph approach using D3.js. | High                |
| C3  | **`search_code` MCP tool** | Graph-augmented grep over indexed files — returns symbol context around matches.                                 | Low-Medium          |
| C4  | **Multi-language support** | Extend tree-sitter parsers beyond TS/JS: Python, Rust, Go, PHP (in priority order).                              | Medium per language |
| C5  | **Dead code detection**    | Find functions with zero callers (excluding entry points like exports, handlers).                                | Medium              |

> **C3 + C5 IMPLEMENTED (verified 2026-08-10):** the C3 cell is met by `codebase-read` **CODE** mode (content grep + enclosing-symbol context, `src/mcp/codebase-index/services/code-search.ts`, TASK-316); the `search_code` tool name never shipped — design intent only, per the header note. The C5 cell is met by the ARCHITECTURE-mode **deadCode** block (`unreferenced[]`/`hotspots[]`/`languageCoverage`, `src/mcp/codebase-index/services/dead-code.ts`, TASK-319). C4 is superseded (15 languages shipped, v0.21.0). C2 dashboard graph visualization remains NEXT PHASE.

### Won't Have (Phase 2 — Explicitly Excluded from MVP)

| #   | Feature                         | Reason                                                                                                 | Target  |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------ | ------- |
| W1  | **Cross-repo indexing**         | Adds complexity of multi-root workspace management. Rarely needed for single-project agents.           | Phase 2 |
| W2  | **LSP integration**             | Requires spawning language servers, managing runtime state. High complexity, medium value for MVP.     | Phase 2 |
| W3  | **Team-shared graph artifacts** | Committing compressed graph DB to repo for zero-reindex teammate onboarding. Requires git integration. | Phase 2 |
| W4  | **Semantic/vector search**      | Embedding code symbols for similarity search. High infra cost (ONNX model loading).                    | Phase 2 |
| W5  | **ADR management**              | Architecture Decision Record creation/linking from code index. Niche workflow.                         | Phase 2 |

---

## MVP Boundary Diagram

```
┌─────────────────────────────────────────────────────┐
│                    Phase 2                          │
│  Cross-repo · LSP · Vector Search · ADR            │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│                  Phase 1.2 (Could)                   │
│  Dashboard Tab · 3D Graph · Multi-lang · Dead Code  │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│               Phase 1.1 (Should)                     │
│  Call Resolution · trace_path · Architecture · Incr │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│                   MVP (Must)                         │
│  File Discovery · tree-sitter Parse · SQLite Store   │
│  search_symbols · get_file_symbols                   │
└─────────────────────────────────────────────────────┘
```

---

## Success Criteria for MVP

1. **Index a project**: Given a TypeScript project with <10K files, complete indexing in <60 seconds (cold) or <10 seconds (incremental).
2. **Query symbols**: `search_symbols("foo")` returns all matching symbols within 100ms.
3. **No regression**: Existing memory, task, standard, and handoff tools continue to work identically.
4. **Storage efficiency**: Code graph adds <50MB to `memory.db` for a 100K LOC project.
5. **Token savings**: A typical agent session using Codebase Index consumes <50% of the tokens it would without it (measured via `est_tokens`).
