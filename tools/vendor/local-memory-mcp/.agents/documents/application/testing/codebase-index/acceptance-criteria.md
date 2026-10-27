# Acceptance Criteria — Codebase Index

> **Format**: EARS (Easy Approach to Requirements Syntax) — Ubiquitous, Event-driven, State-driven, Unwanted.
> **Scope**: MVP features (M1–M5) plus Should-have features (S1–S5).


---

## AC-01: File Discovery Respects `.gitignore` [Ubiquitous]

> **Applies to**: M1 — File discovery and filtering

```
The system SHALL discover source files for indexing.
The system SHALL read `.gitignore` from the project root and each subdirectory.
The system SHALL exclude all files and directories matched by `.gitignore` patterns.
The system SHALL exclude `node_modules`, `.git`, and `dist` directories even if not listed in `.gitignore`.
The system SHALL support configurable include patterns defaulting to `["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"]`.
```

**Test**: Given a project with 100 source files and 50 files in `node_modules`, when file discovery runs, then exactly 100 files are returned.

---

## AC-02: tree-sitter Parsing Extracts Declarations [Event-driven]

> **Applies to**: M2 — tree-sitter AST parsing

```
When the system parses a TypeScript or JavaScript file via tree-sitter,
THEN it SHALL extract all top-level declarations including functions, classes, interfaces, types, enums, and exported variables.
AND it SHALL extract method declarations within classes.
AND it SHALL record the symbol name, kind, start line, end line, start column, end column, file path, and doc comment.
AND it SHALL extract function/method signatures (parameters with names and types, return type).
```

**Test**: Given a 100-line TypeScript file with 5 functions, 2 classes, 1 interface, and 1 type alias, when parsed, then 9+ symbol records are produced.

---

## AC-03: Symbol Search Returns Relevant Results [Ubiquitous]

> **Applies to**: M4 — `search_symbols` tool

```
The `search_symbols` tool SHALL support exact-match queries.
The `search_symbols` tool SHALL support prefix-match queries.
The `search_symbols` tool SHALL support case-insensitive substring-match queries.
The `search_symbols` tool SHALL return results ordered by relevance (exact > prefix > substring).
The `search_symbols` tool SHALL return name, kind, file path, line number, signature, and doc comment for each match.
The `search_symbols` tool SHALL limit results to a configurable maximum (default 50).
The `search_symbols` tool SHALL return an empty array (not an error) when no symbols match.
```

**Test**: Given an indexed codebase containing `formatOrder`, `formatOrderItem`, and `OrderFormatter`, when searching for `"formatOrder"`, then `formatOrder` is the first result.

---

## AC-04: Search Performance Meets SLA [State-driven]

> **Applies to**: M4 — `search_symbols` tool

```
While the codebase contains fewer than 500,000 indexed symbols,
the `search_symbols` tool SHALL respond within 200ms for exact-match queries.
the `search_symbols` tool SHALL respond within 500ms for substring-match queries.
```

**Test**: Given an index of 100,000 symbols, when an exact-match search is performed, then P99 latency < 200ms.

---

## AC-05: get_file_symbols Returns File Contents [Event-driven]

> **Applies to**: M5 — `get_file_symbols` tool

```
When `get_file_symbols` is called with a valid indexed file path,
THEN it SHALL return all symbols defined in that file with name, kind, line range, and signature.
AND it SHALL include exported vs non-exported status for each symbol.
AND it SHALL order symbols by their declaration order in the file.
```

**Test**: Given an indexed file with 3 classes and 5 functions, when `get_file_symbols` is called, then 8 symbols are returned in source order.

---

## AC-06: Doc Comments Are Preserved [Ubiquitous]

> **Applies to**: M2 — tree-sitter AST parsing

```
The system SHALL extract the full JSDoc or TSDoc comment block immediately preceding a symbol declaration.
The system SHALL trim leading `*` characters and whitespace from doc comment lines.
The system SHALL store the cleaned doc comment text with the symbol record.
The system SHALL handle symbols without doc comments (store null/empty).
```

**Test**: Given a file where `calculateTotal` has a JSDoc comment and `helper` does not, when parsed, then `calculateTotal` has a non-empty doc comment and `helper` has null.

---

## AC-07: Error Handling for Missing Index [Unwanted]

> **Applies to**: M4, M5 — MCP tools

```
The `search_symbols` and `get_file_symbols` tools SHALL return a clear error message when the project has not been indexed.
The error message SHALL include instructions to run the `index_project` command.
The tools SHALL NOT crash or return partial data when no index exists.
```

**Test**: Given a fresh local-memory-mcp instance with no codebase index, when `search_symbols("foo")` is called, then a user-friendly error about missing index is returned.

---

## AC-08: Incremental Re-Index Detects Changes [Event-driven]

> **Applies to**: S4 — Incremental re-indexing

```
When `index_project` is called with `incremental=true`,
THEN the system SHALL compare file modification timestamps (mtime) against a stored index timestamp.
AND it SHALL re-parse only files whose mtime is newer than the last index timestamp.
AND it SHALL detect deleted files and remove their symbols from the index.
AND it SHALL detect new files and add them to the index.
```

**Test**: Given an indexed project with 50 files, when 1 file is modified and 1 file is added, then incremental re-index processes exactly 2 files.

---

## AC-09: trace_path Returns Ordered Call Chains [Event-driven]

> **Applies to**: S2 — `trace_path` tool

```
When `trace_path` is called with a symbol name and direction "inbound",
THEN it SHALL return an ordered list of all functions that directly call the given symbol.
When called with direction "outbound",
THEN it SHALL return an ordered list of all functions directly called by the given symbol.
When called with a symbol that has no callers or callees,
THEN it SHALL return an empty array (not an error).
AND it SHALL support a `maxDepth` parameter to limit chain depth (default 1).
```

**Test**: Given `function A() calls B() calls C()`, when tracing path inbound for `C`, then `[B, A]` is returned (respecting depth limit).

---

## AC-10: Binary and Unsupported Files Are Skipped [Ubiquitous]

> **Applies to**: M1, M2 — File discovery and parsing

```
The system SHALL detect binary files by reading the first 512 bytes and checking for null bytes.
The system SHALL skip binary files without attempting to parse them.
The system SHALL skip files with extensions not in the configured include patterns.
The system SHALL log a warning for each skipped file at DEBUG level.
The system SHALL NOT crash or abort indexing when encountering unsupported files.
```

**Test**: Given a directory containing a `.png` file, a `.py` file, and a `.ts` file, when indexing runs, then exactly 1 file is parsed (the `.ts` file).

---

## AC-11: Symlinks Are Resolved Safely [Ubiquitous]

> **Applies to**: M1 — File discovery

```
The system SHALL follow symbolic links to directories during file discovery.
The system SHALL detect and skip circular symlinks.
The system SHALL detect symlinks pointing outside the project root and skip them (configurable).
The system SHALL store the real (resolved) path for symlinked files.
```

**Test**: Given a symlink `src/utils` pointing to `../shared/utils`, when file discovery runs, then files under the resolved path are indexed with their real paths.

---

## AC-12: Large File Handling [State-driven]

> **Applies to**: M2 — tree-sitter parsing

```
While a file exceeds 10,000 lines,
the system SHALL still parse the file but SHALL limit AST depth to 500 nodes.
While a file exceeds 50,000 lines,
the system SHALL skip the file and log a warning with the file path and size.
While the total project exceeds 10,000 files,
the system SHALL index all files but SHALL report the total count and estimated completion time.
```

**Test**: Given a project with 3 files of 200 lines, 1 file of 60,000 lines, and 1 file of 12,000 lines, when indexing runs, then the 60K-line file is skipped, the 12K-line file is shallow-parsed, and the 200-line files are fully parsed.

---

## AC-13: Index Staleness Detection [State-driven]

> **Applies to**: S4 — Incremental re-indexing

```
While a file's modification timestamp is newer than its last indexed timestamp,
the system SHALL consider that file stale.
While a file has been deleted from the filesystem but still exists in the index,
the system SHALL remove its symbols on the next incremental re-index.
```

**Test**: Given an index of "file A" (stale mtime) and "file B" (fresh mtime), when incremental re-index runs, then only "file A" is re-parsed.

---

## AC-14: Architecture Overview Returns Aggregate Data [Event-driven]

> **Applies to**: S3 — `get_architecture` tool

```
When `get_architecture` is called,
THEN it SHALL return total file count, total symbol count, and counts by symbol kind.
AND it SHALL return the top 10 files by symbol count.
AND it SHALL return entry point files (files with exports).
AND it SHALL return directory depth and breadth statistics.
```

**Test**: Given an indexed project with 20 files and 150 symbols, when `get_architecture` is called, then all required fields are present and counts are accurate.

---

## AC-15: Auto-Index Lifecycle [Event-driven]

> **Applies to**: S5 — Auto-index on session start

```
When the MCP server initializes a new session,
THEN the system SHALL check whether a codebase index exists for the current project root.
If no index exists, the system SHALL trigger a full index automatically.
If an index exists and is stale (older than 24 hours), the system SHALL trigger an incremental re-index.
If an index exists and is fresh, the system SHALL skip indexing.
The system SHALL include a file count guard (default max 50,000 files) to prevent runaway indexing.
```

**Test**: Given a project with no existing index, when the MCP session starts, then indexing begins automatically and completes within 60 seconds.

---

## Coverage Map

| Criterion | US-01 | US-02 | US-03 | US-04 | US-05 | US-06 | US-07 | US-08 | US-09 | US-10 | US-11 | US-12 |
| :-------- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| AC-01     |   ✓   |   ✓   |       |       |       |       |       |       |       |       |       |       |
| AC-02     |   ✓   |       |       |       |   ✓   |   ✓   |       |       |       |       |       |       |
| AC-03     |       |       |   ✓   |       |       |       |       |       |       |       |       |       |
| AC-04     |       |       |   ✓   |       |       |       |       |       |       |       |       |       |
| AC-05     |       |       |       |   ✓   |       |       |       |       |       |       |       |       |
| AC-06     |       |       |       |       |       |   ✓   |       |       |       |       |       |       |
| AC-07     |       |       |   ✓   |   ✓   |       |       |       |       |       |       |       |       |
| AC-08     |       |       |       |       |       |       |       |   ✓   |       |       |       |       |
| AC-09     |       |       |       |       |       |       |   ✓   |       |       |       |       |       |
| AC-10     |   ✓   |   ✓   |       |       |       |       |       |       |       |       |       |       |
| AC-11     |       |   ✓   |       |       |       |       |       |       |       |       |       |       |
| AC-12     |   ✓   |       |       |       |       |       |       |       |       |       |       |       |
| AC-13     |       |       |       |       |       |       |       |   ✓   |       |       |       |       |
| AC-14     |       |       |       |       |       |       |       |       |   ✓   |       |       |       |
| AC-15     |       |       |       |       |       |       |       |       |       |   ✓   |       |       |
