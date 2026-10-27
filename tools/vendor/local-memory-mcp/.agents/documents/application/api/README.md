# API Catalog

> Transport: MCP `tools/call` over stdio (`method: "tools/call"`, `params.name` + `params.arguments`) · Contract: `src/mcp/prompts/server/instructions.md` · Schemas: `src/mcp/tools/schemas/*` (Zod, via `inputSchemaFromSchema`) · Definitions: `src/mcp/types/tool-definitions/` (20 tools)

## Catalog

| Module           | Feature                | Tools                                                                                    | Path                                                             |
| :--------------- | :--------------------- | :--------------------------------------------------------------------------------------- | :--------------------------------------------------------------- |
| `memory`         | Memories               | `memory-read`, `memory-write`, `memory-delete`                                           | [memory/api-memory.md](memory/api-memory.md)                     |
| `tasks`          | Tasks + Claims         | `task-read`, `task-write`, `task-delete`, `claim-manage`                                 | [tasks/api-tasks.md](tasks/api-tasks.md)                         |
| `standards`      | Coding Standards       | `standard-read`, `standard-write`, `standard-delete`                                     | [standards/api-standards.md](standards/api-standards.md)         |
| `codebase-index` | Codebase Index         | `codebase-index`, `codebase-read`                                                        | [codebase-index/api-codebase.md](codebase-index/api-codebase.md) |
| `context`        | Context + Observations | `agent-context`, `synthesize`, `repo-summarize`, `observation-read`, `observation-write` | [context/api-context.md](context/api-context.md)                 |
| `prompts`        | Prompts                | `prompt-read` (20th tool, alias for `prompts/*`)                                         | [prompts/api-prompts.md](prompts/api-prompts.md)                 |

Total: **20 tools** across 6 API files. Each file contains 8 sections: Overview, Authentication, Parameters, Request Body, Responses, Usage Example, OpenAPI 3.0 YAML, Cross-References.

## Global Standards

Global standards (`is_global=true` in `coding_standards`) are visible across all `(owner, repo)` scopes via `((owner=? AND repo=?) OR is_global=1)`. Prefer `is_global` for cross-repo rules (e.g. `STD-001`, `STD-002`); repo-specific standards set `is_global=false` and require `repo`. See `src/mcp/prompts/server/instructions.md` § Global vs scoped tables and ADR-008.

## Conventions

- **Transport**: `tools/call` over stdio. Dashboard REST (`/api/*`) is separate and documented under `src/dashboard/`.
- **Auth**: MCP stdio — no Bearer. Dashboard — optional `DASHBOARD_TOKEN` (`Authorization: Bearer <token>`).
- **Error envelope**: `{"schema":"tool-error","code":"...","message":"...","retryable":false,"error":"...","details":{}}` — `code` in `VALIDATION_ERROR | NOT_FOUND | CONFLICT | UNSUPPORTED_OPERATION | CAPABILITY_UNAVAILABLE | INTERNAL_ERROR`.
- **Auto-infer**: Many tools infer mode from which params are present (e.g. `query` vs `id`/`code` vs none). See per-file §1 and §3.
- **Session defaults**: `owner`/`repo`/`agent`/`model` auto-populated from session (`git remote`, `MCP_CLIENT_NAME`, `MCP_MODEL`); explicit args take priority.
- **Runtime profiles**: `MCP_RUNTIME_PROFILE` `minimal` | `balanced` | `full` (default). Affects semantic/index/watcher availability; search degrades to lexical when unavailable.

## Links

- Canonical contract: `src/mcp/prompts/server/instructions.md`
- Tool definitions: `src/mcp/types/tool-definitions/`
- Zod schemas: `src/mcp/tools/schemas/`
- Module overviews: `../modules/*/overview.md`
- Legacy bridge detail: `../../api/` (e.g. `../../api/codebase-index.md`)
- Operations: `../modules/codebase-index`
