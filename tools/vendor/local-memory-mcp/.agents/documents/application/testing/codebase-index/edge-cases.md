# Edge Cases — Codebase Index

> **Scope**: MVP (P0) plus Should-have (P1) features.
> Each edge case includes the feature it affects, risk level, and recommended handling strategy.


---

## EC-01: Binary Files

| Property                | Value                                                               |
| :---------------------- | :------------------------------------------------------------------ |
| **Affects**             | M1 — File discovery, M2 — tree-sitter parsing                       |
| **Risk**                | High — tree-sitter would crash or produce garbage on binary input   |
| **Detection**           | Read first 512 bytes; if null byte (`\0`) found, classify as binary |
| **Handling**            | Skip the file; log at DEBUG level; continue indexing                |
| **Acceptance Criteria** | AC-10                                                               |

---

## EC-02: Symbolic Links (Symlinks)

| Property                | Value                                                                                                                                                 |
| :---------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Affects**             | M1 — File discovery                                                                                                                                   |
| **Risk**                | Medium — infinite recursion via circular symlinks; indexing files outside project                                                                     |
| **Detection**           | Use `realpath` to resolve; track visited inodes to detect cycles                                                                                      |
| **Handling**            | Follow symlinks by default but detect cycles (visited set of inodes); skip symlinks pointing outside the project root; store the resolved (real) path |
| **Acceptance Criteria** | AC-11                                                                                                                                                 |

---

## EC-03: Very Large Files (>50,000 lines)

| Property                | Value                                                                                                                    |
| :---------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| **Affects**             | M2 — tree-sitter parsing                                                                                                 |
| **Risk**                | High — OOM crash on extremely large files (e.g., generated GraphQL schemas, bundled protobuf)                            |
| **Detection**           | Check line count before parsing                                                                                          |
| **Handling**            | Skip files >50,000 lines with a warning; for files >10,000 lines but <50,000, parse with an AST depth limit of 500 nodes |
| **Acceptance Criteria** | AC-12                                                                                                                    |

---

## EC-04: Very Large Projects (>10,000 files)

| Property                | Value                                                                                                                                                     |
| :---------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Affects**             | M1 — File discovery, M2 — tree-sitter parsing, S5 — Auto-index                                                                                            |
| **Risk**                | High — indexing a Linux-kernel-sized repo would take hours and exhaust memory                                                                             |
| **Detection**           | Count files after discovery; compare against configurable limit (default 50,000)                                                                          |
| **Handling**            | Index all files but report total count and progress; auto-index has a file count guard (default max 50,000); provide a warning for projects >10,000 files |
| **Acceptance Criteria** | AC-12, AC-15                                                                                                                                              |

---

## EC-05: Files with Byte Order Mark (BOM)

| Property      | Value                                                                               |
| :------------ | :---------------------------------------------------------------------------------- |
| **Affects**   | M2 — tree-sitter parsing                                                            |
| **Risk**      | Low — tree-sitter may not handle UTF-8 BOM (`0xEF 0xBB 0xBF`) gracefully            |
| **Detection** | Check first 3 bytes for UTF-8 BOM                                                   |
| **Handling**  | Strip BOM bytes before feeding to tree-sitter; log at DEBUG level; continue parsing |

---

## EC-06: Files Outside Project Root

| Property      | Value                                                                                |
| :------------ | :----------------------------------------------------------------------------------- |
| **Affects**   | M1 — File discovery                                                                  |
| **Risk**      | Medium — symlinks or path traversal could reference files outside the intended scope |
| **Detection** | Check that each file's resolved path starts with the project root directory          |
| **Handling**  | Skip files whose resolved path is outside the project root; log at WARN level        |

---

## EC-07: Permission Denied

| Property      | Value                                                                                                                                                  |
| :------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Affects**   | M1 — File discovery                                                                                                                                    |
| **Risk**      | Medium — could cause partial index or crash if unhandled                                                                                               |
| **Detection** | `EACCES` / `EPERM` errors during `readdir` or `stat` syscalls                                                                                          |
| **Handling**  | Catch permission errors per file; skip inaccessible files; log at WARN level; continue indexing; report the count of skipped files in the index result |

---

## EC-08: Concurrent Indexing Requests

| Property      | Value                                                                                                                                                                                        |
| :------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Affects**   | M3 — SQLite storage, S5 — Auto-index                                                                                                                                                         |
| **Risk**      | Medium — two simultaneous indexing operations could corrupt the database or double-count symbols                                                                                             |
| **Detection** | Track indexing state via an in-memory mutex/lock                                                                                                                                             |
| **Handling**  | If an index is already running, reject the second request with error "Index already in progress"; queue the request (optional) or require retry; use SQLite transactions to ensure atomicity |

---

## EC-09: Index Staleness (File Modified After Index)

| Property                | Value                                                                                                                                                                                    |
| :---------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Affects**             | S4 — Incremental re-indexing, M4, M5 — MCP tools                                                                                                                                         |
| **Risk**                | Medium — agent gets stale symbol data                                                                                                                                                    |
| **Detection**           | Store `indexed_at` timestamp per file; compare against current mtime on query (optional)                                                                                                 |
| **Handling**            | On incremental re-index, re-parse files with mtime > stored `indexed_at`; optionally, show a warning in `search_symbols` if the index is stale; always support full re-index as fallback |
| **Acceptance Criteria** | AC-13                                                                                                                                                                                    |

---

## EC-10: Empty Files

| Property      | Value                                                                  |
| :------------ | :--------------------------------------------------------------------- |
| **Affects**   | M2 — tree-sitter parsing                                               |
| **Risk**      | Low — tree-sitter may return empty AST; should not crash               |
| **Detection** | Check file size (0 bytes) before parsing                               |
| **Handling**  | Skip empty files; log at DEBUG level; do not create any symbol records |

---

## EC-11: Files with Only Comments

| Property      | Value                                                                                 |
| :------------ | :------------------------------------------------------------------------------------ |
| **Affects**   | M2 — tree-sitter parsing                                                              |
| **Risk**      | Low — parsing succeeds but produces zero symbols                                      |
| **Detection** | N/A (detected naturally by zero symbol output after parse)                            |
| **Handling**  | Parse normally; produce zero symbol records; file appears in the index with 0 symbols |

---

## EC-12: Files with Syntax Errors

| Property      | Value                                                                                                                                                                                                                  |
| :------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Affects**   | M2 — tree-sitter parsing                                                                                                                                                                                               |
| **Risk**      | Medium — one bad file should not block indexing of all others                                                                                                                                                          |
| **Detection** | tree-sitter returns a tree with `ERROR` nodes                                                                                                                                                                          |
| **Handling**  | Parse the file; extract any valid symbols from partial AST; store a parse error flag on the file record; log at WARN level with the error location; continue indexing other files; report error count in index results |

---

## EC-13: Non-UTF-8 Encoded Files

| Property      | Value                                                                                                                             |
| :------------ | :-------------------------------------------------------------------------------------------------------------------------------- |
| **Affects**   | M2 — tree-sitter parsing                                                                                                          |
| **Risk**      | Medium — tree-sitter expects UTF-8 input; other encodings (UTF-16, ISO-8859-1) could cause parse failures                         |
| **Detection** | Attempt UTF-8 decode; detect BOM for UTF-16 LE/BE                                                                                 |
| **Handling**  | Attempt UTF-8 decode; if file has UTF-16 BOM, attempt conversion to UTF-8; if decode fails, skip the file with a WARN log message |

---

## EC-14: Shebang Files Without Extension

| Property      | Value                                                                                                                           |
| :------------ | :------------------------------------------------------------------------------------------------------------------------------ |
| **Affects**   | M1 — File discovery, M2 — tree-sitter parsing                                                                                   |
| **Risk**      | Low — CLI scripts (e.g., `bin/cli` with `#!/usr/bin/env node`) may have no `.ts`/`.js` extension                                |
| **Detection** | Check file's first line for shebang (`#!`) with known interpreters (node, ts-node, deno)                                        |
| **Handling**  | Optionally add shebang-detected files to the parse queue (Phase 2); for MVP, skip them since they lack the configured extension |

---

## EC-15: File Deleted Between Discovery and Parse

| Property      | Value                                                                                                       |
| :------------ | :---------------------------------------------------------------------------------------------------------- |
| **Affects**   | M2 — tree-sitter parsing                                                                                    |
| **Risk**      | Low — race condition between directory scan and file read                                                   |
| **Detection** | `ENOENT` error when attempting to read the file for parsing                                                 |
| **Handling**  | Catch `ENOENT`; log at DEBUG level; skip the file; continue indexing; the file will be omitted from results |

---

## Risk Heatmap

```
                    Likelihood
               Low      Medium     High
     High   [EC-03]   [EC-01]   [EC-04]
            [EC-12]   [EC-08]
Impact
     Medium [EC-05]   [EC-02]   [EC-09]
            [EC-10]   [EC-07]
            [EC-14]   [EC-13]
     Low    [EC-11]   [EC-06]   [EC-15]
```

## Handling Strategy Summary

| Strategy            | Edge Cases                                                                                                                  |
| :------------------ | :-------------------------------------------------------------------------------------------------------------------------- |
| **Skip + Log**      | EC-01 (binary), EC-06 (outside root), EC-07 (permission), EC-10 (empty), EC-13 (encoding), EC-14 (shebang), EC-15 (deleted) |
| **Skip + Warn**     | EC-03 (large files), EC-12 (syntax errors)                                                                                  |
| **Resolve + Index** | EC-02 (symlinks), EC-05 (BOM)                                                                                               |
| **Guard + Reject**  | EC-04 (large project), EC-08 (concurrent)                                                                                   |
| **Flag + Re-index** | EC-09 (staleness)                                                                                                           |
| **Handle Normally** | EC-11 (comments only)                                                                                                       |
