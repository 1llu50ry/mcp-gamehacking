# Tasks Module

> Task orchestration with FSM + claims/handoffs (scoped by `owner/repo`).

## FSM

States: `backlog` → `pending` → `in_progress` → `completed` · `canceled`/`blocked`. Transitions via `task-write(status)`; `completed` auto-releases claims + expires handoffs. Phases, priority (1–5), dependencies, comments, `suggested_skills`.

## Tools (4)

| Tool           | Mode (auto-infer)                                                                         | File                            |
| :------------- | :---------------------------------------------------------------------------------------- | :------------------------------ |
| `task-read`    | `query`→SEARCH · `id/code`→DETAIL · none→LIST                                             | `src/mcp/tools/task.read.ts`    |
| `task-write`   | `phase+title+desc`→create · `id/code`→update · `tasks[]`→bulk · `interactive:true`→elicit | `src/mcp/tools/task.write.ts`   |
| `task-delete`  | soft-delete → `canceled`, releases claims/handoffs                                        | `src/mcp/tools/task.delete.ts`  |
| `claim-manage` | `task_code+agent`→claim · `release:true`→release · `query`→list                           | `src/mcp/tools/claim.manage.ts` |

Handoffs via `handoff-read/write` for unfinished cross-agent work (`to_agent`, `task_code`). Contract: `src/mcp/prompts/server/instructions.md` · Tool defs: `src/mcp/types/tool-definitions/task.ts` + `handoff.ts`.
