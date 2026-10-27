# Standards Catalog — Test Scenarios

> Module: `standards` · Tools: `standard-read`, `standard-write`, `standard-delete` · Table: `coding_standards` + `standard_vectors` (384-dim, CASCADE) · Contract: `src/mcp/prompts/server/instructions.md` § Global vs scoped

## Preconditions

- Store: `createTestStore()` in-memory SQLite; migrations auto-run. Never touch `storage/memory.db` on disk.
- Pool: `forks` (required for `better-sqlite3` ESM). One fresh store per test file (`beforeAll`); per-test rows are fresh inserts.
- Required on create: `name` (3–255), `content` (10 or more chars), `tags` (at least 1), `metadata`. Optional: `language`, `stack`, `context`, `parent_id`, `is_global`.
- Inline tags: `query` supports `key:value` auto-extraction (`language:php`, `tag:a,b`, `stack:svelte`) via `src/mcp/utils/query-tags.ts` — tags stripped before FTS so `language:php` does not split.
- Predicate: `((owner=? AND repo=?) OR is_global=1)` — STD-C-03 is the critical visibility gate.
- Owner and repo: derived from `git remote -v` (`vheins/local-memory-mcp`); match session defaults used by MCP tools.

## Matrix

| ID       | Scenario                                                | Input                                                                                                                                                         | Expected                                                                                       | Type     |
| :------- | :------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------- | :------- |
| STD-C-01 | Create global standard                                  | `standard-write{name:"No any",content:"Forbid any type, use unknown instead.",tags:["ts"],metadata:{},is_global:true}`                                        | Row inserted with `is_global=1`, `code` assigned, visible without `owner` and `repo` filter    | positive |
| STD-C-02 | Create repo-scoped standard                             | `standard-write{name:"API naming",content:"Use kebab-case for API routes.",tags:["api"],metadata:{},is_global:false,owner:"vheins",repo:"app"}`               | Row with `is_global=0`, `owner=vheins, repo=app`; not visible from `(other, other)`            | positive |
| STD-C-03 | Global visible across all scopes                        | Seed 1 global plus 1 scoped to `vheins/app`; `standard-read{query:"any",owner:"other",repo:"other"}`                                                          | Global returned; scoped not returned                                                           | positive |
| STD-C-04 | Tag filter `tag:ts` narrows results                     | Seed standards with `tags=["ts"]` and `tags=["php"]`; `standard-read{query:"tag:ts"}`                                                                         | Only `ts`-tagged rows returned                                                                 | positive |
| STD-C-05 | Language filter narrows results                         | `standard-read{query:"language:php"}` (auto-extracted `key:value` tag)                                                                                        | Only `language=php` rows returned; residual query stripped correctly                           | positive |
| STD-C-06 | Bulk create via `standards[]`                           | `standard-write{standards:[{name:"A",content:"Rule A content here",tags:["a"],metadata:{}},{name:"B",content:"Rule B content here",tags:["b"],metadata:{}}]}` | Both inserted; individual `code` values returned                                               | positive |
| STD-C-07 | Update existing standard by `code`                      | `standard-write{code:"STD-001",content:"Updated content for STD-001 rule"}`                                                                                   | Row updated; `updated_at` bumped; other fields unchanged                                       | positive |
| STD-C-08 | Delete by `code` cascades vectors                       | `standard-delete{code:"STD-001"}`                                                                                                                             | Row removed; `standard_vectors` CASCADE deleted; subsequent `standard-read` does not return it | positive |
| STD-C-09 | Create without `name` rejected                          | `standard-write{content:"Valid content here",tags:["ts"],metadata:{}}` (no `name`)                                                                            | `VALIDATION_ERROR`; `details` cites `name` required (3–255 chars)                              | negative |
| STD-C-10 | Content too short rejected                              | `standard-write{name:"Xyz",content:"short",tags:["ts"],metadata:{}}` (`minLength 10`)                                                                         | `VALIDATION_ERROR`; `details` cites `content` length at least 10                               | negative |
| STD-C-11 | Update non-existent `code` rejected                     | `standard-write{code:"STD-9999",content:"Updated content for missing"}`                                                                                       | `NOT_FOUND` envelope (`code:"NOT_FOUND"`)                                                      | negative |
| STD-C-12 | SQL injection in `query` neutralized                    | `standard-read{query:"\" OR 1=1 --"}`                                                                                                                         | Treated as literal tokens; no table dump; no SQLite error                                      | security |
| STD-C-13 | Cross-site scripting payload in `content` stored safely | `content:"<img onerror=alert(1)>"`                                                                                                                            | Stored verbatim; `standard-read` returns verbatim; dashboard renders escaped; no execution     | security |
| STD-C-14 | Scope tampering not escalatable to global               | Attempt `standard-write{code:"SCOPED-1",is_global:true}` or query scoped row from wrong `owner`                                                               | Not promoted, not visible as global to unauthorized scope; second query returns empty          | security |
| STD-C-15 | Chaos: concurrent writes to same tag                    | 20 parallel `standard-write` with `tags:["ts"]` under same scope                                                                                              | All 20 inserted with unique `code`; no duplicate-code race; store consistent                   | chaos    |
| STD-C-16 | Chaos: read during bulk delete                          | Parallel `standard-delete{codes:[...]}` plus 50 `standard-read` loops                                                                                         | No WAL deadlock; readers eventually see deletions; no `SQLITE_BUSY`                            | chaos    |

## Helpers

- `seedStandard({name, content, tags, is_global, owner, repo})` — wraps `standard-write` with deterministic scoping; reuse across tests to keep seeding uniform.
- `createTestStore()` — in-memory SQLite factory from `src/mcp/storage/sqlite.ts`; call in `beforeAll`, close in `afterAll`; pool `forks` required.
- Use deterministic `code` values (`STD-001`, `STD-002`) for update and delete tests so assertions are stable across runs.
- Temp helpers stay co-located with the test file; shared fixtures live under `src/mcp/tests/fixtures/` and are used by at least two tests.
- Keep helper signatures aligned so `seedStandard` can be reused without duplication across suites.

## Environment

| Variable                     | Default | Relevance                                                             |
| :--------------------------- | :------ | :-------------------------------------------------------------------- |
| `MCP_RUNTIME_PROFILE`        | `full`  | Standards catalog behaves identically across all profiles             |
| `ACTION_LOG_MAX_ROWS`        | `10000` | Audit log cap; mutations emit action log rows                         |
| `WAL_CHECKPOINT_INTERVAL_MS` | `10000` | WAL checkpoint cadence; concurrent delete plus read must not deadlock |
| `VECTOR_CANDIDATE_CAP`       | `100`   | Hybrid search candidate ceiling for `standard-read` ranking           |
| `DEFAULT_BATCH_SIZE`         | `100`   | Rows per DB transaction for bulk `standards[]`                        |

## Notes

- **Harness**: `createTestStore()` WAL plus `forks` pool. Temp file system via `fs.mkdtemp(os.tmpdir())` cleaned in `afterAll`; never write into `src/` or repository tree.
- **Vectors**: `standard_vectors` child table deletes via CASCADE when parent `coding_standards` row is removed; STD-C-08 proves no orphan remains.
- **Commit**: Spec requires `name`, `content`, `tags`, `metadata` — positives STD-C-01, STD-C-02, STD-C-06, STD-C-07 exercise the required-field contract.
- **WriteLock**: All mutations serialized under `WriteLock`; concurrent writes in STD-C-15 must not produce duplicate `code`.
- **S1 hydrate**: `standard-read(query)` is the mandatory pre-implementation gate — STD-C-04 and STD-C-05 prove tag and language filtering works under the gate.
- **Security**: STD-C-12 validates FTS tokenizer treats injection as literal; STD-C-14 validates scoping cannot be escalated by toggling `is_global` on an existing row.

## Execution

```bash
bash scripts/copy-grammar-wasm.sh
npx vitest run src/mcp/tests/standard*.test.ts
npm run test:unit
npm run test -- --coverage
npm run type-check
```

## Links

- Overview: [overview.md](overview.md)
- Standard: [../../../testing.md](../../../testing.md) §1–9
- API: [../../api/standards/api-standards.md](../../api/standards/api-standards.md)
- Constants: `src/mcp/utils/constants.ts` · Query tags: `src/mcp/utils/query-tags.ts`
- Module: [../../modules/standards/overview.md](../../modules/standards/overview.md)

## Changelog

| Date | Change |
| :--- | :----- |
| 2026-09-07 | Initial standards catalog scenarios (global vs scoped + CRUD + chaos) |
