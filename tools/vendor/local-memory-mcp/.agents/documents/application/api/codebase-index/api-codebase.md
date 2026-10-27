# Codebase Index API

> Module: `codebase-index` · Tools: `codebase-index`, `codebase-read` · Transport: MCP `tools/call` over stdio

## 1. Overview

Tree-sitter + WASM index for codebase exploration. Mandatory first tool for ALL codebase context discovery.

| Tool             | Kind  | Auto-infer Mode                                                                          | Description                            |
| :--------------- | :---- | :--------------------------------------------------------------------------------------- | :------------------------------------- |
| `codebase-index` | write | `repo` alone→status, `repoPath`+`repo`→index, `warmup:true`→warmup                       | Freshness/count + tree-sitter scan     |
| `codebase-read`  | read  | `query`→search, `name`→trace, `filePath`→file symbols, `content`→grep, none→architecture | Symbol/NL search, trace, file, content |

`codebase-read` modes (auto-infer from params):

| Mode           | Trigger                   | Description                          |
| :------------- | :------------------------ | :----------------------------------- |
| `search`       | `query` with spaces or NL | Symbol + NL search (hybrid)          |
| `symbol`       | `query` single term       | Symbol name search                   |
| `trace`        | `name` without `query`    | Definition + cross-file usages       |
| `file`         | `filePath`                | Symbols in file                      |
| `content`      | `content` (regex)         | Grep indexed file contents           |
| `architecture` | none of above             | Repo tree + stats; `depth` only here |

`depth` param applies ONLY inside architecture mode (1–5, default 1).

Priority (STRICT): `codebase-index` status check → if stale trigger index → `codebase-read`. Forbidden as first resort: `rg`/`grep`/`glob`/`cat` brute-force — only via `explore` sub-agent after index cannot answer.

## 2. Authentication

| Surface                     | Auth                       | Details                                                          |
| :-------------------------- | :------------------------- | :--------------------------------------------------------------- |
| MCP stdio                   | None                       | Session `repo` from basename; `owner` not used (repo-keyed only) |
| Dashboard `/api/codebase/*` | Optional `DASHBOARD_TOKEN` | `Authorization: Bearer <token>`                                  |

Codebase index is repo-keyed only (no `owner` column) — per ADR-008 out-of-scope for owner isolation. Env: `CODEBASE_AUTO_INDEX`, `CODEBASE_INDEX_WORKERS=4`, `CODEBASE_INDEX_PARSE_TIMEOUT_MS=10000`.

## 3. Parameters

### codebase-index

| Name           | Type       | Required | Default | Description                         |
| :------------- | :--------- | :------- | :------ | :---------------------------------- |
| `repo`         | `string`   | Yes      | —       | Repo name (e.g. `local-memory-mcp`) |
| `repoPath`     | `string`   | No       | —       | Absolute path → triggers index scan |
| `owner`        | `string`   | No       | —       | Ignored (repo-keyed)                |
| `force`        | `boolean`  | No       | `false` | Force re-index even if fresh        |
| `warmup`       | `boolean`  | No       | `false` | Warm engine without scan            |
| `includeGlobs` | `string[]` | No       | —       | Include patterns                    |
| `excludeGlobs` | `string[]` | No       | —       | Exclude patterns                    |

Auto-infer: `repo` alone → status; `repoPath`+`repo` → index; `warmup:true` → warmup.

### codebase-read

| Name             | Type                  | Required | Default | Description                                                                                |
| :--------------- | :-------------------- | :------- | :------ | :----------------------------------------------------------------------------------------- |
| `query`          | `string`              | No       | —       | Search query. Inline `key:value` tags (`kind:function`, `language:php`, `file:src/foo.ts`) |
| `name`           | `string`              | No       | —       | Symbol trace (definition + usages)                                                         |
| `filePath`       | `string`              | No       | —       | File symbols                                                                               |
| `content`        | `string`              | No       | —       | Regex grep over indexed contents (max 200 chars, ReDoS guard)                              |
| `depth`          | `integer` 1–5         | No       | `1`     | Architecture depth (only in architecture mode)                                             |
| `repo` / `repos` | `string` / `string[]` | No       | session | Scope (repo-keyed)                                                                         |
| `owner`          | `string`              | No       | `""`    | Ignored                                                                                    |
| `kind`           | `string`/`string[]`   | No       | —       | Filter: `function`, `class`, `interface`, etc.                                             |
| `language`       | `string`              | No       | —       | Language filter                                                                            |
| `limit`          | `integer` 1–200       | No       | `20`    | Max results                                                                                |
| `offset`         | `integer` ≥0          | No       | `0`     | Offset                                                                                     |
| `regex`          | `boolean`             | No       | `false` | Regex mode for query                                                                       |
| `json`           | `boolean`             | No       | `false` | Structured flag                                                                            |

## 4. Request Body

Content-Type: `application/json` via `tools/call`.

| Field      | Type      | Required             | Schema            |
| :--------- | :-------- | :------------------- | :---------------- |
| `repo`     | `string`  | `codebase-index`:Yes | `minLength:1`     |
| `repoPath` | `string`  | No                   | Absolute path     |
| `query`    | `string`  | No                   | Search text       |
| `name`     | `string`  | No                   | Symbol name       |
| `filePath` | `string`  | No                   | Relative path     |
| `content`  | `string`  | No                   | Regex ≤200 chars  |
| `depth`    | `integer` | No                   | `1–5` (arch only) |

Architecture mode: no `query`/`name`/`filePath`/`content` present.

## 5. Responses

### 200 — codebase-index status

```json
{
	"content": [{ "type": "text", "text": "Index fresh (2h ago), 1243 files, 8420 symbols." }],
	"structuredContent": {
		"schema": "codebase-index",
		"mode": "status",
		"data": {
			"repo": "local-memory-mcp",
			"fresh": true,
			"file_count": 1243,
			"symbol_count": 8420,
			"indexed_at": "2026-05-12T08:00:00Z",
			"capability": "ready"
		}
	}
}
```

### 200 — codebase-read search

```json
{
	"content": [{ "type": "text", "text": "Found 5 symbols for \"memory search\"." }],
	"structuredContent": {
		"schema": "codebase-read",
		"mode": "search",
		"total": 5,
		"data": [
			{
				"name": "MemoryService",
				"kind": "class",
				"filePath": "src/mcp/services/memory.service.ts",
				"language": "typescript",
				"line": 42
			}
		]
	}
}
```

### 200 — codebase-read trace

```json
{
	"content": [
		{ "type": "text", "text": "Symbol MemoryService defined at src/mcp/services/memory.service.ts:42, 3 references." }
	],
	"structuredContent": {
		"schema": "codebase-read",
		"mode": "trace",
		"data": {
			"definition": { "name": "MemoryService", "filePath": "src/mcp/services/memory.service.ts", "line": 42 },
			"references": [{ "filePath": "src/mcp/tools/memory.read.ts", "line": 18 }]
		}
	}
}
```

### 400 / 404

```json
{
	"schema": "tool-error",
	"code": "VALIDATION_ERROR",
	"message": "Error: repo is required",
	"retryable": false,
	"error": "Error: repo is required"
}
```

Codes: `VALIDATION_ERROR` | `NOT_FOUND` | `CAPABILITY_UNAVAILABLE` | `INTERNAL_ERROR`.

## 6. Usage Example

```json
{
	"jsonrpc": "2.0",
	"id": 1,
	"method": "tools/call",
	"params": { "name": "codebase-index", "arguments": { "repo": "local-memory-mcp", "json": true } }
}
```

```json
{
	"jsonrpc": "2.0",
	"id": 2,
	"method": "tools/call",
	"params": {
		"name": "codebase-index",
		"arguments": { "repo": "local-memory-mcp", "repoPath": "/home/vheins/workspace/local-memory-mcp", "json": true }
	}
}
```

```json
{
	"jsonrpc": "2.0",
	"id": 3,
	"method": "tools/call",
	"params": {
		"name": "codebase-read",
		"arguments": { "query": "memory search kind:class", "repo": "local-memory-mcp", "limit": 10, "json": true }
	}
}
```

```json
{
	"jsonrpc": "2.0",
	"id": 4,
	"method": "tools/call",
	"params": {
		"name": "codebase-read",
		"arguments": { "name": "MemoryService", "repo": "local-memory-mcp", "json": true }
	}
}
```

```json
{
	"jsonrpc": "2.0",
	"id": 5,
	"method": "tools/call",
	"params": { "name": "codebase-read", "arguments": { "repo": "local-memory-mcp", "depth": 2, "json": true } }
}
```

## 7. OpenAPI 3.0 YAML

```yaml
openapi: 3.0.0
info:
  title: Codebase Index API (local-memory-mcp)
  version: 1.0.0
  description: codebase-index / codebase-read via MCP stdio (tree-sitter WASM)
servers:
  - url: stdio://local-memory-mcp
    description: MCP stdio transport
paths:
  /mcp/tools/call:
    post:
      summary: Invoke codebase tools
      operationId: callCodebaseTool
      requestBody:
        required: true
        content:
          application/json:
            schema:
              oneOf:
                - $ref: "#/components/schemas/CodebaseIndexRequest"
                - $ref: "#/components/schemas/CodebaseReadRequest"
      responses:
        "200":
          {
            description: Success,
            content: { application/json: { schema: { $ref: "#/components/schemas/CodebaseResponse" } } }
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
    CodebaseIndexRequest:
      type: object
      required: [name, arguments]
      properties:
        name: { type: string, enum: [codebase-index] }
        arguments:
          type: object
          required: [repo]
          properties:
            repo: { type: string, minLength: 1 }
            repoPath: { type: string }
            force: { type: boolean, default: false }
            json: { type: boolean, default: false }
    CodebaseReadRequest:
      type: object
      required: [name, arguments]
      properties:
        name: { type: string, enum: [codebase-read] }
        arguments:
          type: object
          properties:
            query: { type: string }
            name: { type: string }
            filePath: { type: string }
            content: { type: string, maxLength: 200 }
            depth: { type: integer, minimum: 1, maximum: 5, default: 1 }
            repo: { type: string }
            limit: { type: integer, minimum: 1, maximum: 200, default: 20 }
            offset: { type: integer, minimum: 0, default: 0 }
            json: { type: boolean, default: false }
    CodebaseResponse:
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

| Link                                                        | Description                          |
| :---------------------------------------------------------- | :----------------------------------- |
| `../../modules/codebase-index/overview.md`                  | Codebase module overview             |
| `../../../src/mcp/prompts/server/instructions.md`           | Canonical contract (strict priority) |
| `../../../src/mcp/tools/schemas/codebase.ts`                | Zod schemas                          |
| `../../../src/mcp/types/tool-definitions/codebase-index.ts` | Derived definitions                  |
| `../../../src/mcp/codebase-index/`                          | Indexer implementation               |
| `../../modules/codebase-index/runbook.md`                   | Operations runbook                   |

---

## 9. Full Reference Details (from archived deep-dive)

> Merged from `application/api/codebase-index/api-codebase.md` (445ℓ). Existing §§1–8 above remain canonical summary; this section preserves full reference detail.

## Codebase Index API Reference

> **Architecture decision context:** See [ADR-002: Codebase Index Architecture](../../../design/decisions/adr-002-codebase-index.md) for design rationale, including the choice of `web-tree-sitter` WASM bindings, SQLite storage strategy, incremental indexing with SHA-256 checksums, and single-pass parsing for Phase 1.0.
>
> **REFACTOR-CI-003:** Six individual tools were consolidated into two unified tools per ADR-005 ("Zero oneOf — auto-infer"). The old tool names (`index_repository`, `index_status`, `search_symbols`, `get_file_symbols`, `get_architecture`, `trace_symbol`, `codebase_search`) still route to the unified handlers for backward compatibility.

The Codebase Index provides **2 MCP tools** for indexing and querying source code structure. All tools conform to the [MCP 2025-03-26 Structured Content](https://modelcontextprotocol.io/specification/2025-03-26/server/tools#structured-content) specification.

## Shared response contract

Read tools that expose a `json` flag follow one contract in every auto-inferred mode:

| Request                  | `content`                          | `structuredContent`                                      |
| :----------------------- | :--------------------------------- | :------------------------------------------------------- |
| `json: false` or omitted | One non-empty compact text summary | Omitted                                                  |
| `json: true`             | The same compact text summary      | Present; full objects are not serialized again into text |

Successful structured read responses carry stable top-level `schema` and `mode` discriminators. Existing domain fields remain at their historical paths for backward compatibility; payloads are not duplicated under generic aliases because that would waste context tokens.

| Tool            | Stable `schema`                                                  | Modes                                             |
| :-------------- | :--------------------------------------------------------------- | :------------------------------------------------ |
| `memory-read`   | `memory-read`                                                    | `recap`, `search`, `detail`                       |
| `standard-read` | `standard-read`                                                  | `list`, `search`, `detail`                        |
| `task-read`     | `task-read/<mode>` (legacy value retained)                       | `list`, `search`, `detail`                        |
| `handoff-read`  | `handoff-read`; `claim-list` for claims (legacy values retained) | `list`, `search`, `claims`, `detail`              |
| `codebase-read` | `codebase-read`                                                  | `architecture`, `search`, `file`, `trace`, `code` |

`codebase-index` is the documented exception: it has no `json` input and always returns structured content because INDEX/STATUS results are protocol-operational data rather than optional read detail. Errors use the separate `schema: "tool-error"` contract in §1.5.

---

## 1. `codebase-index`

**Handler:** `handleCodebaseIndex` in `src/mcp/tools/codebase-index-sdk.ts` → delegates to `handleCodebaseIndexRepository` / `handleCodebaseIndexStatus` in `src/mcp/tools/codebase-index.ts`

### 1.1 Purpose

Unified write + status tool. Mode auto-inferred from parameters per ADR-005:

- **`repoPath` + `repo` → INDEX** — scans the repository directory, discovers source files, parses with tree-sitter, and stores extracted symbols in the SQLite database. Supports incremental indexing: an mtime pre-filter (2000ms ambiguity margin) skips unchanged files **without reading them**, and ambiguous/new files are confirmed against their stored SHA-256 checksum before parsing.
- **`repo` only → STATUS** — returns the current indexing status for a repository (is it indexed? when? how many files/symbols? stale?).

### 1.2 Input Schema

| Parameter      | Type            | Required | Default | Mode  | Description                                                             |
| :------------- | :-------------- | :------- | :------ | :---- | :---------------------------------------------------------------------- |
| `repo`         | `string`        | Yes      | —       | both  | Repository name (auto-normalized — an `owner/repo` prefix is stripped). |
| `owner`        | `string`        | No       | —       | both  | GitHub owner/org scope; auto-inferred from the session when omitted.    |
| `repoPath`     | `string`        | No       | —       | INDEX | Absolute filesystem path to the repository.                             |
| `force`        | `boolean`       | No       | `false` | INDEX | Force full re-index, ignoring stored checksums.                         |
| `includeGlobs` | `array<string>` | No       | —       | INDEX | Include only files matching these glob patterns.                        |
| `excludeGlobs` | `array<string>` | No       | —       | INDEX | Exclude files matching these glob patterns.                             |

**Default exclusions (always applied):** `node_modules`, `.git`, `dist`, `.next`, `build`, `coverage`, `__pycache__`, `.venv`, `vendor`, `target`, `.DS_Store`.

### 1.3 INDEX Output

```typescript
{
	success: boolean; // false if failedFiles > 0
	totalFiles: number; // total discovered files
	parsedFiles: number; // files actually parsed (new or changed)
	skippedFiles: number; // files with matching checksums
	failedFiles: number; // files that failed to parse
	totalSymbols: number; // total symbols extracted
	durationMs: number; // total indexing duration
	errors: Array<{
		filePath: string;
		error: string;
	}>;
	skippedByChecksum: number;
	skippedByMtime: number;
	skippedByExtension: number;
	skippedByGitignore: number;
	renamedFiles: number;
	errorSummary: ErrorSummary;
}
```

### 1.4 STATUS Output

```typescript
{
	repo: string;
	isIndexed: boolean; // true if at least one file has been indexed
	isIndexing: boolean; // true if an index call is in progress for this repo
	lastIndexedAt: string | null; // ISO 8601 timestamp of most recent file index
	totalFiles: number;
	totalSymbols: number;
	progress: IndexProgress | null;
	stale?: boolean;
	staleRatio?: number;
}
```

### 1.5 Tool Error Contract

Failed operations return `isError: true`, one concise text item, and this stable structured envelope:

```typescript
{
	schema: "tool-error";
	code: string;
	message: string;
	retryable: boolean;
	details?: Record<string, unknown>;
	error: string; // deprecated compatibility alias of message
}
```

Partial bulk operations also use `isError: true` with `code: "PARTIAL_FAILURE"` while retaining successful item results at their existing top-level paths. Unknown exceptions become `INTERNAL_ERROR`; raw exception messages and filesystem details remain server-side in logs.

| Scenario                 | Code               | Retryable |
| :----------------------- | :----------------- | :-------- |
| Invalid arguments        | `VALIDATION_ERROR` | No        |
| Path does not exist      | `PATH_NOT_FOUND`   | No        |
| Path is not a directory  | `NOT_A_DIRECTORY`  | No        |
| Index failed internally  | `INDEX_FAILED`     | Yes       |
| Unknown internal failure | `INTERNAL_ERROR`   | No        |

### 1.6 Runnable Examples

**INDEX:**

```json
{
	"jsonrpc": "2.0",
	"id": 100,
	"method": "tools/call",
	"params": {
		"name": "codebase-index",
		"arguments": {
			"repo": "my-org/my-project",
			"repoPath": "/home/user/projects/my-app",
			"force": false,
			"includeGlobs": ["src/**/*.ts"],
			"excludeGlobs": ["**/*.test.ts"]
		}
	}
}
```

**STATUS:**

```json
{
	"jsonrpc": "2.0",
	"id": 101,
	"method": "tools/call",
	"params": {
		"name": "codebase-index",
		"arguments": {
			"repo": "my-org/my-project"
		}
	}
}
```

---

## 2. `codebase-read`

**Handler:** `handleCodebaseRead` in `src/mcp/tools/codebase.read.ts` (L430-L453)

### 2.1 Purpose

Unified read-only access to the codebase index. Mode auto-inferred from parameters per ADR-005:

- **`name` → TRACE** (was `trace_symbol`) — traces a symbol's definition and references across the codebase
- **`filePath` → FILE** (was `get_file_symbols`) — returns all indexed symbols declared in a specific file
- **`content` → CODE** (was `search_code`, design intent only — never shipped as a tool) — greps indexed file contents with symbol-context enrichment
- **`query` → SEARCH** (was `search_symbols` + `codebase_search`) — searches indexed symbols by name with multi-strategy ranking + vector blending
- **(nothing) → ARCHITECTURE** (was `get_architecture`) — directory tree overview, language breakdown, top-level exports, dead-code candidates + hotspots

### 2.2 Input Schema

| Parameter             | Type                 | Required | Default | Mode               | Description                                                                                                                                                                     |
| :-------------------- | :------------------- | :------- | :------ | :----------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `repo`                | `string`             | No\*     | —       | all                | Repository name (normalized). **SEARCH requires `repo` or `repos`** — without either it rejects to prevent cross-tenant leaks.                                                  |
| `repos`               | `array<string>`      | No       | —       | SEARCH             | Cross-repo search scope; each value normalized. Capped at 50.                                                                                                                   |
| `owner`               | `string`             | No       | `""`    | all                | GitHub owner/org; auto-inferred from session when omitted.                                                                                                                      |
| `name`                | `string`             | No       | —       | TRACE              | Symbol name to trace (exact match with fallback variants).                                                                                                                      |
| `filePath`            | `string`             | No       | —       | FILE               | Relative file path from repository root.                                                                                                                                        |
| `query`               | `string`             | No       | —       | SEARCH             | Search query (code-like term or natural language).                                                                                                                              |
| `content`             | `string`             | No       | —       | CODE               | Substring or regex needle to grep in indexed file contents (trimmed; empty → no-op empty result).                                                                               |
| `regex`               | `boolean`            | No       | `false` | CODE               | Treat `content` as a regular expression (case-insensitive; ReDoS-guarded).                                                                                                      |
| `language`            | `string`             | No       | —       | CODE               | Only grep files whose `codebase_files.language` matches (case-insensitive).                                                                                                     |
| `repoPath`            | `string`             | No       | —       | CODE, ARCHITECTURE | Absolute path of the indexed repo on disk. **Required for CODE** (content is read from disk); optional for ARCHITECTURE (enables `package.json`/shebang entry-point exclusion). |
| `depth`               | `number`             | No       | `2`     | ARCHITECTURE       | Directory tree depth limit (1–5).                                                                                                                                               |
| `includeSymbolCounts` | `boolean`            | No       | `true`  | ARCHITECTURE       | Include per-file symbol kind counts in tree.                                                                                                                                    |
| `includeReferences`   | `boolean`            | No       | `true`  | TRACE              | Include call-site references in TRACE output.                                                                                                                                   |
| `kind`                | `string \| string[]` | No       | —       | SEARCH             | Filter by symbol kind (e.g. `function`, `class`).                                                                                                                               |
| `filePath`            | `string`             | No       | —       | SEARCH             | Filter to symbols declared in a specific file.                                                                                                                                  |
| `exportedOnly`        | `boolean`            | No       | —       | SEARCH             | When `true`, only return exported symbols.                                                                                                                                      |
| `limit`               | `number`             | No       | `50`    | SEARCH             | Maximum results to return (1–200).                                                                                                                                              |
| `offset`              | `number`             | No       | `0`     | SEARCH             | Pagination offset.                                                                                                                                                              |
| `json`                | `boolean`            | No       | `false` | all                | Return raw JSON without Markdown wrapping.                                                                                                                                      |

### 2.3 SEARCH Strategy (Ranking Tiers)

| Tier | Strategy         | Description                                                                                    |
| :--- | :--------------- | :--------------------------------------------------------------------------------------------- |
| 1    | Exact match      | Symbol name equals the query exactly (case-insensitive).                                       |
| 2    | Camel-case match | Query matches camel-case boundaries (e.g., `formatOrd` → `formatOrder`).                       |
| 3    | Prefix match     | Symbol name starts with the query.                                                             |
| 4    | Substring match  | Query appears anywhere in the symbol name.                                                     |
| 5    | FTS5 fallback    | Full-text search on `name`, `doc_comment`, and `signature` (signature added by migration v18). |

Results are further refined by **vector similarity blending** within each tier (cosine similarity × 0.30 + tier score × 0.70).

### 2.4 Output Schemas

**TRACE:**

```typescript
{
	mode: "trace";
	symbol: CodebaseSymbol;
	definition: { file: string; line: number; column: number; endLine: number; };
	references: Array<{
		filePath: string;
		startLine: number;
		startCol: number;
		context: string;
		kind?: "call" | "instantiation" | "import" | "extends" | "implements"; // table-backed refs (v21 + v23)
		targetFile?: string | null; // v23, when resolvable
		targetSymbolId?: string | null; // v23, when resolvable
	}>;
	exportChain: { exported: boolean; defaultExport: boolean; };
	parent: { id: string; name: string; kind: string; filePath: string; line: number | null } | null; // enclosing container (v23 parent_symbol_id hierarchy)
	children: CodebaseSymbol[]; // direct children, ordered by start line
	originalName?: string; // present when trace fell back to a variant name
}
```

**FILE:**

```typescript
{
	mode: "file";
	file: { path: string; language: string | null; checksum: string | null; lines: number; sizeBytes: number; lastIndexedAt: string | null; };
	symbols: CodebaseSymbol[];
	total: number;
}
```

**CODE:**

```typescript
{
	mode: "code";
	content: string;
	regex: boolean;
	language: string | null;
	matches: Array<{
		filePath: string; // codebase_files.file_path
		language: string | null;
		line: number; // 1-based
		snippet: string; // ~80 chars around the match, ellipsis-padded
		matchIndex: number; // char index of the match within the line
		enclosingSymbol: { name: string; kind: string; startLine: number; endLine: number } | null; // innermost enclosing symbol
	}>;
	total: number; // matches up to the stop point
	hasMore: boolean; // true when matches remain beyond this page
	filesScanned: number; // indexed files actually scanned (after language filter + readability)
	fileCount: number; // indexed files in scope (after language filter)
	indexedFiles: number; // total indexed files (0 ⇒ repo not indexed)
	offset: number;
	limit: number;
}
```

**ARCHITECTURE:**

```typescript
{
	mode: "architecture";
	root: DirectoryNode;
	summary: { totalFiles: number; totalSymbols: number; languageBreakdown: Record<string, number>; topLevelExports: CodebaseSymbol[]; };
	deadCode?: { // present when includeSymbolCounts is true
		unreferenced: Array<{
			name: string; kind: string; file_path: string; line: number | null;
			kinds: Record<string, number>; // all-zero = dead candidate
			entryPoint?: { type: "bin" | "manifest" | "shebang" | "public-api"; reason: string }; // present ONLY when excluded as an entry point
		}>; // truly-dead candidates ordered FIRST
		hotspots: Array<{ name: string; kind: string; file_path: string; refCount: number; topKinds: Record<string, number> }>;
		languageCoverage: { reliable: string[]; unreliable: string[] };
		totals: { scanned: number; dead: number; entryExcluded: number; truncated: boolean };
		coverageNote: string;
	};
}
```

**SEARCH:**

```typescript
{
	mode: "search";
	symbols: Array<CodebaseSymbol & { rankTier: number; score: number }>;
	total: number;
	hasMore: boolean;
	offset: number;
	limit: number;
	query: string;
}
```

### 2.5 Error Codes

| Scenario               | Code                  | Behavior                                                                                |
| :--------------------- | :-------------------- | :-------------------------------------------------------------------------------------- |
| Symbol not found       | `SYMBOL_NOT_FOUND`    | `{ error: "Symbol \"X\" not found", code: "SYMBOL_NOT_FOUND" }`                         |
| Multiple matches       | `AMBIGUOUS_SYMBOL`    | `{ error: "Ambiguous symbol \"X\"", code: "AMBIGUOUS_SYMBOL", disambiguation: [] }`     |
| File not indexed       | `FILE_NOT_INDEXED`    | `{ error: "File not indexed...", code: "FILE_NOT_INDEXED" }`                            |
| CODE: no repo          | `REPO_REQUIRED`       | `{ error: "Mode 'code' requires a concrete 'repo'", code: "REPO_REQUIRED" }`            |
| CODE: no path          | `REPO_PATH_REQUIRED`  | `{ error: "Code search requires `repoPath`...", code: "REPO_PATH_REQUIRED" }`           |
| CODE: bad path         | `REPO_PATH_NOT_FOUND` | `{ error: "Repository path not found...", code: "REPO_PATH_NOT_FOUND" }`                |
| CODE: not indexed      | `REPO_NOT_INDEXED`    | `{ error: "Repo \"X\" has no indexed files...", code: "REPO_NOT_INDEXED" }`             |
| CODE: files unreadable | `REPO_FILES_MISSING`  | `{ error: "None of the N indexed files could be read...", code: "REPO_FILES_MISSING" }` |
| CODE: bad regex        | `INVALID_REGEX`       | `{ error: "Invalid regex for code search...", code: "INVALID_REGEX" }`                  |

### 2.6 Runnable Examples

**ARCHITECTURE:**

```json
{
	"jsonrpc": "2.0",
	"id": 302,
	"method": "tools/call",
	"params": {
		"name": "codebase-read",
		"arguments": {
			"repo": "my-org/my-project",
			"depth": 3,
			"includeSymbolCounts": true
		}
	}
}
```

**FILE:**

```json
{
	"jsonrpc": "2.0",
	"id": 301,
	"method": "tools/call",
	"params": {
		"name": "codebase-read",
		"arguments": {
			"repo": "my-org/my-project",
			"filePath": "src/services/order.ts"
		}
	}
}
```

**SEARCH:**

```json
{
	"jsonrpc": "2.0",
	"id": 300,
	"method": "tools/call",
	"params": {
		"name": "codebase-read",
		"arguments": {
			"query": "formatOrder",
			"kind": "function",
			"repo": "my-org/my-project",
			"limit": 10
		}
	}
}
```

**TRACE:**

```json
{
	"jsonrpc": "2.0",
	"id": 303,
	"method": "tools/call",
	"params": {
		"name": "codebase-read",
		"arguments": {
			"name": "formatOrder",
			"repo": "my-org/my-project",
			"includeReferences": true
		}
	}
}
```

**CODE:**

```json
{
	"jsonrpc": "2.0",
	"id": 304,
	"method": "tools/call",
	"params": {
		"name": "codebase-read",
		"arguments": {
			"content": "formatOrder",
			"repo": "my-org/my-project",
			"repoPath": "/home/user/projects/my-app",
			"language": "typescript",
			"limit": 20
		}
	}
}
```

---

## Known Limitations

| Limitation                              | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Planned For |
| :-------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------- |
| **Name-based reference resolution**     | Symbol tracing and relation detection are name-matched only (ADR-002). No type-graph or semantic resolution — two same-name symbols may conflate; LSP-based type resolution remains future work.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | N/A         |
| **Multi-language parsing**              | 15 languages registered (14 via tree-sitter grammars + a dedicated Markdown visitor with no WASM) + a generic catch-all = **16 configs**, implemented by **15 visitor classes** (TypeScript/TSX/JS/JSX share the TypeScript visitor; Vue, Go, Python, PHP, Rust, Java, Dart, Kotlin, Ruby, Swift, C, C++, Markdown). A generic text visitor covers every other extension (JSON, YAML, CSS, shell, …). `TypeScript/TSX` also covers `.svelte`/`.astro`. **14 of the 16 configs emit reference edges** (all but Markdown + generic — see the [MD-Generic decision](../../../application/modules/codebase-index/specs/edge-markdown-generic.md)).                                                                                                                                                                                       | N/A         |
| **Reference storage (edges, v21+v23)**  | Reference edges ARE persisted: call-site edges (call/instantiation/import) since migration **v21**; heritage edges (**extends/implements**) + edge targets (`target_file`/`target_symbol_id`) since migration **v23** (Phase 1.1). TRACE lists them with kind + resolved targets. Per-language edge coverage differs (see the feature-guide matrix); resolution is name-based, not a resolved type-graph.                                                                                                                                                                                                                                                                                                                                                                                                                            | N/A         |
| **Content search = disk grep (CODE)**   | The `CODE` mode greps indexed files **on disk** through a process-shared LRU cache (validity keyed to the `codebase_files` row checksum) — it is **not** an FTS/database content scan. `repoPath` is required and validated; regex mode is ReDoS-guarded; no type resolution.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | N/A         |
| **Dead-code & hotspots (ARCHITECTURE)** | `deadCode` block covers zero-reference top-level candidates (entry-point-excluded: package.json `bin`/`main`/`exports`/`browser`, shebang, exported public API) and top in-degree hotspots. Candidates exist only for languages with OBSERVED reference rows in the index (reliable emission); others are reported declaration-only. Name aggregation, bounded by `DEAD_CODE_SCAN_LIMIT`.                                                                                                                                                                                                                                                                                                                                                                                                                                            | N/A         |
| **Polling file watcher (not fs.watch)** | Freshness comes from incremental re-indexes. Indexing is triggered by the `codebase-index` tool (INDEX), the CLI `--index` flag, the startup auto-index (`autoIndexIfStale` — on by default via `CODEBASE_AUTO_INDEX`, 24h TTL via `CODEBASE_AUTO_INDEX_TTL`), or a light **polling watcher** (`ENABLE_FILE_WATCHER`, default on): every `FILE_WATCH_INTERVAL_MS` (default 30s) it sweeps registered repos and triggers `autoIndexIfStale` with a short TTL when due (per-repo re-entry cap `FILE_WATCH_TTL_MS`, default 5 min); change detection is the incremental planner's mtime/checksum short-circuit, so an untouched repo costs a zero-parse run. Hosted by the MCP server process only (the dashboard does not host it). This is **not** `fs.watch` real-time notification — detection latency is up to the sweep interval. | N/A         |
| **Progress is emitted, not persisted**  | The pipeline emits per-batch progress through the `onProgress` callback (parsing/storing/cleaning stages). `index_status.progress` is **always `null`** — `getIndexStatus` never persists progress (`src/mcp/codebase-index/services/indexing-repository.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | N/A         |
| **Database growth**                     | Indexing large projects adds to `memory.db` (~10-50MB per 10K files). WAL mode prevents write contention.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | N/A         |

---

## Performance Characteristics

| Tool             | Operation    | Query Complexity                | Index Strategy                                                                                                    |
| :--------------- | :----------- | :------------------------------ | :---------------------------------------------------------------------------------------------------------------- |
| `codebase-index` | INDEX        | O(n) per file; O(1) per skipped | mtime pre-filter (2000ms margin) + checksum confirmation; tree-sitter WASM per file (10s timeout, 10MB file cap). |
| `codebase-index` | STATUS       | 3 COUNT queries                 | `idx_codebase_files_repo_path`, `idx_cs_repo_name`.                                                               |
| `codebase-read`  | ARCHITECTURE | 2-3 queries + tree construction | All symbols counted via `GROUP BY`.                                                                               |
| `codebase-read`  | FILE         | 2 SELECT queries                | `idx_codebase_files_repo_path`, `idx_cs_repo_file`.                                                               |
| `codebase-read`  | SEARCH       | FTS5 + LIKE + in-memory ranking | FTS5 virtual table; indexes on `name`, `kind`, `file_path`.                                                       |
| `codebase-read`  | CODE         | Disk grep over indexed files    | LRU-cached file contents (checksum-keyed validity); language filter prunes the file set before reads.             |
| `codebase-read`  | TRACE        | 1-2 full scans (in-memory)      | No DB-level index needed; operates on fetched symbol array.                                                       |

All read operations run without blocking writes (WAL mode). For projects up to 20,000 files, typical query times are <100ms for read operations.
