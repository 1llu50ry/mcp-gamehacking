# Prompts API

> Module: `prompts` · Tool: `prompt-read` (20th tool) · Transport: MCP `tools/call` over stdio (alias for `prompts/list` + `prompts/get`)

## 1. Overview

`prompt-read` is a read-only alias/proxy for the protocol-level `prompts/*` surface (`prompts/list` + `prompts/get`). It mirrors the same catalog and content from `src/mcp/prompts/definitions/` so tool-only clients (e.g. OpenCode) can discover and invoke prompts as tools without `prompts/*` support.

| Tool          | Kind | Auto-infer Mode          | Description                                                 |
| :------------ | :--- | :----------------------- | :---------------------------------------------------------- |
| `prompt-read` | read | none→LIST, `name`→DETAIL | Prompt catalog / prompt content with `{{var}}` substitution |

It does NOT replace `prompts/*`; both surface the same files.

**Auto-infer:**

| Params         | Mode   | Result                                             |
| :------------- | :----- | :------------------------------------------------- |
| none           | LIST   | Catalog of `{name, description, agent, arguments}` |
| `name` present | DETAIL | Loads prompt with `{{var}}` substitution           |

**Allowlist:** Only prompts defined in `src/mcp/prompts/definitions/` are resolvable. Unknown or path-traversal names return `NOT_FOUND` error envelope (`schema:"tool-error"`, `code:"NOT_FOUND"`).

**Substitution:** Detail mode replaces `{{var}}` placeholders from `arguments` object. Reserved keys `{{current_repo}}` / `{{current_owner}}` are always auto-injected from session (never read from args). Extra args ignored.

## 2. Authentication

| Surface                                 | Auth | Details                                                                          |
| :-------------------------------------- | :--- | :------------------------------------------------------------------------------- |
| MCP stdio `tools/call`                  | None | No Bearer. Session `owner`/`repo` from git remote injected as `{{current_repo}}` |
| Protocol `prompts/list` + `prompts/get` | None | Same catalog, native MCP sampling path                                           |

No `owner`/`repo` params needed — prompt catalog is global, content injection uses session `current_repo`/`current_owner` automatically.

## 3. Parameters

### prompt-read LIST (catalog)

| Name     | Type      | Required | Default | Description                 |
| :------- | :-------- | :------- | :------ | :-------------------------- |
| _(none)_ | —         | —        | —       | No `name` → returns catalog |
| `json`   | `boolean` | No       | `false` | Return `structuredContent`  |

### prompt-read DETAIL (prompt content)

| Name        | Type      | Required | Default | Description                                                                        |
| :---------- | :-------- | :------- | :------ | :--------------------------------------------------------------------------------- |
| `name`      | `string`  | Yes      | —       | Prompt name (allowlist, e.g. `server-instructions`, `task-execute`)                |
| `arguments` | `object`  | No       | `{}`    | `{{var}}` substitution map (reserved `current_repo`/`current_owner` auto-injected) |
| `json`      | `boolean` | No       | `false` | Return `structuredContent` with `messages[]`                                       |

Reserved injection: `{{current_repo}}` = session repo (e.g. `local-memory-mcp`), `{{current_owner}}` = session owner (e.g. `vheins`). Never pass these in `arguments` — they are overwritten.

Error on unknown name:

```json
{
	"schema": "tool-error",
	"code": "NOT_FOUND",
	"message": "Error: Prompt 'unknown' not found",
	"retryable": false,
	"error": "Error: Prompt 'unknown' not found"
}
```

## 4. Request Body

Content-Type: `application/json` via `tools/call` (`params.name` + `params.arguments`).

| Field       | Type      | Required           | Schema                   | Description       |
| :---------- | :-------- | :----------------- | :----------------------- | :---------------- |
| `name`      | `string`  | LIST:No DETAIL:Yes | `minLength:1`, allowlist | Prompt identifier |
| `arguments` | `object`  | No                 | `Record<string,string>`  | Substitution vars |
| `json`      | `boolean` | No                 | default `false`          | Structured flag   |

LIST request body:

```json
{ "name": "prompt-read", "arguments": { "json": true } }
```

DETAIL request body:

```json
{
	"name": "prompt-read",
	"arguments": { "name": "server-instructions", "arguments": { "task_code": "TASK-042" }, "json": true }
}
```

## 5. Responses

### 200 — LIST (catalog)

```json
{
	"content": [{ "type": "text", "text": "Found 8 prompts." }],
	"structuredContent": {
		"schema": "prompt-read",
		"mode": "list",
		"total": 8,
		"data": [
			{
				"name": "server-instructions",
				"description": "Main instructions for the MCP server",
				"agent": "all",
				"arguments": []
			},
			{
				"name": "task-execute",
				"description": "Execute a task",
				"agent": "executor",
				"arguments": [{ "name": "task_code", "required": true }]
			}
		]
	}
}
```

### 200 — DETAIL (prompt content)

```json
{
	"content": [{ "type": "text", "text": "Prompt server-instructions loaded (repo: vheins/local-memory-mcp)." }],
	"structuredContent": {
		"schema": "prompt-read",
		"mode": "detail",
		"data": {
			"name": "server-instructions",
			"description": "Main instructions for the MCP server",
			"messages": [
				{
					"role": "user",
					"content": { "type": "text", "text": "Local Memory MCP — persistent memory ... repo: local-memory-mcp" }
				}
			]
		}
	}
}
```

`messages[].content.text` has `{{current_repo}}` already substituted.

### 404 — Not found

```json
{
	"schema": "tool-error",
	"code": "NOT_FOUND",
	"message": "Error: Prompt 'evil/../path' not found",
	"retryable": false,
	"error": "Error: Prompt 'evil/../path' not found"
}
```

### 400 — Validation error

```json
{
	"schema": "tool-error",
	"code": "VALIDATION_ERROR",
	"message": "Error: name must be a non-empty string",
	"retryable": false,
	"error": "Error: name must be a non-empty string"
}
```

Codes: `VALIDATION_ERROR` | `NOT_FOUND` | `INTERNAL_ERROR`.

## 6. Usage Example

```json
{
	"jsonrpc": "2.0",
	"id": 1,
	"method": "tools/call",
	"params": { "name": "prompt-read", "arguments": { "json": true } }
}
```

```json
{
	"jsonrpc": "2.0",
	"id": 2,
	"method": "tools/call",
	"params": { "name": "prompt-read", "arguments": { "name": "server-instructions", "json": true } }
}
```

Protocol equivalent:

```json
{ "jsonrpc": "2.0", "id": 3, "method": "prompts/list", "params": {} }
```

```json
{ "jsonrpc": "2.0", "id": 4, "method": "prompts/get", "params": { "name": "server-instructions", "arguments": {} } }
```

Substitution example — prompt template `Task {{task_code}} for {{current_repo}}` with `arguments: {task_code:"TASK-042"}` resolves to `Task TASK-042 for local-memory-mcp` (owner `vheins`).

## 7. OpenAPI 3.0 YAML

```yaml
openapi: 3.0.0
info:
  title: Prompts API (local-memory-mcp)
  version: 1.0.0
  description: prompt-read (20th tool) via MCP stdio — alias for prompts/list + prompts/get
servers:
  - url: stdio://local-memory-mcp
    description: MCP stdio transport
paths:
  /mcp/tools/call:
    post:
      summary: Invoke prompt-read
      operationId: callPromptRead
      requestBody:
        required: true
        content:
          application/json:
            schema:
              oneOf:
                - $ref: "#/components/schemas/PromptReadListRequest"
                - $ref: "#/components/schemas/PromptReadDetailRequest"
      responses:
        "200":
          {
            description: Success,
            content: { application/json: { schema: { $ref: "#/components/schemas/PromptResponse" } } }
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
  /mcp/prompts/list:
    post:
      summary: Protocol prompts/list (native)
      operationId: promptsList
      responses:
        "200":
          {
            description: Catalog,
            content: { application/json: { schema: { $ref: "#/components/schemas/PromptResponse" } } }
          }
  /mcp/prompts/get:
    post:
      summary: Protocol prompts/get (native)
      operationId: promptsGet
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/PromptsGetRequest" }
      responses:
        "200":
          {
            description: Prompt content,
            content: { application/json: { schema: { $ref: "#/components/schemas/PromptResponse" } } }
          }
components:
  schemas:
    PromptReadListRequest:
      type: object
      required: [name, arguments]
      properties:
        name: { type: string, enum: [prompt-read] }
        arguments:
          type: object
          properties:
            json: { type: boolean, default: false }
    PromptReadDetailRequest:
      type: object
      required: [name, arguments]
      properties:
        name: { type: string, enum: [prompt-read] }
        arguments:
          type: object
          required: [name]
          properties:
            name: { type: string, minLength: 1, description: Allowlisted prompt name }
            arguments: { type: object, additionalProperties: { type: string } }
            json: { type: boolean, default: false }
    PromptsGetRequest:
      type: object
      required: [name]
      properties:
        name: { type: string }
        arguments: { type: object, additionalProperties: { type: string } }
    PromptResponse:
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

| Link                                                | Description                                |
| :-------------------------------------------------- | :----------------------------------------- |
| `../../../src/mcp/prompts/server/instructions.md`   | Canonical 20-tool contract (prompt-read §) |
| `../../../src/mcp/prompts/definitions/`             | Prompt source files (allowlist)            |
| `../../../src/mcp/types/tool-definitions/prompt.ts` | Derived JSON Schema                        |
| `../../../src/mcp/tools/schemas/prompt.ts`          | Zod schema                                 |
| `../memory/api-memory.md`                           | Memory API                                 |
| `../tasks/api-tasks.md`                             | Tasks API                                  |
