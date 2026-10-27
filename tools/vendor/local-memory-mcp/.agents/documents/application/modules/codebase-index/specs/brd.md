# Business Requirements Document (BRD) — Codebase Index

- **Feature:** Codebase Index
- **Project:** local-memory-mcp (`@vheins/local-memory-mcp`)
- **Status:** Draft
- **Date:** 2026-07-22

>

---

## Executive Summary

AI coding agents operate with a fundamental blind spot: they cannot "see" the structure of a codebase without reading files sequentially. Every time an agent needs to find a function definition, understand a class hierarchy, or trace a call chain, it resorts to grep-and-read loops — burning tokens, context window, and time. For a typical TypeScript project, a single structural query ("what functions does `order.ts` export?") costs ~82K tokens via file exploration versus ~700 tokens via a graph query — a **99% reduction**.

The Codebase Index feature embeds a persistent, local-only code knowledge graph directly into the local-memory-mcp SQLite database. By parsing source files with tree-sitter WASM bindings, extracting structural declarations (functions, classes, interfaces, types, enums, exports), and storing them in queryable tables, AI agents gain instant structural awareness of a codebase without reading a single file.

This transforms local-memory-mcp from a memory-and-task server into a full-stack project intelligence platform — the only open-source MCP server that combines semantic memory, task orchestration, and code indexing in a single, local-first, zero-dependency package.

---

## Business Objectives

| Objective                             | Description                                                                      | Success Measure                                                              |
| :------------------------------------ | :------------------------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| **Reduce agent token consumption**    | Eliminate grep-and-read exploration loops by providing structured symbol queries | <50% of baseline tokens consumed for code-understanding tasks                |
| **Eliminate hallucinated symbols**    | Resolve function/class/type names from parsed AST rather than agent guessing     | Symbol accuracy improves from ~70% to ~100% for indexed code                 |
| **Accelerate code understanding**     | Enable agents to understand module structure and call chains in seconds          | Time to understand a new module: <60 seconds vs 15-30 min                    |
| **Enable cross-file impact analysis** | Trace call chains and dependency edges across files                              | Cross-file change impact assessment in <10 seconds vs 5-10 min               |
| **Drive adoption**                    | Provide the #1 most requested feature for MCP memory servers                     | 25%+ of new local-memory-mcp installs cite Codebase Index as adoption reason |
| **Differentiate from alternatives**   | Offer built-in indexing vs. standalone tools (codebase-memory-mcp)               | Users avoid installing/configuring/maintaining a second MCP server           |

---

## Stakeholders

| Stakeholder                       | Role                              | Needs                                                    | Success Looks Like                                                               |
| :-------------------------------- | :-------------------------------- | :------------------------------------------------------- | :------------------------------------------------------------------------------- |
| **AI Coding Agents** (Primary)    | Consumers of MCP tools            | Fast, accurate structural queries without file reads     | Agent resolves `search_symbols("validateOrder")` in <100ms with exact signature  |
| **Autonomous Refactoring Agents** | Execute feature implementations   | Cross-file awareness, call chain understanding           | Agent correctly traces impact of renaming a shared function across 10 callers    |
| **Code Review Agents**            | Analyze PRs for cross-file impact | Inbound/outbound call tracing per symbol                 | Agent identifies all downstream affects of a signature change                    |
| **Senior Engineers**              | Ship features using AI tools      | AI doesn't hallucinate function names or imports         | AI-generated code compiles on first try with correct imports                     |
| **Tech Leads**                    | Review PRs, maintain architecture | AI code respects existing patterns and module boundaries | AI-generated code uses correct existing functions rather than reimplementing     |
| **OSS Maintainers**               | Onboard AI contributors           | Fast codebase understanding without manual docs          | AI contributor submits correct first PR without human guidance on code structure |
| **Indie Developers**              | Solo development across projects  | Instant context rehydration when returning to a project  | Agent remembers codebase shape across sessions without re-exploring              |
| **System Auditors**               | Verify agent behavior             | Traceability of symbol lookups to agent actions          | All index queries logged in `action_log` for audit                               |

---

## Success Metrics

### Primary KPIs

| Metric                              | Current Baseline        | Target                      | Measurement Method                                                  |
| :---------------------------------- | :---------------------- | :-------------------------- | :------------------------------------------------------------------ |
| **Tokens per code query**           | ~82K (grep + read loop) | <1K (graph query)           | Compare `est_tokens` across sessions with/without index             |
| **Symbol resolution accuracy**      | ~70% (agent guesses)    | 100% (resolved from AST)    | Count hallucinated vs correct function names in generated code      |
| **Time to understand new module**   | 15-30 min (token cost)  | 30-60 sec                   | Agent session duration for "understand module X" task               |
| **Cross-file impact assessment**    | 5-10 min (manual)       | 5-10 sec                    | Time to answer "what breaks if I change this function's signature?" |
| **Index build speed (cold)**        | N/A (no index exists)   | <60s for <10K files         | End-to-end timing of `index_repository` on a fresh project          |
| **Index build speed (incremental)** | N/A                     | <10s for <100 changed files | End-to-end timing of incremental `index_repository`                 |
| **Search latency (P99)**            | N/A                     | <100ms                      | `search_symbols` response time for <500 results                     |

### Secondary KPIs

| Metric                       | Target             | Why It Matters                                              |
| :--------------------------- | :----------------- | :---------------------------------------------------------- |
| Storage overhead             | <50MB per 100K LOC | Prevents `memory.db` bloat                                  |
| False positive rate (search) | <5%                | Agents trust results without double-checking                |
| Index failure rate           | <1% of files       | Ensures comprehensive coverage                              |
| Multi-agent contention       | Zero conflicts     | Multiple agents reading simultaneously without interference |

---

## Scope

### In-Scope (MVP — Phase 1.0)

| Feature                         | Description                                                                                                            | Priority |
| :------------------------------ | :--------------------------------------------------------------------------------------------------------------------- | :------- |
| File discovery + filtering      | Recursive directory walk respecting `.gitignore`, binary detection, size limits                                        | P0       |
| tree-sitter AST parsing (TS/JS) | WASM-based parsing for TypeScript and JavaScript files                                                                 | P0       |
| Symbol storage (SQLite)         | Persistent storage in 4 new tables: `codebase_files`, `codebase_symbols`, `codebase_relations`, `codebase_index_queue` | P0       |
| `search_symbols` MCP tool       | Search by exact, prefix, or substring match with kind/file/export filters                                              | P0       |
| `get_file_symbols` MCP tool     | List all symbols in a given file                                                                                       | P0       |
| `index_repository` MCP tool     | Trigger full or incremental index on explicit command                                                                  | P0       |
| `index_status` MCP tool         | Query indexing progress and last run timestamp                                                                         | P0       |
| Schema migration (v3)           | Add 4 tables to existing `memory.db` via `MigrationManager`                                                            | P0       |

### In-Scope (Phase 1.1 — Should Have)

| Feature                     | Description                                                             |
| :-------------------------- | :---------------------------------------------------------------------- |
| Cross-file call resolution  | Build `CALLS`, `IMPLEMENTS`, `EXTENDS`, `IMPORTS` edges across files    |
| `trace_symbol` MCP tool     | Inbound/outbound call chain with configurable depth                     |
| `get_architecture` MCP tool | High-level structural summary: file counts, symbol counts, entry points |
| Incremental re-indexing     | Only re-parse files with changed checksums                              |
| Auto-index on session start | Background indexing when MCP server initializes                         |

### In-Scope (Phase 1.2 — Could Have)

| Feature                | Description                                             |
| :--------------------- | :------------------------------------------------------ |
| Dashboard Codebase tab | Svelte 5 UI for browsing symbols, file tree, and search |
| Graph visualization    | Force-directed code graph in the dashboard              |
| `search_code` MCP tool | Graph-augmented content search with symbol context      |
| Multi-language support | Python, Rust, Go, PHP parsing                           |
| Dead code detection    | Zero-caller function identification                     |

> **`search_code` IMPLEMENTED (verified 2026-08-10):** shipped as `codebase-read` **CODE** mode (TASK-316); the `search_code` tool name never existed (design intent only). **Dead code detection IMPLEMENTED** as the ARCHITECTURE-mode `deadCode` block (TASK-319).

### Out-of-Scope (Phase 2+ or Rejected)

| Feature                     | Rationale                                                                  |
| :-------------------------- | :------------------------------------------------------------------------- |
| Cross-repo indexing         | Niche use case; adds multi-root workspace complexity                       |
| LSP integration             | Requires spawning language servers; high complexity for marginal MVP value |
| Semantic/vector search      | ONNX model loading and indexing for code; evaluate demand first            |
| Team-shared graph artifacts | Git-stored compressed graph for zero-reindex onboarding                    |
| ADR management              | Niche workflow; deferred to separate feature                               |
| Cross-repo fleet analysis   | Distinct problem; addressed by separate "galaxy" feature                   |

---

## Assumptions

| #   | Assumption                                                                              | Impact if Wrong                                                          |
| :-- | :-------------------------------------------------------------------------------------- | :----------------------------------------------------------------------- |
| A1  | Target projects are primarily TypeScript/JavaScript (MVP scope).                        | Multi-language support must be accelerated.                              |
| A2  | Users have the `local-memory-mcp` MCP server configured with at least one project root. | `index_repository` without `projectPath` has no default.                 |
| A3  | Tree-sitter WASM grammars can be loaded in the project's Node.js runtime (≥18).         | Must implement fallback regex-based extraction delaying MVP.             |
| A4  | The `.gitignore` file reflects the user's intent for which files to index.              | Custom include/exclude patterns must be documented for non-git projects. |
| A5  | AI agents call MCP tools directly (not human IDE usage).                                | Dashboard tab becomes more critical than MCP tools.                      |
| A6  | SQLite write locking (via `proper-lockfile`) serializes index writes correctly.         | Race conditions could produce duplicate symbols.                         |
| A7  | SHA-256 checksum is sufficient for change detection.                                    | Very rare collisions have negligible impact.                             |

---

## Constraints

| #   | Constraint                                                                                               | Description                                                                    |
| :-- | :------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------- |
| C1  | **Local-only**: All processing must happen on-device. No cloud APIs, no data egress.                     | tree-sitter WASM runs locally; no API calls for parsing or resolution.         |
| C2  | **No native dependencies**: Cannot require C/C++ compilers, node-gyp, or platform-specific binaries.     | `web-tree-sitter` (WASM) over native `tree-sitter` bindings.                   |
| C3  | **Single SQLite database**: All data shares `memory.db`. No separate storage backend.                    | Tables must be clearly namespaced (`codebase_` prefix).                        |
| C4  | **Backward compatibility**: Existing memory, task, standard, and handoff tools must be unaffected.       | Schema migration v3 is additive-only; no changes to existing tables.           |
| C5  | **MCP protocol compliance**: All tools must follow JSON-RPC 2.0 and the project's `McpResponse` format.  | No custom protocols or transport layers.                                       |
| C6  | **No real-time file watching (MVP)**: `fs.watch` adds significant complexity for marginal initial value. | Users/agents must explicitly trigger re-index or wait for auto-index on start. |

> **C6 NOTE (verified 2026-08-10, TASK-322):** the constraint's _rationale_ (no `fs.watch`) is preserved, but its _consequence_ is superseded — a light **polling file watcher** now ships (`ENABLE_FILE_WATCHER`, default on; `src/mcp/codebase-index/services/file-watcher.ts`): registered repos are swept every `FILE_WATCH_INTERVAL_MS` (30s default) with a per-repo re-entry cap (`FILE_WATCH_TTL_MS`, 5 min default) and mtime/checksum short-circuiting, so the index stays fresh without an explicit trigger or a 24h wait. This is a bounded-delay polling sweep, **not** `fs.watch` real-time notification — `fs.watch` still carries the complexity the constraint cites and remains a recommendation for a later phase.

---

## Timeline & Cost Estimates

### Development Phases

| Phase                 | Features                                                                                                                      | Effort Estimate        | Calendar Target |
| :-------------------- | :---------------------------------------------------------------------------------------------------------------------------- | :--------------------- | :-------------- |
| **Spike**             | tree-sitter WASM feasibility, fixture-based visitor prototype                                                                 | 2 days                 | Pre-Sprint 1    |
| **Sprint 1** (MVP)    | File discovery, tree-sitter parsing, SQLite storage, `search_symbols`, `get_file_symbols`, `index_repository`, `index_status` | 10-12 engineering days | 2 weeks         |
| **Sprint 2** (Should) | Call resolution, `trace_symbol`, `get_architecture`, incremental re-index, auto-index                                         | 10-15 engineering days | 2-3 weeks       |
| **Sprint 3** (Could)  | Dashboard tab, graph visualization, multi-language, dead code detection                                                       | 15-20 engineering days | 3-4 weeks       |
| **Buffer**            | Bug fixes, edge cases, documentation, testing                                                                                 | 5-7 days               | —               |
| **Total**             | Full feature completion                                                                                                       | 40-55 engineering days | 8-12 weeks      |

### Resource Requirements

| Resource          | Requirement                                      | Notes                                           |
| :---------------- | :----------------------------------------------- | :---------------------------------------------- |
| **Engineering**   | 1 senior TypeScript developer (full-time)        | Familiar with tree-sitter ASTs preferred        |
| **Dependencies**  | `web-tree-sitter` + grammar WASM packages        | Zero native deps; pure npm install              |
| **Storage**       | <150MB additional for large projects (50K files) | Shared `memory.db` — no separate storage budget |
| **Testing**       | 4 test suites + fixtures                         | Unit per component + integration end-to-end     |
| **Documentation** | Updated README, API docs, changelog              | Includes migration guide for existing users     |

### Cost Estimate

| Category                             | Estimate              | Notes                                             |
| :----------------------------------- | :-------------------- | :------------------------------------------------ |
| Engineering (40-55 days × $800/day)  | $32,000 - $44,000     | Senior TypeScript contractor rate                 |
| Testing + QA (10-15 days × $500/day) | $5,000 - $7,500       | Automated + manual integration tests              |
| Documentation + Release              | $2,000 - $3,000       | README, API docs, changelog, migration guide      |
| **Total Estimated Cost**             | **$39,000 - $54,500** |                                                   |
| **Ongoing Maintenance**              | ~$500/month           | Dependency updates, bug fixes, minor enhancements |

---

## Related Documents

| Document                         | Location                                           |
| :------------------------------- | :------------------------------------------------- |
| Target Users & Personas          | `target-users.md`                                  |
| Value Proposition                | `value-proposition.md`                             |
| MVP Scope (MoSCoW)               | `mvp-scope.md`                                     |
| User Stories                     | `user-stories.md`                                  |
| Feature Prioritization (RICE)    | `feature-prioritization.md`                        |
| Risk Assessment                  | `risk-assessment.md`                               |
| ADR-002 (Architecture Decisions) | `../../../../design/decisions/adr-002-codebase-index.md` |
| Architecture Design              | `./design-architecture.md`      |
| API Contracts                    | `../../api/codebase-index/api-codebase.md`                      |
| Domain Model                     | `./design-domain.md`            |
| Database Schema                  | `./design-schema.md`            |
