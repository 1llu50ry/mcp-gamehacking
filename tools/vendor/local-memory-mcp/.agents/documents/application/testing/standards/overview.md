# Standards Module — Testing Overview

> Scope: `src/mcp/tools/standard*.ts`, table `coding_standards` + `standard_vectors` (384-dim) · Canonical: [../../../testing.md](../../../testing.md)

## Strategy

Coding standards are a normative catalog with global-vs-scoped visibility (`is_global` flag). Unlike memories (episodic knowledge) or tasks (workflow FSM), standards are prescriptive and durable — they survive across tasks and are enforced via pre-implementation hydration (S1) and post-implementation review. Testing centers on three concerns:

1. **Scoping predicate correctness** — `((owner=? AND repo=?) OR is_global=1)` never leaks scoped rows cross-repo nor hides global rows from unauthorized scopes.
2. **Tag and language filtering** — `language`, `stack`, `tags`, and inline `key:value` extraction in `query` (via `src/mcp/utils/query-tags.ts`) narrow results without tokenization artifacts; unknown keys stay as free-text.
3. **Single-rule-per-entry contract** — `name` (3–255), `content` (10 or more chars), `tags` (at least 1), `metadata` are required; `parent_id` hierarchy and `is_global` promotion behave atomically; `WriteLock` serializes mutations.

Key risks: global leakage (scoped row visible globally), tag filter injection (`language:php` leaking into FTS), stale `is_global` precedence after update, duplicate-code insertion under concurrent writes, and `standard_vectors` orphaning on delete (CASCADE). The vector queue (`Xenova/all-MiniLM-L6-v2`, 384-dim) re-enqueues on content change with async outbox semantics (migration v9, `MCP_RUNTIME_PROFILE` `full`/`balanced`/`minimal`).

This is a lookup and reference module with no FSM — lifecycle is `CREATE` → `UPDATE` → `DELETE` with vector re-enqueue on content change. Every change ships its test in the same commit (review-blocking per `development-quality.md`).

## Pyramid

| Layer       | Marker                  | Focus                                                                                        | Example                                                | Share |
| :---------- | :---------------------- | :------------------------------------------------------------------------------------------- | :----------------------------------------------------- | :---- |
| Unit        | `*.test.ts`             | Predicate builder, tag and language filter parsing, `is_global` guard, `parent_id` hierarchy | `src/mcp/tests/standard.read.test.ts` pure helpers     | 70%   |
| Integration | `*.integration.test.ts` | Tool route → store: `standard-write` → `standard-read` round-trip with scoping matrix        | `createTestStore()` plus `is_global` true/false matrix | 22%   |
| E2E         | `*.e2e.test.ts`         | Agent onboarding: load standard by tag, apply to generated code, acknowledge                 | Full `standard-read` → code generation flow            | 6%    |
| Perf        | `*.perf.test.ts`        | List pagination at scale (hundreds of standards) plus vector re-enqueue throughput           | `standard-read` with `limit` and `offset` stress       | 2%    |

Ratio target reflects heavy unit coverage for predicate logic with a thin but mandatory scoping integration layer — the `is_global` predicate is the critical gate (STD-C-03). End-to-end tests prove the S1 hydrate → implement → `standard-write` refinement loop converges. Perf asserts truncation and vector re-enqueue latency, not exact milliseconds.

## Risk Register

| Risk                               | Likelihood | Impact   | Mitigation in tests                                    |
| :--------------------------------- | :--------- | :------- | :----------------------------------------------------- |
| Scoped row visible globally        | Medium     | Critical | STD-C-03: global plus scoped matrix, cross-owner reads |
| Tag injection into FTS             | Low        | Medium   | Language and tag filter fuzzing (STD-C-04, STD-C-05)   |
| Duplicate `code` under concurrency | Low        | High     | Chaos STD-C-15: parallel writes with same tag          |
| Vector orphan after CASCADE        | Low        | Medium   | STD-C-08: delete cascades to `standard_vectors`        |
| Stale `is_global` precedence       | Low        | Medium   | Update then read matrix with both predicates           |

## Fixtures

- **Store**: `createTestStore()` in-memory SQLite; `coding_standards` table with `is_global`, `tags`, `language` columns plus `standard_vectors` child table (CASCADE on delete). Migrations auto-run in `SQLiteStore` constructor. No real `storage/` touch on disk.
- **Seeding**: `standard-write{name,content,tags,metadata,is_global}` — mix of `is_global:true` (visible without scoping) and `is_global:false` with explicit `owner` and `repo` for matrix tests. Bulk seeding via `standards[]` for scale tests; deterministic names like `STD-001`.
- **Shared fixtures**: `src/mcp/tests/fixtures/` subject-mirrored; a fixture is checked-in and used by at least two tests (for example normative catalog snapshot). Single-test fixtures are inline or next to the test.
- **Temp file system**: If disk is needed, use `fs.mkdtemp(os.tmpdir())` and clean in `afterAll`. Never write into `src/` or repository tree (verified pattern: `src/mcp/tests/codebase-index/mcp-tools.integration.test.ts`).
- **Isolation**: Fresh store per test file (`beforeAll`); per-test rows are fresh inserts. Pool `forks` required for `better-sqlite3` ESM. No shared mutable state across files; each file closes its store in `afterAll`.
- **Inline tags**: `query` supports `key:value` auto-extraction (`language:php`, `tag:a,b`, `stack:svelte`) via `src/mcp/utils/query-tags.ts`; tags are stripped from residual query before FTS to avoid `language:php` tokenization issues.
- **Helpers**: Small helpers `seedStandard({name, content, tags})` keep seeding deterministic; co-locate helpers with the test file, not in a shared global.

## Coverage

- **Floors**: `lines 70 / statements 70 / functions 70 / branches 60` — global, via `include: ["src/**/*.{ts,tsx}"]` with `provider: v8` (`vitest.config.ts`). Floors apply to every matched file regardless of scoped run shape.
- **Gated**: `coverage.enabled=false` until REFACTOR-TST-013; evaluate with `npm run test -- --coverage` (exits 1 below floor by design; artifacts still written to `coverage/coverage-final.json` + html and text reports). Until then, coverage failures are non-blocking.
- **Priority**: (1) Scoping predicate `((owner=? AND repo=?) OR is_global=1)` — STD-C-03 is the non-leakage gate. (2) Tag, language, and stack filters plus inline extraction. (3) CRUD validation (required fields, `code` uniqueness). (4) Bulk `standards[]` plus hierarchy `parent_id`.
- **Running**: `npx vitest run src/mcp/tests/standard*.test.ts` · `npm run test:unit` (`--project unit`) · `npm run test -- --coverage` · `npm run type-check` (`tsc` + `tsconfig.test.json` + `svelte-check`).
- **Inventory**: Server suites live in `src/mcp/tests/` mirroring `src/mcp/tools/`; 157 files total (unit 141 / integration 13 / end-to-end 2 / perf 1). See [../../../testing.md](../../../testing.md) §6–7 for partition and run recipes.

## Conventions

- Paths: `src/mcp/tests/standard*.test.ts` mirroring `src/mcp/tools/standard*.ts`. One subject maps to one file unless split by marker (unit and integration are separate files).
- Every function and route has at least one positive and one negative case (review-blocking per `development-quality.md` §1).
- No `snake_case` filenames; markers are suffixes (`*.integration.test.ts` etc.); `// @vitest-environment jsdom` only when DOM is touched — never for standards.
- Type-check gate: `npm run type-check` includes `tsconfig.test.json` + `svelte-check` — green tests do not imply type correctness after file splits (see [../../../testing.md](../../../testing.md) §8).
- Formatting: tabs, double quotes, `printWidth: 120` (Prettier). `allowScripts` allowlist is load-bearing for native modules.

## Execution

```bash
bash scripts/copy-grammar-wasm.sh
npx vitest run src/mcp/tests/standard*.test.ts
npm run test:unit
npm run test -- --coverage
npm run type-check
```

## Links

- Standard: [../../../testing.md](../../../testing.md) §1–9
- API: [../../api/standards/api-standards.md](../../api/standards/api-standards.md) · Tool definitions: `src/mcp/types/tool-definitions/`
- Module: [../../modules/standards/overview.md](../../modules/standards/overview.md) · Manifest: [../../modules/manifest.md](../../modules/manifest.md)
- Global vs scoped: `src/mcp/prompts/server/instructions.md` § Global vs scoped tables + ADR-008
- Constants: `src/mcp/utils/constants.ts` · Query tags: `src/mcp/utils/query-tags.ts`

## Changelog

| Date | Change |
| :--- | :----- |
| 2026-09-07 | Initial testing overview for standards (predicate + tag filters + CASCADE) |
