# Module Catalog

> Inventory: 6 modules + 2 cross-cutting surfaces (context, prompts) · Manifest: [manifest.md](manifest.md) · API: [../api/README.md](../api/README.md) · Testing: [../testing/README.md](../testing/README.md)

## At a Glance

| #   | Module              | Scope                          | Key Paths                                                                   |
| :-- | :------------------ | :----------------------------- | :-------------------------------------------------------------------------- |
| 1   | **memory**          | Memories + FTS5 + vectors + KG | `src/mcp/tools/memory.*.ts`, `src/mcp/storage/`, `src/mcp/services/memory*` |
| 2   | **tasks**           | Tasks FSM + claims             | `src/mcp/tools/task*.ts`, `src/mcp/tools/claim*.ts`                         |
| 3   | **standards**       | Coding standards catalog       | `src/mcp/tools/standard*.ts`                                                |
| 4   | **handoffs/claims** | Inter-agent handoffs           | `src/mcp/tools/handoff*.ts`                                                 |
| 5   | **codebase-index**  | Tree-sitter index + search     | `src/mcp/codebase-index/`, `src/mcp/tools/codebase*.ts`                     |
| 6   | **dashboard**       | Svelte 5 + Express (port 3456) | `src/dashboard/`, `src/dashboard/ui/`                                       |
| 7   | **context**         | Context + Observations         | `src/mcp/tools/context*.ts`, `src/mcp/services/context*`                    |
| 8   | **prompts**         | Prompts (20th tool)            | `src/mcp/prompts/`                                                          |

Contract: `src/mcp/prompts/server/instructions.md` · Tool definitions: `src/mcp/types/tool-definitions/` (20 tools) · Schemas: `src/mcp/tools/schemas/` (Zod)

## Catalog

| Module           | Feature                                                  | Stories                                                          | API Spec                                                                       | Test Spec                                                                                                                                                                               | Path                                                             | Archetype     |
| :--------------- | :------------------------------------------------------- | :--------------------------------------------------------------- | :----------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------- | :------------ |
| `memory`         | Memories (FTS5 + vectors + KG, 4 tools)                  | [memory/memory-search.md](memory/memory-search.md)               | [../api/memory/api-memory.md](../api/memory/api-memory.md)                     | [../testing/memory/overview.md](../testing/memory/overview.md) · [../testing/memory/test-memory-search.md](../testing/memory/test-memory-search.md)                                     | [memory/overview.md](memory/overview.md)                         | Transactional |
| `memory`         | Repo summarize (`task_archive`)                          | —                                                                | [../api/memory/api-memory.md](../api/memory/api-memory.md)                     | [../testing/context/test-context-compilation.md](../testing/context/test-context-compilation.md)                                                                                        | [memory/overview.md](memory/overview.md)                         | Transactional |
| `tasks`          | Task lifecycle (FSM 6 states)                            | [tasks/task-lifecycle.md](tasks/task-lifecycle.md)               | [../api/tasks/api-tasks.md](../api/tasks/api-tasks.md)                         | [../testing/tasks/overview.md](../testing/tasks/overview.md) · [../testing/tasks/test-task-lifecycle.md](../testing/tasks/test-task-lifecycle.md)                                       | [tasks/overview.md](tasks/overview.md)                           | Workflow      |
| `tasks`          | Task claims (`claim-manage`)                             | —                                                                | [../api/tasks/api-tasks.md](../api/tasks/api-tasks.md)                         | [../testing/tasks/test-task-lifecycle.md](../testing/tasks/test-task-lifecycle.md)                                                                                                      | [tasks/overview.md](tasks/overview.md)                           | Workflow      |
| `standards`      | Standards catalog (`is_global` scoping)                  | [standards/standard-catalog.md](standards/standard-catalog.md)   | [../api/standards/api-standards.md](../api/standards/api-standards.md)         | [../testing/standards/overview.md](../testing/standards/overview.md) · [../testing/standards/test-standard-catalog.md](../testing/standards/test-standard-catalog.md)                   | [standards/overview.md](standards/overview.md)                   | Reference     |
| `handoffs`       | Handoff coordination (pending→accepted/rejected/expired) | [handoffs/overview.md](handoffs/overview.md)                     | [../api/README.md](../api/README.md) (tasks and handoffs)                      | [../testing/handoffs/overview.md](../testing/handoffs/overview.md) · [../testing/handoffs/test-handoff-coordination.md](../testing/handoffs/test-handoff-coordination.md)               | [handoffs/overview.md](handoffs/overview.md)                     | Coordination  |
| `handoffs`       | Claims fencing (one active per `task_id`)                | —                                                                | [../api/README.md](../api/README.md)                                           | [../testing/handoffs/test-handoff-coordination.md](../testing/handoffs/test-handoff-coordination.md)                                                                                    | [handoffs/overview.md](handoffs/overview.md)                     | Coordination  |
| `codebase-index` | Index & search (5 read modes + status)                   | [codebase-index/overview.md](codebase-index/overview.md)         | [../api/codebase-index/api-codebase.md](../api/codebase-index/api-codebase.md) | [../testing/codebase-index/overview.md](../testing/codebase-index/overview.md) · [../testing/codebase-index/test-codebase-search.md](../testing/codebase-index/test-codebase-search.md) | [codebase-index/overview.md](codebase-index/overview.md)         | Search        |
| `dashboard`      | Shell (Express `/api/*` + Svelte 5)                      | [dashboard/dashboard-shell.md](dashboard/dashboard-shell.md)     | [../api/README.md](../api/README.md) (REST `/api/*` separate)                  | [../testing/dashboard/overview.md](../testing/dashboard/overview.md) · [../testing/dashboard/test-dashboard-shell.md](../testing/dashboard/test-dashboard-shell.md)                     | [dashboard/overview.md](dashboard/overview.md)                   | Presentation  |
| `context`        | Context compilation (`agent-context`, `synthesize`)      | [context/context-compilation.md](context/context-compilation.md) | [../api/context/api-context.md](../api/context/api-context.md)                 | [../testing/context/overview.md](../testing/context/overview.md) · [../testing/context/test-context-compilation.md](../testing/context/test-context-compilation.md)                     | [context/context-compilation.md](context/context-compilation.md) | Aggregation   |
| `context`        | Observations (`observation-read/write`)                  | —                                                                | [../api/context/api-context.md](../api/context/api-context.md)                 | [../testing/context/test-context-compilation.md](../testing/context/test-context-compilation.md)                                                                                        | [context/context-compilation.md](context/context-compilation.md) | Aggregation   |
| `prompts`        | Prompts (`prompt-read`, 20th tool)                       | —                                                                | [../api/prompts/api-prompts.md](../api/prompts/api-prompts.md)                 | [../../testing.md](../../testing.md) (suite-wide)                                                                                                                                       | —                                                                | Reference     |

### Archetypes

| Archetype         | Meaning                                                   | Modules                |
| :---------------- | :-------------------------------------------------------- | :--------------------- |
| **Transactional** | CRUD + search + scoping, durability guarantees            | `memory`               |
| **Workflow**      | FSM with guarded transitions, side-effects on completion  | `tasks`                |
| **Reference**     | Catalog/broadcast, global vs scoped visibility            | `standards`, `prompts` |
| **Coordination**  | Fencing, handoff expiry, one-active-per-key invariants    | `handoffs/claims`      |
| **Search**        | Index lifecycle, multi-mode read, cache bounds            | `codebase-index`       |
| **Presentation**  | REST + UI, TTL caches, build gate, accessibility baseline | `dashboard`            |
| **Aggregation**   | Compilation, token budgeting, sampling fallback           | `context`              |

## Conventions

- **Transport**: MCP `tools/call` over stdio (`method: "tools/call"`) for modules 1–5 + 7–8; dashboard is REST `/api/*` on port 3456.
- **Scoping**: All MCP data scoped by `owner/repo` (from `git remote`); `standards` has `is_global` broadcast; dashboard aggregates by short `repo` only (`owner=""`) for ops view (ADR-008).
- **Error envelope**: `{"schema":"tool-error","code":"...","message":"...","retryable":false}` with `VALIDATION_ERROR | NOT_FOUND | CONFLICT | UNSUPPORTED_OPERATION | CAPABILITY_UNAVAILABLE | INTERNAL_ERROR`.
- **Stories → Spec → Tests**: Every feature links its story (if present), API spec (8-section file), and test spec (overview + scenario matrix). Missing story entries marked `—` are tool surfaces without separate story files.
- **Testing**: Per-module test plans in [../testing/README.md](../testing/README.md) (7 modules, scenario matrices `ID | Scenario | Input | Expected | Type` with positive, negative, security, chaos).

## Change Log

| Date       | Change                                                        |
| :--------- | :------------------------------------------------------------ |
| 2026-09-07 | Module catalog linking stories, API, test, and archetype      |
| 2026-09-07 | Part B testing docs: 7 module overviews + 7 scenario matrices |

## Links

- Manifest: [manifest.md](manifest.md)
- Application: [../README.md](../README.md) · Brief: [../../brief.md](../../brief.md)
- API catalog: [../api/README.md](../api/README.md)
- Testing catalog: [../testing/README.md](../testing/README.md) (7 modules, scenario matrices `ID|Scenario|Input|Expected|Type`design/decisions/design/design/design/)

## Maintenance

- **Verification**: Before writing any endpoint, config, or schema claim in module docs, read the source (`src/mcp/tools/*.ts`, `src/mcp/storage/sqlite.ts`, `src/dashboard/server.ts`). No fabricated examples.
- **Structure**: One H1 per file, proper heading nesting, consistent terminology across the catalog, and cross-links between API, test, and module overviews.
- **Links**: All relative links resolve; no broken anchors. Verify with `python3` link checker before ship.
- **Spell-check**: Run project spell-check on every markdown file before merge.

## Related

- Brief: [../../brief.md](../../brief.md) · AGENTS: `AGENTS.md` Documentation Map
- Testing standard: [../../testing.md](../../testing.md) · API: [../api/README.md](../api/README.md)
