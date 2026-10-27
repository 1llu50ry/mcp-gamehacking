# Target Users — Codebase Index


## Primary Users

### 1. AI Coding Agents (Primary Consumers)

The single largest consumer of the Codebase Index is the AI agent itself. When an agent needs to understand code structure — what functions exist, how they call each other, which classes inherit from which — it currently resorts to file-by-file exploration: grep, glob, read. This is slow, token-expensive, and lacks structural awareness.

| User                    | Context                                                       | Need                                                                                      |
| ----------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Agent (autonomous)**  | Running a task that requires understanding code relationships | Extract function signatures, call chains, and type definitions without reading every file |
| **Agent (sub-agent)**   | Delegated to implement a feature in an unfamiliar module      | Discover relevant entry points, existing patterns, and dependency structure               |
| **Agent (code review)** | Analyzing a PR for cross-file impact                          | Trace which symbols are affected by a change set                                          |

### 2. Developers Using AI Agents (Secondary Consumers)

Developers who rely on AI coding assistants (Claude Code, Codex CLI, Cursor, etc.) are the indirect beneficiaries. They want their AI agent to understand the codebase accurately and quickly — without wasting tokens on file-by-file exploration or producing hallucinated function names.

| Persona             | Demographics                                                              | Goals                                                                                     | Frustrations                                                                                   |
| ------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Senior Engineer** | 5+ yrs experience, works on large monorepos or microservice architectures | Ship features faster; wants AI to navigate code confidently without hand-holding          | AI asks basic structural questions repeatedly; burns through context window grepping for types |
| **Tech Lead**       | Oversees 3-10 engineers, reviews PRs daily                                | Reduce review cycles; ensure AI-generated code respects existing architecture patterns    | AI generates code with non-existent imports or wrong function signatures                       |
| **OSS Maintainer**  | Manages 1-3 open-source repos, solo or small team                         | Onboard AI contributors quickly; let AI handle issue triage with structural understanding | New contributors (human or AI) waste time learning codebase layout manually                    |
| **Indie Developer** | Solo full-stack, switches between projects frequently                     | Fast context rehydration when returning to a project after weeks away                     | AI forgets codebase shape across sessions; re-explores every time                              |

### 3. Other AI Agents in a Multi-Agent Setup

When multiple agents coordinate on the same repo (e.g., via local-memory-mcp handoffs), each agent needs structural context without re-indexing. The Codebase Index serves as a shared read-only knowledge base.

---

## Key Pain Points

| Pain Point                           | Severity | Current Workaround                                       | How Codebase Index Solves It                        |
| ------------------------------------ | -------- | -------------------------------------------------------- | --------------------------------------------------- |
| **Token-expensive code exploration** | Critical | Grep + Read loops: ~412K tokens for 5 structural queries | Graph queries at ~3.4K tokens — 99% reduction       |
| **Hallucinated symbols**             | High     | Agent guesses function names, often wrong                | Exact symbol resolution from parsed AST             |
| **Cross-file unawareness**           | High     | Agent reads files in isolation, misses call chains       | Call graph with inbound/outbound edge resolution    |
| **Session context decay**            | Medium   | Agent re-discovers structure each session                | Persistent SQLite graph survives across sessions    |
| **Multi-agent redundancy**           | Medium   | Each agent re-indexes independently                      | Shared knowledge graph via local-memory-mcp storage |
| **Type resolution gaps**             | Low      | Agent relies on import statements and loose grep         | tree-sitter AST with full type hierarchy            |

---

## Non-Target Users (Explicitly Out of Scope)

- **Human developers browsing code directly**: They should use their IDE. The Codebase Index is optimized for machine consumption via MCP tools.
- **CI/CD pipelines in read-only mode**: Phase 2 consideration. MVP focuses on interactive agent sessions.
- **Cross-repo fleet analysis**: A distinct problem (solved by codebase-memory-mcp's "galaxy" feature). Not in scope for MVP.

---

## Usage Frequency & Volume Estimates

| User Segment                   | Sessions/Day | Queries/Session | Value Driver                |
| ------------------------------ | ------------ | --------------- | --------------------------- |
| AI agent (autonomous refactor) | 5-20         | 10-30           | Token savings, accuracy     |
| AI agent (code review)         | 3-10         | 5-15            | Cross-file impact detection |
| Human developer (indirect)     | 10-40        | —               | Faster agent responses      |
