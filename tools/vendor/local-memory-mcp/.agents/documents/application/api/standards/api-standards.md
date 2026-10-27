# Standards API

> Module: `standards` · Tools: `standard-read`, `standard-write`, `standard-delete` · Transport: MCP `tools/call` over stdio

## 1. Overview

Coding standards catalog — normative rules persisted per `(owner, repo)` with global visibility.

| Tool              | Kind  | Auto-infer Mode                                          | Description                             |
| :---------------- | :---- | :------------------------------------------------------- | :-------------------------------------- |
| `standard-read`   | read  | `query`→search, `id`/`code`→detail, none→list            | Hybrid search / detail / paginated list |
| `standard-write`  | write | `content`→create, `id`/`code`→update, `standards[]`→bulk | Create / update / bulk create           |
| `standard-delete` | write | `id`/`code`/`ids`/`codes`                                | Delete (single/bulk, UUID or code)      |

Standards are mandatory pre-implementation gate (S1 Hydrate): `standard-read(query)` before coding.

| Field                | Description                                                 |
| :------------------- | :---------------------------------------------------------- |
| `is_global`          | `true` → `((owner=? AND repo=?) OR is_global=1)` visibility |
| `tags`               | Required on create, e.g. `["typescript","a11y"]`            |
| `language` / `stack` | Optional filters (`typescript`, `svelte`)                   |
| `version`            | Optional version string                                     |

Global standards (`STD-001`, `STD-002`) use `is_global=1` with `repo` set; repo-specific set `is_global=false`.

## 2. Authentication

| Surface   | Auth                       | Details                                                            |
| :-------- | :------------------------- | :----------------------------------------------------------------- |
| MCP stdio | None                       | Session `owner`/`repo`/`agent` from git remote + `MCP_CLIENT_NAME` |
| Dashboard | Optional `DASHBOARD_TOKEN` | `Authorization: Bearer <token>` if set                             |

Explicit `owner`/`repo` overrides session defaults.

## 3. Parameters

### standard-read

| Name             | Type            | Required | Default | Description                                                    |
| :--------------- | :-------------- | :------- | :------ | :------------------------------------------------------------- |
| `query`          | `string`        | No       | —       | Free-text search with inline `key:value` tags (`language:php`) |
| `id` / `code`    | `string`        | No       | —       | Single detail (UUID or code ≤20)                               |
| `ids` / `codes`  | `string[]`      | No       | —       | Bulk detail                                                    |
| `owner` / `repo` | `string`        | No       | session | Scope                                                          |
| `language`       | `string`        | No       | —       | Filter by language                                             |
| `stack`          | `string[]`      | No       | —       | Filter by stack                                                |
| `tags`           | `string[]`      | No       | —       | Tag filter                                                     |
| `is_global`      | `boolean`       | No       | —       | Global filter                                                  |
| `limit`          | `integer` 1–100 | No       | `20`    | Page size                                                      |
| `offset`         | `integer` ≥0    | No       | `0`     | Offset                                                         |
| `context`        | `string`        | No       | —       | Context hint                                                   |
| `json`           | `boolean`       | No       | `false` | Structured flag                                                |

Auto-infer: `query`→search, `id`/`code`→detail, none→list.

### standard-write

| Name             | Type           | Required (create) | Description           |
| :--------------- | :------------- | :---------------- | :-------------------- |
| `name`           | `string` 3–255 | Yes               | Standard name         |
| `content`        | `string` ≥10   | Yes               | Rule body (normative) |
| `tags`           | `string[]` ≥1  | Yes               | Tags                  |
| `metadata`       | `object`       | Yes               | Arbitrary JSON        |
| `owner` / `repo` | `string`       | No                | Scope                 |
| `language`       | `string`       | No                | Language              |
| `stack`          | `string[]`     | No                | Stack                 |
| `is_global`      | `boolean`      | No                | Global flag           |
| `code` / `id`    | `string`       | Update: one       | Target for update     |
| `standards`      | `object[]`     | No                | Bulk create           |
| `json`           | `boolean`      | No                | Structured flag       |

### standard-delete

| Name                            | Type      | Required     | Description           |
| :------------------------------ | :-------- | :----------- | :-------------------- |
| `id` / `code` / `ids` / `codes` | `string`  | One required | Target (UUID or code) |
| `owner` / `repo`                | `string`  | No           | Scope                 |
| `json`                          | `boolean` | No           | Structured flag       |

## 4. Request Body

Content-Type: `application/json` via `tools/call`.

| Field       | Type      | Required   | Schema            |
| :---------- | :-------- | :--------- | :---------------- |
| `name`      | `string`  | Create:Yes | `3–255`           |
| `content`   | `string`  | Create:Yes | `≥10`             |
| `tags`      | `array`   | Create:Yes | `string[]` ≥1     |
| `metadata`  | `object`  | Create:Yes | JSON              |
| `language`  | `string`  | No         | e.g. `typescript` |
| `is_global` | `boolean` | No         | default `false`   |

Update requires `id` or `code` + fields to change.

## 5. Responses

### 200 — standard-read search

```json
{
	"content": [{ "type": "text", "text": "Found 2 standards for \"a11y focus\"." }],
	"structuredContent": {
		"schema": "standard-read",
		"mode": "search",
		"total": 2,
		"data": [
			{
				"id": "d1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a",
				"code": "STD-001",
				"name": "Arena layout manager-driven",
				"tags": ["a11y", "layout"],
				"is_global": true
			}
		]
	}
}
```

### 200 — standard-write create

```json
{
	"content": [{ "type": "text", "text": "Created standard STD-003 (typescript)." }],
	"structuredContent": {
		"schema": "standard-write",
		"mode": "create",
		"data": { "id": "e2f3a4b5-c6d7-4e8f-9a0b-1c2d3e4f5a6b", "code": "STD-003" }
	}
}
```

### 200 — standard-delete

```json
{
	"content": [{ "type": "text", "text": "Deleted 1 standard: STD-003." }],
	"structuredContent": { "schema": "standard-delete", "data": { "deleted": 1, "codes": ["STD-003"] } }
}
```

### 400 / 404

```json
{
	"schema": "tool-error",
	"code": "VALIDATION_ERROR",
	"message": "Error: name is required",
	"retryable": false,
	"error": "Error: name is required"
}
```

Codes: `VALIDATION_ERROR` | `NOT_FOUND` | `INTERNAL_ERROR`.

## 6. Usage Example

```json
{
	"jsonrpc": "2.0",
	"id": 1,
	"method": "tools/call",
	"params": {
		"name": "standard-read",
		"arguments": {
			"query": "a11y focus language:typescript",
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
		"name": "standard-write",
		"arguments": {
			"name": "No any type in public API",
			"content": "Public API signatures MUST NOT use any. Explicit params/returns required. Escape only via _ prefix for unused vars.",
			"tags": ["typescript", "typing"],
			"language": "typescript",
			"metadata": { "severity": "error" },
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
	"id": 3,
	"method": "tools/call",
	"params": {
		"name": "standard-delete",
		"arguments": { "code": "STD-003", "owner": "vheins", "repo": "local-memory-mcp", "json": true }
	}
}
```

## 7. OpenAPI 3.0 YAML

```yaml
openapi: 3.0.0
info:
  title: Standards API (local-memory-mcp)
  version: 1.0.0
  description: standard-read / standard-write / standard-delete via MCP stdio
servers:
  - url: stdio://local-memory-mcp
    description: MCP stdio transport
paths:
  /mcp/tools/call:
    post:
      summary: Invoke standard tools
      operationId: callStandardTool
      requestBody:
        required: true
        content:
          application/json:
            schema:
              oneOf:
                - $ref: "#/components/schemas/StandardReadRequest"
                - $ref: "#/components/schemas/StandardWriteRequest"
                - $ref: "#/components/schemas/StandardDeleteRequest"
      responses:
        "200":
          {
            description: Success,
            content: { application/json: { schema: { $ref: "#/components/schemas/StandardResponse" } } }
          }
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
components:
  schemas:
    StandardReadRequest:
      type: object
      required: [name, arguments]
      properties:
        name: { type: string, enum: [standard-read] }
        arguments:
          type: object
          properties:
            query: { type: string }
            id: { type: string }
            code: { type: string, maxLength: 20 }
            owner: { type: string }
            repo: { type: string }
            language: { type: string }
            limit: { type: integer, minimum: 1, maximum: 100, default: 20 }
            offset: { type: integer, minimum: 0, default: 0 }
            json: { type: boolean, default: false }
    StandardWriteRequest:
      type: object
      required: [name, arguments]
      properties:
        name: { type: string, enum: [standard-write] }
        arguments:
          type: object
          properties:
            name: { type: string, minLength: 3, maxLength: 255 }
            content: { type: string, minLength: 10 }
            tags: { type: array, items: { type: string }, minItems: 1 }
            metadata: { type: object }
            language: { type: string }
            is_global: { type: boolean, default: false }
            owner: { type: string }
            repo: { type: string }
            id: { type: string }
            code: { type: string, maxLength: 20 }
            json: { type: boolean, default: false }
    StandardDeleteRequest:
      type: object
      required: [name, arguments]
      properties:
        name: { type: string, enum: [standard-delete] }
        arguments:
          type: object
          properties:
            owner: { type: string }
            repo: { type: string }
            id: { type: string }
            code: { type: string, maxLength: 20 }
            json: { type: boolean, default: false }
    StandardResponse:
      type: object
      properties:
        content: { type: array, items: { type: object } }
        structuredContent: { type: object }
    ToolError:
      type: object
      required: [schema, code, message, retryable, error]
      properties:
        schema: { type: string, enum: [tool-error] }
        code: { type: string, enum: [VALIDATION_ERROR, NOT_FOUND, INTERNAL_ERROR] }
        message: { type: string }
        retryable: { type: boolean }
        error: { type: string }
        details: { type: object }
```

## 8. Cross-References

| Link                                                                            | Description                  |
| :------------------------------------------------------------------------------ | :--------------------------- |
| `../../modules/standards/overview.md`                                           | Standards module overview    |
| `../../../src/mcp/prompts/server/instructions.md`                               | Canonical contract + scoping |
| `../../../src/mcp/tools/schemas/standard.ts`                                    | Zod schemas                  |
| `../../../src/mcp/types/tool-definitions/standard.ts`                           | Derived definitions          |
| `../memory/api-memory.md`                                                       | Memory API                   |
| `../../design/decisions/ADR-008-global-vs-scoped-ownership-and-dashboard-repo-view.md` | Global vs scoped ADR         |
