# Product Requirements Document (PRD) — Codebase Index

- **Feature:** Codebase Index
- **Project:** local-memory-mcp (`@vheins/local-memory-mcp`)
- **Status:** Draft
- **Date:** 2026-07-22

>

---

## Product Overview

Codebase Index is a first-class module of the local-memory-mcp MCP server that provides AI coding agents with instant structural awareness of a project's source code. It parses TypeScript and JavaScript files using tree-sitter WASM, extracts declarations (functions, classes, interfaces, types, enums, exports), and stores them in searchable SQLite tables within the existing `memory.db`.

**Problem:** AI agents exploring codebases currently burn 82K+ tokens per structural query through grep-and-read loops. They hallucinate function names (~30% error rate), miss cross-file dependencies, and re-discover codebase structure every session.

**Solution:** Agents query the code index via dedicated MCP tools — `search_symbols`, `get_file_symbols`, `trace_symbol`, `get_architecture` — getting accurate, structured results in <100ms at <1K tokens per query.

**Target release:** 0.5.0 (MVP), 0.6.0 (Phase 1.1), 0.7.0 (Phase 1.2)

---

## Target Personas

Reference: `target-users.md` for full persona definitions.

### Primary Persona: AI Coding Agent

The agent is the direct consumer of all Codebase Index MCP tools. It does not have a UI; it communicates exclusively via JSON-RPC.

**Needs:**

- Find function/class/type definitions by name in <100ms
- Understand all symbols exported from a file without reading the file body
- Trace call chains across files to assess change impact
- Get accurate parameter types and return types without guessing

### Persona: Senior Engineer (Indirect User)

Experienced developer working on monorepos who relies on AI agents for feature implementation.

**Needs:**

- AI agent correctly imports existing functions rather than reimplementing them
- AI-generated code compiles on first attempt (no hallucinated imports)
- Agent understands the existing architecture pattern before writing code

### Persona: Tech Lead (Indirect User)

Oversees 3-10 engineers, reviews PRs daily. Wants AI agents to respect architectural boundaries.

**Needs:**

- AI code adheres to existing module boundaries and dependency directions
- Review cycles shortened because AI avoids structural mistakes
- Architecture overview available for onboarding new team members

### Persona: OSS Maintainer (Indirect User)

Manages 1-3 open-source repos. Wants AI contributors to submit correct PRs without hand-holding.

**Needs:**

- AI contributor can understand codebase structure independently
- New contributors (human or AI) learn the codebase layout quickly
- Issues can be triaged with structural understanding

### Persona: Indie Developer (Indirect User)

Solo full-stack developer switching between projects frequently.

**Needs:**

- Fast context rehydration when returning to a project after weeks away
- AI doesn't need to re-discover codebase shape every session
- Single tool covers memory + tasks + code indexing

---

## Feature List (MoSCoW)

### Must Have (MVP — Phase 1.0)

| #   | Feature                     | Description                                                                                                                   | User Story   |
| :-- | :-------------------------- | :---------------------------------------------------------------------------------------------------------------------------- | :----------- |
| M1  | File discovery + filtering  | Recursive directory walk respecting `.gitignore`, binary detection, size limits, language extension mapping                   | US-02        |
| M2  | tree-sitter AST parsing     | WASM-based parsing extracting functions, classes, methods, interfaces, types, enums, exports with signatures and doc comments | US-05, US-06 |
| M3  | Symbol storage (SQLite)     | 4 new tables (`codebase_files`, `codebase_symbols`, `codebase_relations`, `codebase_index_queue`) with full indexing          | US-01        |
| M4  | `search_symbols` MCP tool   | Name-based search with exact/prefix/substring, kind/file/export filters, pagination                                           | US-03        |
| M5  | `get_file_symbols` MCP tool | List all symbols in a file with metadata, line spans, signatures, doc comments                                                | US-04        |
| M6  | `index_repository` MCP tool | Trigger full or incremental indexing with progress reporting                                                                  | US-01        |
| M7  | `index_status` MCP tool     | Query indexing progress, last indexed timestamp, file/symbol counts                                                           | —            |
| M8  | Schema migration v3         | Add codebase tables via `MigrationManager`, backward compatible                                                               | —            |

### Should Have (Phase 1.1)

| #   | Feature                     | Description                                                                                | User Story | Effort |
| :-- | :-------------------------- | :----------------------------------------------------------------------------------------- | :--------- | :----- |
| S1  | Cross-file call resolution  | Resolve `CALLS`, `IMPLEMENTS`, `EXTENDS`, `IMPORTS` edges across files using name matching | US-07      | Medium |
| S2  | `trace_symbol` MCP tool     | Inbound/outbound call chain traversal with configurable depth (1-10)                       | US-07      | Medium |
| S3  | `get_architecture` MCP tool | High-level structural summary: file counts, symbol counts, entry points, hotspots          | US-09      | Low    |
| S4  | Incremental re-indexing     | SHA-256 checksum comparison; only re-parse changed/new files                               | US-08      | Medium |
| S5  | Auto-index on session start | Background index trigger on MCP server initialization with file limit guard                | US-10      | Low    |
| S6  | `CodebaseIndexEntity`       | Business logic entity extending `BaseEntity` with CRUD+bulk operations                     | —          | Medium |

### Could Have (Phase 1.2)

| #   | Feature                | Description                                                            | User Story | Effort      |
| :-- | :--------------------- | :--------------------------------------------------------------------- | :--------- | :---------- |
| C1  | Dashboard Codebase tab | Svelte 5 tab for browsing symbols, file tree, search, and index status | US-12      | Medium      |
| C2  | Graph visualization    | Force-directed code graph in dashboard using Canvas renderer           | —          | High        |
| C3  | `search_code` MCP tool | Content search with symbol context enrichment                          | US-11      | Medium      |
| C4  | Multi-language support | Python, Rust, Go, PHP parsing (in priority order)                      | —          | Medium/lang |
| C5  | Dead code detection    | Zero-caller function identification (excluding entry points)           | —          | Medium      |

> **C3 + C5 IMPLEMENTED (verified 2026-08-10):** C3 is met by `codebase-read` **CODE** mode (content grep + enclosing-symbol context; `search_code` never shipped as a tool — design intent only, US-11 maps to `codebase-read({ content })`). C5 is met by the ARCHITECTURE-mode **deadCode** block (`unreferenced[]`/`hotspots[]`/`languageCoverage`, `src/mcp/codebase-index/services/dead-code.ts`, TASK-319). C4 is superseded (15 languages shipped). C2 graph visualization remains NEXT PHASE.

### Won't Have (Phase 2+)

| #   | Feature                     | Rationale                                                                              |
| :-- | :-------------------------- | :------------------------------------------------------------------------------------- |
| W1  | Cross-repo indexing         | Adds multi-root complexity; rarely needed for single-project agents                    |
| W2  | LSP integration             | High complexity (spawning language servers); tree-sitter provides adequate AST for MVP |
| W3  | Semantic/vector search      | ONNX embedding cost for code; evaluate demand after MVP                                |
| W4  | Team-shared graph artifacts | Git-stored compressed graph; requires git integration                                  |
| W5  | Cross-repo fleet analysis   | Distinct problem; separate "galaxy" feature scope                                      |

---

## User Stories Summary

Reference: `user-stories.md` for full story details with acceptance criteria.

| ID    | Story                                                                                        | Priority | Phase  | Effort |
| :---- | :------------------------------------------------------------------------------------------- | :------- | :----- | :----- |
| US-01 | As an Agent, I want to trigger indexing of the current project so I can query the code graph | P0       | MVP    | L      |
| US-02 | As an Agent, I want the indexer to find all relevant source files respecting `.gitignore`    | P0       | MVP    | S      |
| US-03 | As an Agent, I want to search symbols by name (exact/prefix/fuzzy)                           | P0       | MVP    | M      |
| US-04 | As an Agent, I want to retrieve all symbols in a specific file                               | P0       | MVP    | S      |
| US-05 | As an Agent (sub-agent), I want to get full function signatures                              | P0       | MVP    | M      |
| US-06 | As an Agent, I want to retrieve JSDoc/TSDoc comments for a symbol                            | P0       | MVP    | S      |
| US-07 | As an Agent (reviewer), I want to trace call relationships                                   | P1       | Ph 1.1 | L      |
| US-08 | As a Developer, I want the index to update automatically on file changes                     | P1       | Ph 1.1 | L      |
| US-09 | As an Agent, I want to query the high-level project structure                                | P1       | Ph 1.1 | M      |
| US-10 | As a Developer, I want auto-indexing on session start                                        | P1       | Ph 1.1 | S      |
| US-11 | As an Agent, I want to search file contents with symbol context                              | P2       | Ph 1.2 | M      |
| US-12 | As a Developer, I want to browse indexed symbols in the Dashboard                            | P2       | Ph 1.2 | M      |

---

## Non-Functional Requirements (NFRs)

### Performance

| NFR                                    | Target                            | Measurement                              | Phase  |
| :------------------------------------- | :-------------------------------- | :--------------------------------------- | :----- |
| Cold index (<10K files)                | <60 seconds wall-clock            | `index_repository` end-to-end timing     | MVP    |
| Incremental index (<100 changed files) | <10 seconds wall-clock            | `index_repository` (incremental) timing  | Ph 1.1 |
| `search_symbols` latency               | <100ms P99                        | Instrumented timing of query execution   | MVP    |
| `get_file_symbols` latency             | <50ms P99                         | Instrumented timing of query execution   | MVP    |
| `trace_symbol` latency                 | <200ms P99 for depth=3            | Recursive CTE execution timing           | Ph 1.1 |
| MCP server no-load overhead            | <50MB additional RAM              | Memory snapshot before/after index       | MVP    |
| Indexing memory peak                   | <2GB for projects with <50K files | Heap snapshot during largest parse batch | MVP    |

### Storage

| NFR                           | Target                          | Measurement                        | Phase  |
| :---------------------------- | :------------------------------ | :--------------------------------- | :----- |
| Database growth (100K LOC)    | <50MB additional to `memory.db` | Compare db size with/without index | MVP    |
| Database growth (500K LOC)    | <250MB additional               | Same                               | Ph 1.1 |
| Per-row overhead (symbols)    | <500 bytes average              | Row size analysis                  | MVP    |
| Per-row overhead (relations)  | <200 bytes average              | Row size analysis                  | MVP    |
| Index WAL growth during index | <100MB peak                     | Monitor WAL file size during index | MVP    |

### Reliability & Correctness

| NFR                              | Target                            | Measurement                                                       | Phase |
| :------------------------------- | :-------------------------------- | :---------------------------------------------------------------- | :---- |
| Parse success rate               | >99% of `.ts`/`.js` files         | Files indexed / files discovered                                  | MVP   |
| Symbol extraction false positive | <1%                               | Manual audit on 3 fixture files per query type                    | MVP   |
| Search result precision          | >95% (top 5 results)              | Relevance audit on known queries                                  | MVP   |
| Index idempotency                | Same checksum → identical symbols | Verify on repeated index of unchanged project                     | MVP   |
| Crash recovery                   | Incomplete index survives restart | Kill process mid-index, re-index, verify completeness             | MVP   |
| File coverage                    | 100% of source files discovered   | Audit against `find . -name "*.ts" -not -path "*/node_modules/*"` | MVP   |

### Security & Privacy

| NFR                       | Requirement                                              | Phase |
| :------------------------ | :------------------------------------------------------- | :---- |
| Data locality             | All processing local; zero data egress                   | MVP   |
| File boundaries           | `projectPath` validated within MCP root directories      | MVP   |
| Binary safety             | Binary files detected and skipped; never parsed          | MVP   |
| No code execution         | tree-sitter AST parsing is read-only; no code evaluation | MVP   |
| Audit trail               | All index tool calls logged to `action_log`              | MVP   |
| Path traversal prevention | `projectPath` validated to prevent directory escape      | MVP   |

### Compatibility

| NFR                         | Requirement                                      | Phase  |
| :-------------------------- | :----------------------------------------------- | :----- |
| Node.js version             | ≥18 (must support WASM)                          | MVP    |
| Existing tool compatibility | All memory/task/standard/handoff tools unchanged | MVP    |
| Multi-agent safety          | Write lock prevents concurrent index writes      | MVP    |
| Dashboard integration       | Codebase tab co-exists with existing 6 tabs      | Ph 1.2 |

---

## Release Criteria

### MVP (Phase 1.0) Release Gate

| Criteria                                                                 | How to Verify                                            |
| :----------------------------------------------------------------------- | :------------------------------------------------------- |
| 1. TypeScript project with 1,000+ files indexes in <60s                  | Time `index_repository` on local-memory-mcp's own source |
| 2. `search_symbols("format")` returns all matching symbols               | Results include functions, classes, interfaces, types    |
| 3. `get_file_symbols("src/utils/order.ts")` returns 5+ symbols           | Verify symbols match actual file contents                |
| 4. All existing tests pass                                               | Run full test suite: `vitest run`                        |
| 5. Schema migration v3 runs cleanly on existing v2 database              | Test against copy of real `memory.db`                    |
| 6. Index of 10K synthetic files completes without OOM                    | Stress test with generated fixture                       |
| 7. All 5 MVP user stories (US-01 through US-06) pass acceptance criteria | Manual verification per story                            |
| 8. `index_repository` with invalid path returns appropriate error        | Error message, not crash                                 |

### Phase 1.1 Release Gate

| Criteria                                                              | How to Verify                                     |
| :-------------------------------------------------------------------- | :------------------------------------------------ |
| 1. Incremental re-index detects changed files via checksum            | Modify a file; verify only that file is re-parsed |
| 2. `trace_symbol("formatOrder")` returns inbound/outbound callers     | Verify accuracy against manual code audit         |
| 3. Auto-index triggers on server start for previously indexed project | Clear index; restart; verify index runs           |
| 4. `get_architecture` returns accurate file/symbol counts             | Compare against actual project stats              |
| 5. Index of 50K files completes within 5 minutes                      | Stress test with generated fixture project        |

### Phase 1.2 Release Gate

| Criteria                                                             | How to Verify                                           |
| :------------------------------------------------------------------- | :------------------------------------------------------ |
| 1. Dashboard Codebase tab loads and displays indexed project data    | Visual verification                                     |
| 2. Graph visualization renders for a medium-sized project (5K files) | Visual verification; no console errors                  |
| 3. `search_code` returns symbol-enriched content results             | Verify against known code patterns                      |
| 4. Multi-language (Python) parsing extracts correct symbols          | Compare against manually verified fixtures              |
| 5. Dead code detection correctly identifies zero-caller functions    | Manual audit on known unused functions in test fixtures |

> **Release-gate criteria 3 + 5 IMPLEMENTED (verified 2026-08-10):** row 3 is met by `codebase-read` CODE mode (`src/mcp/codebase-index/services/code-search.ts`, TASK-316) — the `search_code` tool name never shipped; the feature is the `CODE` auto-infer of `codebase-read({ content })`. Row 5 is met by the ARCHITECTURE-mode `deadCode.unreferenced[]` output (`src/mcp/codebase-index/services/dead-code.ts`, TASK-319) — the analysis covers entry-point exclusion (package.json bin/main/exports/browser, shebang, exported top-level public API) and is bounded by `DEAD_CODE_SCAN_LIMIT` (500).

---

## Success Metrics

Reference: `brd.md` for primary business KPIs.

### Adoption Metrics (First 90 Days Post-MVP)

| Metric                                                                      | Target                         |
| :-------------------------------------------------------------------------- | :----------------------------- |
| % of active local-memory-mcp users who run `index_repository` at least once | >30%                           |
| % of those who run it more than once (retention signal)                     | >60%                           |
| Average project size indexed                                                | >5,000 files                   |
| Token savings observed (via `est_tokens`)                                   | >50% reduction for code tasks  |
| GitHub issues / feature requests related to indexing                        | <5 per month (quality measure) |

### Quality Metrics

| Metric                                 | Target | Monitoring                                          |
| :------------------------------------- | :----- | :-------------------------------------------------- |
| Index failure rate across all projects | <2%    | Error logging in `action_log`                       |
| Search result relevance satisfaction   | >90%   | Implicit: agent uses results vs. falls back to grep |
| Parse error rate per file              | <1%    | Tracked in `codebase_files.error_message`           |
| Crash/panic rate                       | 0      | Process-level monitoring                            |

---

## Related Documents

| Document                      | Location                    |
| :---------------------------- | :-------------------------- |
| Business Requirements         | `brd.md`                    |
| Target Users & Personas       | `target-users.md`           |
| Value Proposition             | `value-proposition.md`      |
| MVP Scope (MoSCoW)            | `mvp-scope.md`              |
| User Stories                  | `user-stories.md`           |
| Feature Prioritization (RICE) | `feature-prioritization.md` |
| Risk Assessment               | `risk-assessment.md`        |
| Acceptance Criteria           | `acceptance-criteria.md`    |
| BDD Scenarios                 | `bdd-scenarios.md`          |
| Edge Cases                    | `edge-cases.md`             |
