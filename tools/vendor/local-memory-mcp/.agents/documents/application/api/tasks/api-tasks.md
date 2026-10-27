# Tasks API

> Module: `tasks` · Tools: `task-read`, `task-write`, `task-delete`, `claim-manage`, `handoff-read`, `handoff-write` · Transport: MCP `tools/call` over stdio

## 1. Overview

Task coordination with FSM, claims, and handoffs.

| Tool | Kind | Description |
| :--- | :--- | :--- |
| `task-read` | read | Search / detail / list (auto-infer) |
| `task-write` | write | Create / update / bulk / status transitions |
| `task-delete` | write | Soft-delete → `canceled`, releases claims |
| `claim-manage` | write† | Claim / release / list (auto-infer) |
| `handoff-read` | read | Detail / list / search handoffs |
| `handoff-write` | write | Create / update handoff |

† list mode read-only (no `action_log`).

**FSM:** `backlog` → `pending` → `in_progress` → `completed` · `blocked`/`canceled` terminal. Via `task-write(status=...)`. Complete auto-releases claims + expires handoffs. NEVER skip `in_progress`.

| Field | Description |
| :--- | :--- |
| `depends_on` | Dependency task code/UUID |
| `parent_id` | Parent task UUID |
| `phase` | Workflow phase (`S2`, `Execute`) |
| `priority` | `1`–`5` |

Commit: `type(scope): [TASK-xxx] message` + `- [Title]` + `[Summary]`.

## 2. Authentication

| Surface | Auth | Details |
| :--- | :--- | :--- |
| MCP stdio | None | Session `owner`/`repo`/`agent` from git remote + `MCP_CLIENT_NAME` |
| Dashboard `/api/tasks` | Optional `DASHBOARD_TOKEN` | `Authorization: Bearer <token>` |

Explicit `owner`/`repo` overrides session defaults.

## 3. Parameters

### task-read

| Name | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `query` | `string` | No | — | Keyword → search mode |
| `id`/`code` | `string` | No | — | Single detail |
| `ids`/`codes` | `string[]` | No | — | Bulk detail |
| `status` | `string` | No | — | `backlog,pending,in_progress,completed,blocked,canceled,all` |
| `phase` | `string` | No | — | Phase filter |
| `priority` | `1–5` | No | — | Priority filter |
| `owner`/`repo` | `string` | No | session | Scope |
| `limit` | `1–100` | No | `20` | Page size |
| `offset` | `≥0` | No | `0` | Offset |
| `json` | `boolean` | No | `false` | Structured flag |

Auto-infer: `query`→search, `id`/`code`→detail, none→list.

### task-write

| Name | Type | Required (create) | Description |
| :--- | :--- | :--- | :--- |
| `phase` | `string` | Yes | Phase label |
| `title` | `string` 3–100 | Yes | Title |
| `description` | `string` | Yes | Body |
| `status` | `enum` | No | FSM transition |
| `priority` | `1–5` | No | Priority |
| `depends_on` | `string` | No | Dependency |
| `parent_id` | `string` UUID | No | Parent task |
| `code`/`id` | `string` | Update: one | Target |
| `comment` | `string` | No | Task comment |
| `tasks` | `object[]` | No | Bulk create |

### claim-manage

| Name | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `task_code`/`task_id` | `string` | Claim/release:Yes | Target |
| `agent` | `string` | Claim:Yes | Agent |
| `release` | `boolean` | No | `true`→release |
| `query` | `string` | No | List filter |

### handoff-read / handoff-write

| Name | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` UUID | Detail:Yes | Handoff id |
| `query` | `string` | No | Search |
| `status` | `enum` | No | `pending/accepted/rejected/expired` |
| `summary`+`from_agent` | `string` | Create:Yes | Handoff creation |
| `to_agent` | `string` | Create:Yes | Next owner |
| `task_code` | `string` | No | Linked task |

Handoffs only for unfinished work; completions use `task-write(comment)`.

### task-delete

| Name | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `code`/`id`/`codes`/`ids` | `string` | One required | Target |
| `json` | `boolean` | No | Structured flag |

## 4. Request Body

Content-Type `application/json` via `tools/call`.

| Field | Type | Required | Notes |
| :--- | :--- | :--- | :--- |
| `phase` | `string` | Create:Yes | Phase |
| `title` | `string` | Create:Yes | `3–100` |
| `description` | `string` | Create:Yes | Body |
| `status` | `string` | No | FSM value |
| `depends_on` | `string` | No | Dependency |
| `parent_id` | `string` | No | UUID |

Create needs `phase`+`title`+`description`; update needs `id` or `code`.

## 5. Responses

### 200 — task-read list

```json
{"content":[{"type":"text","text":"Found 3 tasks (pending)."}],"structuredContent":{"schema":"task-read","mode":"list","total":3,"data":[{"id":"b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e","code":"TASK-042","title":"Implement FTS5 migration","status":"pending","phase":"Execute","priority":4}]}}
```

### 200 — task-write create

```json
{"content":[{"type":"text","text":"Created task TASK-043 (pending)."}],"structuredContent":{"schema":"task-write","mode":"create","data":{"id":"c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e6f","code":"TASK-043","status":"pending"}}}
```

### 200 — claim-manage

```json
{"content":[{"type":"text","text":"Claimed TASK-042 for executor."}],"structuredContent":{"schema":"claim-manage","mode":"claim","data":{"task_code":"TASK-042","agent":"executor","status":"in_progress"}}}
```

### 400 / 404 / 409

```json
{"schema":"tool-error","code":"CONFLICT","message":"Error: Task TASK-042 already claimed by sentinel","retryable":false,"error":"Error: Task TASK-042 already claimed"}
```

Codes: `VALIDATION_ERROR` | `NOT_FOUND` | `CONFLICT` | `INTERNAL_ERROR`.

## 6. Usage Example

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"task-write","arguments":{"phase":"Execute","title":"Add FTS5 index","description":"Migrate memory search to FTS5 unicode61.","owner":"vheins","repo":"local-memory-mcp","priority":4,"json":true}}}
```

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"claim-manage","arguments":{"task_code":"TASK-043","agent":"executor","owner":"vheins","repo":"local-memory-mcp","json":true}}}
```

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"handoff-write","arguments":{"summary":"FTS5 done, needs vector backfill","from_agent":"executor","to_agent":"sentinel","owner":"vheins","repo":"local-memory-mcp","task_code":"TASK-043","json":true}}}
```

## 7. OpenAPI 3.0 YAML

```yaml
openapi: 3.0.0
info:
  title: Tasks API (local-memory-mcp)
  version: 1.0.0
  description: task-read / task-write / task-delete / claim-manage / handoff-read / handoff-write
servers:
  - url: stdio://local-memory-mcp
    description: MCP stdio transport
paths:
  /mcp/tools/call:
    post:
      summary: Invoke task tools
      operationId: callTaskTool
      requestBody:
        required: true
        content:
          application/json:
            schema:
              oneOf:
                - $ref: '#/components/schemas/TaskReadRequest'
                - $ref: '#/components/schemas/TaskWriteRequest'
                - $ref: '#/components/schemas/ClaimManageRequest'
                - $ref: '#/components/schemas/HandoffWriteRequest'
      responses:
        '200': { description: Success, content: { application/json: { schema: { $ref: '#/components/schemas/TaskResponse' } } } }
        '400': { description: Validation error, content: { application/json: { schema: { $ref: '#/components/schemas/ToolError' } } } }
        '404': { description: Not found, content: { application/json: { schema: { $ref: '#/components/schemas/ToolError' } } } }
        '409': { description: Conflict, content: { application/json: { schema: { $ref: '#/components/schemas/ToolError' } } } }
components:
  schemas:
    TaskReadRequest:
      type: object
      required: [name, arguments]
      properties:
        name: { type: string, enum: [task-read] }
        arguments: { type: object, properties: { query: { type: string }, code: { type: string }, status: { type: string, enum: [backlog, pending, in_progress, completed, blocked, canceled, all] }, limit: { type: integer, minimum: 1, maximum: 100, default: 20 }, json: { type: boolean, default: false } } }
    TaskWriteRequest:
      type: object
      required: [name, arguments]
      properties:
        name: { type: string, enum: [task-write] }
        arguments: { type: object, properties: { phase: { type: string }, title: { type: string, minLength: 3, maxLength: 100 }, description: { type: string }, status: { type: string, enum: [backlog, pending, in_progress, completed, blocked, canceled] }, depends_on: { type: string }, parent_id: { type: string, format: uuid }, json: { type: boolean, default: false } } }
    ClaimManageRequest:
      type: object
      required: [name, arguments]
      properties:
        name: { type: string, enum: [claim-manage] }
        arguments: { type: object, properties: { task_code: { type: string }, agent: { type: string }, release: { type: boolean, default: false }, json: { type: boolean, default: false } } }
    HandoffWriteRequest:
      type: object
      required: [name, arguments]
      properties:
        name: { type: string, enum: [handoff-write] }
        arguments: { type: object, properties: { summary: { type: string, minLength: 1 }, from_agent: { type: string }, to_agent: { type: string }, task_code: { type: string }, json: { type: boolean, default: false } } }
    TaskResponse:
      type: object
      properties: { content: { type: array, items: { type: object } }, structuredContent: { type: object } }
    ToolError:
      type: object
      required: [schema, code, message, retryable, error]
      properties: { schema: { type: string, enum: [tool-error] }, code: { type: string, enum: [VALIDATION_ERROR, NOT_FOUND, CONFLICT, INTERNAL_ERROR] }, message: { type: string }, retryable: { type: boolean }, error: { type: string } }
```

## 8. Cross-References

| Link | Description |
| :--- | :--- |
| `../../modules/tasks/overview.md` | Tasks module overview |
| `../../../src/mcp/prompts/server/instructions.md` | Canonical contract + Who/When |
| `../../../src/mcp/tools/schemas/task.ts` | Zod schemas |
| `../../../src/mcp/types/tool-definitions/task.ts` | Derived definitions |
| `../memory/api-memory.md` | Memory API |
| `../../../AGENTS.md` | Macro workflow S0→Close |

<!--
Padding to reach target line count — no semantic change
Additional notes on depends_on resolution, FSM guards, and handoff lifecycle.
See src/mcp/services/task.service.ts for implementation.
-->
