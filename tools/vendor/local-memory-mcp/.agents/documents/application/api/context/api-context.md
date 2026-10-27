# Context API

> Module: `context` · Tools: `agent-context`, `synthesize`, `repo-summarize`, `observation-read`, `observation-write` · Transport: MCP `tools/call` over stdio

## 1. Overview

Context compilation and observation persistence.

| Tool                | Kind  | Description                                                       |
| :------------------ | :---- | :---------------------------------------------------------------- |
| `agent-context`     | read  | Budgeted cross-source context compiler (7 sources)                |
| `synthesize`        | read  | Composite synthesis via MCP sampling (requires client capability) |
| `repo-summarize`    | write | Archive session signals as `task_archive` (importance=3)          |
| `observation-read`  | read  | List/detail exploration observations                              |
| `observation-write` | write | Create/update/bulk/refresh observations with fingerprints         |

`agent-context` compiles from: `memories`, `decisions`, `tasks`, `handoffs`, `standards`, `observations`, `code`. Ranked by priority + lexical overlap with `objective`; packed until `budget.tokens` (256–20k, default 2000) or `budget.max_items` (1–100, default 20) hit. Overflow in `exclusions` (`token_budget`/`item_budget`/`below_relevance`). `budget.code_depth` 0–5 graph expansion from `current_file_path`.

## 2. Authentication

| Surface   | Auth                       | Details                                                                          |
| :-------- | :------------------------- | :------------------------------------------------------------------------------- |
| MCP stdio | None                       | Session `owner`/`repo`/`agent` from git remote + `MCP_CLIENT_NAME` / `MCP_MODEL` |
| Dashboard | Optional `DASHBOARD_TOKEN` | `Authorization: Bearer <token>`                                                  |

`synthesize` filtered when client lacks sampling capability (`CAPABILITY_UNAVAILABLE`). `MCP_RUNTIME_PROFILE` affects semantic/index availability.

## 3. Parameters

### agent-context

| Name                   | Type                | Required | Default | Description                                                                                                          |
| :--------------------- | :------------------ | :------- | :------ | :------------------------------------------------------------------------------------------------------------------- |
| `query` / `objective`  | `string`            | No       | —       | Ranking objective (alias)                                                                                            |
| `task_code`            | `string`            | No       | —       | Pin task as critical                                                                                                 |
| `current_file_path`    | `string`            | No       | —       | Code pointer for graph expansion                                                                                     |
| `sources`              | `string[]`          | No       | all 7   | Subset of sources to include                                                                                         |
| `type_filter`          | `enum`              | No       | —       | Memory type filter                                                                                                   |
| `budget.tokens`        | `integer` 256–20000 | No       | `2000`  | Token budget                                                                                                         |
| `budget.max_items`     | `integer` 1–100     | No       | `20`    | Item cap                                                                                                             |
| `budget.code_depth`    | `integer` 0–5       | No       | `1`     | Code graph depth                                                                                                     |
| `budget.min_relevance` | `number` 0–1        | No       | `0`     | Minimum lexical relevance a candidate must reach to be packed when an objective is set; critical/pinned items exempt |
| `include_stale`        | `boolean`           | No       | `false` | Include stale observations                                                                                           |
| `limit`                | `integer` 1–100     | No       | `5`     | Legacy projection cap                                                                                                |
| `owner` / `repo`       | `string`            | No       | session | Scope                                                                                                                |
| `json`                 | `boolean`           | No       | `false` | Structured flag                                                                                                      |

### synthesize

| Name                  | Type      | Required | Default | Description      |
| :-------------------- | :-------- | :------- | :------ | :--------------- |
| `query` / `objective` | `string`  | No       | —       | Synthesis prompt |
| `owner` / `repo`      | `string`  | No       | session | Scope            |
| `json`                | `boolean` | No       | `false` | Structured flag  |

Requires client sampling; otherwise `CAPABILITY_UNAVAILABLE`.

### repo-summarize

| Name             | Type                     | Required | Description                |
| :--------------- | :----------------------- | :------- | :------------------------- |
| `owner` / `repo` | `string`                 | Yes      | Scope                      |
| `signals`        | `string[]` 1–∞ ≤200 each | Yes      | Session signals to archive |
| `json`           | `boolean`                | No       | Structured flag            |

Creates `task_archive` memory (importance=3) from signals.

### observation-read

| Name               | Type          | Required | Default  | Description      |
| :----------------- | :------------ | :------- | :------- | :--------------- |
| `id`               | `string` UUID | No       | —        | Detail by UUID   |
| `subject`          | `string`      | No       | —        | Subject filter   |
| `task_id`          | `string`      | No       | —        | Task filter      |
| `file_path`        | `string`      | No       | —        | File filter      |
| `symbol_id`        | `string`      | No       | —        | Symbol filter    |
| `min_confidence`   | `number` 0–1  | No       | —        | Confidence floor |
| `include_stale`    | `boolean`     | No       | `false`  | Include stale    |
| `hydrate_evidence` | `boolean`     | No       | `false`  | Inline evidence  |
| `limit` / `offset` | `integer`     | No       | `20`/`0` | Pagination       |
| `owner` / `repo`   | `string`      | No       | session  | Scope            |

### observation-write

| Name           | Type             | Required   | Description                                                      |
| :------------- | :--------------- | :--------- | :--------------------------------------------------------------- |
| `subject`      | `string`         | Create:Yes | Subject                                                          |
| `fact`         | `string`         | Create:Yes | Fact body                                                        |
| `confidence`   | `number` 0–1     | Create:Yes | Confidence                                                       |
| `evidence`     | `object[]`       | Create:Yes | `[{file_path, symbol_id?, start_line?, end_line?, commit_sha?}]` |
| `id`           | `string` UUID    | Update:Yes | Target for update                                                |
| `observations` | `object[]` 1–100 | No         | Bulk create                                                      |
| `refresh_ids`  | `string[]` 1–100 | No         | Refresh fingerprints (idempotent)                                |

Repeated normalized `fact`+`evidence` deduped (idempotent).

## 4. Request Body

Content-Type: `application/json` via `tools/call`.

| Field                                    | Type       | Required                       | Schema                            |
| :--------------------------------------- | :--------- | :----------------------------- | :-------------------------------- |
| `objective`                              | `string`   | No                             | Ranking query                     |
| `signals`                                | `string[]` | `repo-summarize`:Yes           | `≤200` each                       |
| `subject`/`fact`/`confidence`/`evidence` | mixed      | `observation-write` create:Yes | See table above                   |
| `budget`                                 | `object`   | No                             | `{tokens, max_items, code_depth}` |

## 5. Responses

### 200 — agent-context

```json
{
	"content": [{ "type": "text", "text": "Compiled 12 items (1800 tokens) for \"FTS5 migration\"." }],
	"structuredContent": {
		"schema": "agent-context",
		"total": 12,
		"tokens": 1800,
		"data": [{ "source": "memories", "id": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", "title": "FTS5 unicode61" }],
		"exclusions": [{ "source": "code", "reason": "token_budget", "count": 3 }]
	}
}
```

### 200 — repo-summarize

```json
{
	"content": [{ "type": "text", "text": "Archived 3 signals as task_archive MEM-102." }],
	"structuredContent": {
		"schema": "repo-summarize",
		"data": { "id": "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e", "code": "MEM-102", "type": "task_archive" }
	}
}
```

### 200 — observation-read

```json
{
	"content": [{ "type": "text", "text": "Found 2 observations for subject \"auth\"." }],
	"structuredContent": {
		"schema": "observation-read",
		"total": 2,
		"data": [
			{
				"id": "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f",
				"subject": "auth",
				"fact": "JWT expiry is 1h",
				"confidence": 0.92
			}
		]
	}
}
```

### 400 / 409 / 500

```json
{
	"schema": "tool-error",
	"code": "CAPABILITY_UNAVAILABLE",
	"message": "Error: synthesize requires client sampling support",
	"retryable": false,
	"error": "Error: synthesize requires client sampling"
}
```

Codes: `VALIDATION_ERROR` | `CAPABILITY_UNAVAILABLE` | `INTERNAL_ERROR` | `NOT_FOUND`.

## 6. Usage Example

```json
{
	"jsonrpc": "2.0",
	"id": 1,
	"method": "tools/call",
	"params": {
		"name": "agent-context",
		"arguments": {
			"objective": "FTS5 migration task",
			"current_file_path": "src/mcp/storage/sqlite.ts",
			"budget": { "tokens": 2000, "max_items": 20, "code_depth": 1 },
			"owner": "vheins",
			"repo": "local-memory-mcp",
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
		"name": "repo-summarize",
		"arguments": {
			"owner": "vheins",
			"repo": "local-memory-mcp",
			"signals": ["Migrated to FTS5 unicode61", "Vector queue backfill complete"],
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
		"name": "observation-write",
		"arguments": {
			"subject": "auth",
			"fact": "JWT tokens expire after 1 hour with refresh via /auth/refresh",
			"confidence": 0.92,
			"evidence": [{ "file_path": "src/mcp/services/auth.ts", "start_line": 42, "end_line": 58 }],
			"owner": "vheins",
			"repo": "local-memory-mcp",
			"json": true
		}
	}
}
```

## 7. OpenAPI 3.0 YAML

```yaml
openapi: 3.0.0
info:
  title: Context API (local-memory-mcp)
  version: 1.0.0
  description: agent-context / synthesize / repo-summarize / observation-read / observation-write via MCP stdio
servers:
  - url: stdio://local-memory-mcp
    description: MCP stdio transport
paths:
  /mcp/tools/call:
    post:
      summary: Invoke context tools
      operationId: callContextTool
      requestBody:
        required: true
        content:
          application/json:
            schema:
              oneOf:
                - $ref: "#/components/schemas/AgentContextRequest"
                - $ref: "#/components/schemas/RepoSummarizeRequest"
                - $ref: "#/components/schemas/ObservationWriteRequest"
      responses:
        "200":
          {
            description: Success,
            content: { application/json: { schema: { $ref: "#/components/schemas/ContextResponse" } } }
          }
        "400":
          {
            description: Validation error,
            content: { application/json: { schema: { $ref: "#/components/schemas/ToolError" } } }
          }
        "500":
          {
            description: Internal error,
            content: { application/json: { schema: { $ref: "#/components/schemas/ToolError" } } }
          }
components:
  schemas:
    AgentContextRequest:
      type: object
      required: [name, arguments]
      properties:
        name: { type: string, enum: [agent-context] }
        arguments:
          type: object
          properties:
            objective: { type: string }
            query: { type: string }
            task_code: { type: string }
            current_file_path: { type: string }
            owner: { type: string }
            repo: { type: string }
            limit: { type: integer, minimum: 1, maximum: 100, default: 5 }
            json: { type: boolean, default: false }
    RepoSummarizeRequest:
      type: object
      required: [name, arguments]
      properties:
        name: { type: string, enum: [repo-summarize] }
        arguments:
          type: object
          required: [owner, repo, signals]
          properties:
            owner: { type: string }
            repo: { type: string }
            signals: { type: array, items: { type: string, maxLength: 200 }, minItems: 1 }
            json: { type: boolean, default: false }
    ObservationWriteRequest:
      type: object
      required: [name, arguments]
      properties:
        name: { type: string, enum: [observation-write] }
        arguments:
          type: object
          properties:
            subject: { type: string }
            fact: { type: string }
            confidence: { type: number, minimum: 0, maximum: 1 }
            evidence:
              {
                type: array,
                items:
                  {
                    type: object,
                    properties:
                      { file_path: { type: string }, start_line: { type: integer }, end_line: { type: integer } }
                  }
              }
            owner: { type: string }
            repo: { type: string }
            json: { type: boolean, default: false }
    ContextResponse:
      type: object
      properties:
        content: { type: array, items: { type: object } }
        structuredContent: { type: object }
    ToolError:
      type: object
      required: [schema, code, message, retryable, error]
      properties:
        schema: { type: string, enum: [tool-error] }
        code: { type: string, enum: [VALIDATION_ERROR, NOT_FOUND, CAPABILITY_UNAVAILABLE, INTERNAL_ERROR] }
        message: { type: string }
        retryable: { type: boolean }
        error: { type: string }
        details: { type: object }
```

## 8. Cross-References

| Link                                                        | Description               |
| :---------------------------------------------------------- | :------------------------ |
| `../../modules/context/overview.md`                         | Context module overview   |
| `../../../src/mcp/prompts/server/instructions.md`           | Canonical contract        |
| `../../../src/mcp/tools/schemas/agent.ts`                   | agent-context Zod         |
| `../../../src/mcp/tools/schemas/exploration-observation.ts` | Observation Zod           |
| `../../../src/mcp/types/tool-definitions/agent.ts`          | Derived definitions       |
| `../memory/api-memory.md`                                   | Memory API (task_archive) |
