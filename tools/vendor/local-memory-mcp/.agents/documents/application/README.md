# Application

> Bridge to existing canonical docs — does not duplicate content.

Application surface of `local-memory-mcp`: 20 MCP tools, Svelte dashboard, and shared SQLite DB. See [Brief](../brief.md) for architecture overview and [AGENTS.md](../../../AGENTS.md) Documentation Map for audience routing.

## Structure

| Path                                       | Content                                                         |
| :----------------------------------------- | :-------------------------------------------------------------- |
| [modules/manifest.md](modules/manifest.md) | 6-module inventory with file paths                              |
| [modules/](modules/)                       | Per-module overviews (memory, tasks, codebase-index, dashboard) |
| [api/README.md](api/README.md)             | API contract bridge (20 tools + 32 prompts)                     |
| [testing/README.md](testing/README.md)     | Testing bridge to canonical standard                            |

## Legacy bridges

- Tool API detail → [.agents/documents/application/api/](api) (e.g. [codebase-index.md](api/codebase-index/api-codebase.md))
- Operations → [.agents/documents/application/modules/codebase-index/](modules/codebase-index)
- Design + ADRs → [.agents/documents/design/](../design/) + [design/decisions/](../design/decisions)
