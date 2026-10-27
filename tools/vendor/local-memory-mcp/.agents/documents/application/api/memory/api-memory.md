# Memory API

> Module: `memory` · Tools: `memory-read`, `memory-write`, `memory-delete` · Transport: MCP `tools/call` over stdio

## 1. Overview

The Memory module provides durable, scoped storage with hybrid search.

| Tool            | Kind  | Auto-infer Mode                                                            | Description                 |
| :-------------- | :---- | :------------------------------------------------------------------------- | :-------------------------- |
| `memory-read`   | read  | `query`→search, `id`/`code`→detail, none→recap                             | FTS5 + vector hybrid search |
| `memory-write`  | write | `content`→create, `id`/`code`→update, `acknowledge`→ack, `memories[]`→bulk | Create/update/acknowledge   |
| `memory-delete` | write | `id`/`code`/`ids`/`codes`                                                  | Soft-delete (archive)       |

Search scoring: FTS5 `unicode61` tokenizer with `*` prefix matching (40% lexical) + semantic vector cosine (30%) + recency (15%) + importance (15%). Embeddings offloaded to async queue — searchability window <1s after write (migration v9). Vectors use `Xenova/all-MiniLM-L6-v2` via `@xenova/transformers`.

| Field        | Values                                                        | Notes                                         |
| :----------- | :------------------------------------------------------------ | :-------------------------------------------- |
| `type`       | `code_fact`, `decision`, `mistake`, `pattern`, `task_archive` | Required on create                            |
| `importance` | `1`–`5`                                                       | 1=low, 5=critical                             |
| `scope`      | `{ owner, repo }`                                             | Data boundary, e.g. `vheins/local-memory-mcp` |
| `tags`       | `string[]`                                                    | Free-form, e.g. `["auth","jwt"]`              |
| `is_global`  | `boolean`                                                     | Cross-repo visibility                         |

Status: `active` | `archived`. Global reads use `((owner=? AND repo=?) OR is_global=1)`.

## 2. Authentication

| Surface                        | Auth                       | Details                                                |
| :----------------------------- | :------------------------- | :----------------------------------------------------- |
| MCP stdio                      | None                       | No Bearer. Session `owner`/`repo` from `git remote -v` |
| Dashboard REST `/api/memories` | Optional `DASHBOARD_TOKEN` | `Authorization: Bearer <token>`. Unset = open          |

Runtime `MCP_RUNTIME_PROFILE`: `minimal` (lexical only), `balanced` (on-demand), `full` (eager, default). Semantic degrades to lexical when unavailable.

## 3. Parameters

### memory-read

| Name               | Type            | Required | Default | Description                                                               |
| :----------------- | :-------------- | :------- | :------ | :------------------------------------------------------------------------ |
| `query`            | `string`        | No       | —       | Keyword search. Inline `key:value` tags extracted (`tag:a,b`, `lang:php`) |
| `id`               | `string` UUID   | No       | —       | Single detail lookup                                                      |
| `code`             | `string` ≤20    | No       | —       | Short code detail lookup                                                  |
| `ids` / `codes`    | `string[]`      | No       | —       | Bulk detail                                                               |
| `owner` / `repo`   | `string`        | No       | session | Scope override                                                            |
| `limit`            | `integer` 1–100 | No       | `5`     | Max results                                                               |
| `offset`           | `integer` ≥0    | No       | `0`     | Pagination                                                                |
| `include_archived` | `boolean`       | No       | `false` | Include archived                                                          |
| `json`             | `boolean`       | No       | `false` | Structured output                                                         |

Auto-infer: `query` present forces search; `id`/`code`/`ids`/`codes` forces detail; neither returns recap (stats + recent).

### memory-write

| Name          | Type                                | Required (create) | Description                                               |
| :------------ | :---------------------------------- | :---------------- | :-------------------------------------------------------- |
| `type`        | `enum`                              | Yes               | `code_fact`/`decision`/`mistake`/`pattern`/`task_archive` |
| `title`       | `string` 3–255                      | Yes               | Concise title                                             |
| `content`     | `string` ≥10                        | Yes               | Body                                                      |
| `importance`  | `integer` 1–5                       | Yes               | Priority                                                  |
| `scope`       | `{owner,repo}`                      | Yes               | Boundary                                                  |
| `tags`        | `string[]`                          | No                | Tags                                                      |
| `code` / `id` | `string`                            | No                | Identify target for update/ack                            |
| `acknowledge` | `used`/`irrelevant`/`contradictory` | No                | Mark consumed                                             |
| `memories`    | `object[]`                          | No                | Bulk items                                                |
| `ttlDays`     | `integer` ≥1                        | No                | TTL                                                       |
| `is_global`   | `boolean`                           | No                | Global flag                                               |

### memory-delete

| Name                            | Type      | Required     | Description           |
| :------------------------------ | :-------- | :----------- | :-------------------- |
| `owner` / `repo`                | `string`  | Yes          | Scope                 |
| `id` / `code` / `ids` / `codes` | `string`  | One required | Target (UUID or code) |
| `json`                          | `boolean` | No           | Structured flag       |

## 4. Request Body

Content-Type: `application/json` via `tools/call` (`params.name` + `params.arguments`).

| Field        | Type      | Required   | Schema                                                  |
| :----------- | :-------- | :--------- | :------------------------------------------------------ |
| `query`      | `string`  | No         | Search trigger                                          |
| `type`       | `string`  | Create:Yes | `enum[code_fact,decision,mistake,pattern,task_archive]` |
| `title`      | `string`  | Create:Yes | `3–255`                                                 |
| `content`    | `string`  | Create:Yes | `≥10`                                                   |
| `importance` | `integer` | Create:Yes | `1–5`                                                   |
| `scope`      | `object`  | Create:Yes | `{owner, repo}`                                         |
| `tags`       | `array`   | No         | `string[]`                                              |

Create requires `type` + `title` + `content` + `importance` + `scope`; update requires `id` or `code`.

## 5. Responses

### 200 — search

```json
{
	"content": [{ "type": "text", "text": "Found 2 memories for \"auth JWT\" (hybrid FTS5+vector)." }],
	"structuredContent": {
		"schema": "memory-read",
		"mode": "search",
		"total": 2,
		"data": [
			{
				"id": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
				"code": "MEM-042",
				"type": "code_fact",
				"title": "Auth uses JWT with 1h expiry",
				"importance": 4,
				"scope": { "owner": "vheins", "repo": "local-memory-mcp" },
				"score": 78.5
			}
		]
	}
}
```

### 200 — detail

```json
{
	"content": [{ "type": "text", "text": "Memory MEM-042 — Auth uses JWT with 1h expiry" }],
	"structuredContent": {
		"schema": "memory-read",
		"mode": "detail",
		"data": {
			"id": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
			"code": "MEM-042",
			"title": "Auth uses JWT with 1h expiry",
			"type": "code_fact",
			"importance": 4,
			"status": "active"
		}
	}
}
```

### 200 — write create

```json
{
	"content": [{ "type": "text", "text": "Created memory MEM-101 (code_fact)." }],
	"structuredContent": {
		"schema": "memory-write",
		"mode": "create",
		"data": { "id": "f3a9c1b2-4d5e-4f6a-9b0c-1d2e3f4a5b6c", "code": "MEM-101", "status": "active" }
	}
}
```

### 400 / 404 / 500

```json
{
	"schema": "tool-error",
	"code": "VALIDATION_ERROR",
	"message": "Error: type is required",
	"retryable": false,
	"error": "Error: type is required"
}
```

Codes: `VALIDATION_ERROR` | `NOT_FOUND` | `CONFLICT` | `INTERNAL_ERROR` | `CAPABILITY_UNAVAILABLE`.

## 6. Usage Example

```json
{
	"jsonrpc": "2.0",
	"id": 1,
	"method": "tools/call",
	"params": {
		"name": "memory-read",
		"arguments": {
			"query": "FTS5 unicode61 tag:search",
			"owner": "vheins",
			"repo": "local-memory-mcp",
			"limit": 5,
			"json": true
		}
	}
}
```

```json
{
	"jsonrpc": "2.0",
	"id": 2,
	"method": "tools/call",
	"params": {
		"name": "memory-write",
		"arguments": {
			"type": "code_fact",
			"title": "FTS5 unicode61 tokenizer for memory search",
			"content": "Memory search migrated to FTS5 with unicode61 tokenizer and prefix matching. Hybrid weights 40/30/15/15.",
			"importance": 4,
			"scope": { "owner": "vheins", "repo": "local-memory-mcp" },
			"tags": ["search", "fts5"],
			"json": true
		}
	}
}
```

```json
{
	"jsonrpc": "2.0",
	"id": 3,
	"method": "tools/call",
	"params": {
		"name": "memory-delete",
		"arguments": { "owner": "vheins", "repo": "local-memory-mcp", "code": "MEM-042", "json": true }
	}
}
```

## 7. OpenAPI 3.0 YAML

```yaml
openapi: 3.0.0
info:
  title: Memory API (local-memory-mcp)
  version: 1.0.0
  description: memory-read / memory-write / memory-delete via MCP stdio
servers:
  - url: stdio://local-memory-mcp
    description: MCP stdio transport
paths:
  /mcp/tools/call:
    post:
      summary: Invoke memory tools
      operationId: callMemoryTool
      requestBody:
        required: true
        content:
          application/json:
            schema:
              oneOf:
                - $ref: "#/components/schemas/MemoryReadRequest"
                - $ref: "#/components/schemas/MemoryWriteRequest"
                - $ref: "#/components/schemas/MemoryDeleteRequest"
      responses:
        "200":
          description: Success
          content:
            application/json:
              schema: { $ref: "#/components/schemas/MemoryResponse" }
        "400":
          {
            description: Validation error,
            content: { application/json: { schema: { $ref: "#/components/schemas/ToolError" } } }
          }
        "404":
          {
            description: Not found,
            content: { application/json: { schema: { $ref: "#/components/schemas/ToolError" } } }
          }
        "500":
          {
            description: Internal error,
            content: { application/json: { schema: { $ref: "#/components/schemas/ToolError" } } }
          }
components:
  schemas:
    MemoryReadRequest:
      type: object
      required: [name, arguments]
      properties:
        name: { type: string, enum: [memory-read] }
        arguments:
          type: object
          properties:
            query: { type: string }
            id: { type: string, format: uuid }
            code: { type: string, maxLength: 20 }
            owner: { type: string }
            repo: { type: string }
            limit: { type: integer, minimum: 1, maximum: 100, default: 5 }
            offset: { type: integer, minimum: 0, default: 0 }
            json: { type: boolean, default: false }
            include_archived: { type: boolean, default: false }
    MemoryWriteRequest:
      type: object
      required: [name, arguments]
      properties:
        name: { type: string, enum: [memory-write] }
        arguments:
          type: object
          properties:
            type: { type: string, enum: [code_fact, decision, mistake, pattern, task_archive] }
            title: { type: string, minLength: 3, maxLength: 255 }
            content: { type: string, minLength: 10 }
            importance: { type: integer, minimum: 1, maximum: 5 }
            scope: { type: object, properties: { owner: { type: string }, repo: { type: string } } }
            tags: { type: array, items: { type: string } }
            id: { type: string }
            code: { type: string, maxLength: 20 }
            acknowledge: { type: string, enum: [used, irrelevant, contradictory] }
            json: { type: boolean, default: false }
    MemoryDeleteRequest:
      type: object
      required: [name, arguments]
      properties:
        name: { type: string, enum: [memory-delete] }
        arguments:
          type: object
          required: [owner, repo]
          properties:
            owner: { type: string }
            repo: { type: string }
            id: { type: string }
            code: { type: string, maxLength: 20 }
            json: { type: boolean, default: false }
    MemoryResponse:
      type: object
      properties:
        content: { type: array, items: { type: object } }
        structuredContent: { type: object }
    ToolError:
      type: object
      required: [schema, code, message, retryable, error]
      properties:
        schema: { type: string, enum: [tool-error] }
        code: { type: string, enum: [VALIDATION_ERROR, NOT_FOUND, CONFLICT, INTERNAL_ERROR, CAPABILITY_UNAVAILABLE] }
        message: { type: string }
        retryable: { type: boolean }
        error: { type: string }
        details: { type: object }
```

## 8. Cross-References

| Link                                                                            | Description                      |
| :------------------------------------------------------------------------------ | :------------------------------- |
| `../../modules/memory/overview.md`                                              | Memory module overview           |
| `../../../src/mcp/prompts/server/instructions.md`                               | Canonical 20-tool contract       |
| `../../../src/mcp/tools/schemas/memory.ts`                                      | Zod source of truth              |
| `../../../src/mcp/types/tool-definitions/memory.ts`                             | Derived JSON Schema              |
| `../tasks/api-tasks.md`                                                         | Task API (task_archive memories) |
| `../context/api-context.md`                                                     | agent-context / synthesize       |
| `../../design/decisions/ADR-008-global-vs-scoped-ownership-and-dashboard-repo-view.md` | Scoping ADR                      |
