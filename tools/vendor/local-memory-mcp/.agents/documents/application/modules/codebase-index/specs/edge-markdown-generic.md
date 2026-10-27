# Decision: Markdown + Generic Fallback — No Reference-Edge Emission (TASK-313)

> **Status:** Accepted · **Date:** 2026-08-09 · **Phase:** Codebase Index Phase 1.1, Wave 1
> **Task:** [TASK-313] — decision doc, no code logic. Depends on TASK-299 (foundation, v23 contract).

## Decision

Both remaining non-emitting visitors are **declarations-only** and MUST NOT emit reference edges:

| Visitor              | Location                                            | `extractReferences`                   | Reference edges |
| :------------------- | :-------------------------------------------------- | :------------------------------------ | :-------------- |
| `MarkdownVisitor`    | `src/mcp/codebase-index/parser/markdown-visitor.ts` | **absent** (optional chaining → `[]`) | **NO**          |
| `GenericTextVisitor` | `src/mcp/codebase-index/parser/generic-visitor.ts`  | **absent** (optional chaining → `[]`) | **NO**          |

Default NO-OP chosen per spec; no code change.

## Rationale

### Markdown (`parser/markdown-visitor.ts`, 95 lines)

- Visitor emits **headings (H1–H6) and fenced code blocks only** (`code-block:<lang>` symbols). It does **not** parse code inside fences — fences are captured as symbols, their content is never traversed.
- **Rejected "cheap win" — markdown link edges:** links are URIs / relative file paths / anchor fragments, i.e. **content, not code symbols**. Name-based resolution (ADR-002) matches a `symbolName` against `codebase_symbols`; a link target like `./docs/api.md` or `#section` never resolves to an indexed symbol, so every emitted edge would be `targetSymbolId=NULL`, `targetFile=NULL` dead weight. TRACE-by-symbol would never match them either. Not minimal, not useful → **rejected**.
- Markdown import-like semantics do not exist (no module/import binding to model as `import` edge).

### Generic — `parser/language-routing.ts:371-377` (`buildGenericCatchAll` → `GenericTextVisitor`)

- Catch-all covers ~80 extensions with **no grammar knowledge** (regex line scanning only). It cannot distinguish a call/instantiation/heritage site from any other identifier usage — emitting edges would be noise.
- Note: `matchDeclaration` (generic-visitor.ts:103-176) explicitly **skips** `import|include|require|from|using|package` lines — so no import-family provenance either.
- → NO edges. Consistent with the contract: `extractReferences` optional (language-visitor.ts:106-119), absent visitor → `[]` via `visitor.extractReferences?.(...) ?? []` (parser-pool.ts:221,280).

## Verification (no code changed → no regression surface)

- `npx vitest run` on scoped files: `reference-emission.test.ts` + `parser.test.ts` + `architecture.test.ts` → **3 files / 100 tests passed, EXIT 0** (baseline green; markdown/generic paths covered by parser/architecture/code-search suites).
- All other Wave 1 visitors (14 languages) now emit edges — `grep extractReferences` confirms 13 visitor classes implement it (TS visitor covers TS/TSX/JS/JSX), exercised by reference-emission.test.ts (TASK-301…312) — **untouched** by this task.

## Doc follow-ups (belongs to later docs task, TASK-315)

1. [Codebase-Index wiki page](https://github.com/vheins/local-memory-mcp/wiki/features/Codebase-Index) matrix: currently declares all 15 languages `✅ Full` with no reference-edge differentiation. After W1: **14 background languages emit edges; Markdown + generic emit declarations only** — add a per-language "reference edges" note/column.
2. [Codebase-Index wiki page](https://github.com/vheins/local-memory-mcp/wiki/features/Codebase-Index) §codebase_references table still documents **v21** (8 columns) — schema is now **v23** (10 columns: `target_file`, `target_symbol_id`).
3. [Codebase-Index wiki page](https://github.com/vheins/local-memory-mcp/wiki/features/Codebase-Index) "Known Limitations" still claims import/inheritance chains are "not resolved" — stale post-W1 (edges land for 14 languages).
4. `language-visitor.ts:110` JSDoc says "only TS and PHP implement it today" — stale post-W1 (all 14 do); comment/file is code, so report-only per scope.
5. `parser/markdown-visitor.ts` — if fenced-code _symbol_ extraction (declarations inside fences) is ever desired, that is a separate feature (nested parse), explicitly out of Wave 1 scope.
