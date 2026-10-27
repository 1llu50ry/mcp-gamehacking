# FTS5 Tokenizer Evaluation — `unicode61` (prefix `*`) vs `trigram` for `memories_fts`

> **Decision gate** — TASK-295 (phase `fts5-trigram-eval`, P5 of `.agents/documents/optimization/optimization-memories-fts5.md` §9).
> **Question:** keep `unicode61` (+ permanent LIKE fallback) or switch `memories_fts` to the fts5 `trigram` tokenizer?
> **Verdict: KEEP `unicode61`. NO-GO for `trigram` on measured evidence.**
>
> Harness: `scripts/bench/fts-trigram-eval.mjs` · Raw JSON: `./fts5-trigram-eval-results.json` (this directory)
> Env: Node v24.18.0 · better-sqlite3 12.9.0 · SQLite **3.53.0** · page size 4096 B

---

## 1. Method

Two identical external-content FTS5 tables (mirroring `v10-memories-fts` exactly — `content='memories'`, `content_rowid='id'`, same WAL/NORMAL/busy-timeout pragmas as `src/mcp/storage/sqlite.ts`), one `tokenize='unicode61'`, one `tokenize='trigram'`, backfilled from the **same** base table.

Queries are evaluated twice per tokenizer:

- **prod shape** — `buildFtsMatchQuery(raw)` (production `src/mcp/utils/fts.ts`): every whitespace term gets a `*` prefix, phrases kept verbatim, `AND`, cap 8. This is the shape production would run today with either tokenizer.
- **trigramRaw shape** — same expression with all `*` stripped. Rationale: the trigram tokenizer matches ≥3-char substrings natively, so the production `*` suffixing is a **no-op for trigram** (measured identical: see §5). A real trigram switch would have to _drop_ the `*`; trigramRaw is that shape.

**Recall metric** (FTS-layer, pre-fallback): oracle = the row set the permanent LIKE fallback would return, per query semantics — single term → `LIKE %term%`; phrase `"a b"` → `LIKE %a b%`; multi-word `a b c` → intersection of per-term `LIKE %a% ∩ %b% ∩ %c%` (matches FTS `AND` semantics; the literal `%a b c%` would be near-empty). `recall@k = |top-k MATCH rows ∩ oracle| / |oracle|` at `k = 10` (searchByRepo default limit) and `k = 50` (between the hybrid `FTS_CANDIDATE_CAP=100` and dashboard 50). When `|oracle| > k` recall is capped at `k/|oracle|` — the `found@50` and `oracle` columns make the cap visible.

**Index size** measured as whole-file DB delta (base corpus only vs base+unicode vs base+trigram, WAL checkpointed) because SQLite exposes no reliable per-table page count. Measured on **two corpora** (see §2) to bound the range.

Latency: prepared statements, warm, `p50/p95/p99` over 300 iterations (8k corpus) / 120 (50k), `LIMIT 50`, vs the LIKE baseline.

## 2. Corpus

8000 rows (and a 50k scale run), deterministic (mulberry32 seeds → identical reruns):

- **Repetitive recall corpus** (used for recall + latency + the size upper bound): 16 hand-written EN sentences + 10 Indonesian + 10 CJK + 6 mixed EN/CJK/ID + 13 technical phrases (libsql, better-sqlite3, tree-sitter, supabase, zod, esbuild…), each drawn per row → every sentence recurs ~150×, giving non-trivial LIKE oracles. Plus prefix-family stems (`vector→vectorized/vectorization…`, `memory→memories…`, `search→searches/searchable…`, …) for deterministic token-initial recall, mid-word probes (`orkspace`, `ntent`, `emories`, `obust`, `ential`), per-row unique markers, a `café` row (diacritics) and an uppercase `WORKSPACE-BINARY` row. Content ~250 chars/row, tags from a 14-tag pool.
- **Unique-content corpus** (size lower bound): each row = ~30–50 words sampled from a ~900-token pool + one CJK sentence → distinct trigrams, short posting lists (closer to real memory uniqueness).

## 3. Metrics

### 3.1 Recall — trigram vs unicode61 (8k corpus, FTS-layer)

| class               | oracle | u@10 | u@50      | t@10 | t@50      | trRaw@50 | found@50 (u/t) | winner                       |
| ------------------- | ------ | ---- | --------- | ---- | --------- | -------- | -------------- | ---------------------------- |
| latin-token-initial | 27,664 | 0.5% | 2.3%      | 0.5% | 2.3%      | 2.3%     | 400/400        | tie                          |
| latin-midword       | 2,100  | 0.0% | 0.0%      | 3.7% | **18.3%** | 18.3%    | 0/250          | **trigram +18.3pp**          |
| tech-ident          | 1,016  | 6.5% | 32.3%     | 6.5% | 32.3%     | 32.3%    | 300/300        | tie                          |
| hyphen              | 306    | 5.7% | 27.1%     | 6.0% | **30.4%** | 30.4%    | 100/100        | trigram +3.3pp               |
| cjk (2-char)        | 1,317  | 2.5% | **12.4%** | 0.0% | 0.0%      | 0.0%     | 100/0          | **unicode61 +12.4pp**        |
| cjk-midrun (2-char) | 132    | 0.0% | 0.0%      | 0.0% | 0.0%      | 0.0%     | 0/0            | tie (both 0)                 |
| cjk-run3 (≥3-char)  | 412    | 1.8% | 8.9%      | 5.6% | **27.9%** | 27.9%    | 50/100         | **trigram +19.0pp**          |
| cjk-3char (mid-run) | 294    | 0.0% | 0.0%      | 6.9% | **34.4%** | 34.4%    | 0/100          | **trigram +34.4pp**          |
| short (<3 chars)    | 16,893 | 0.4% | **1.9%**  | 0.0% | 0.0%      | 0.0%     | 250/0          | **unicode61 +1.9pp**         |
| case                | 4,435  | 0.5% | 2.4%      | 0.5% | 2.4%      | 2.4%     | 100/100        | tie                          |
| diacritic           | 0      | —    | —         | —    | —         | —        | 50/0           | **unicode61** (LIKE finds 0) |
| id (Indonesian)     | 2,241  | 4.1% | 20.7%     | 4.1% | 20.7%     | 20.7%    | 250/250        | tie                          |

The 50k run reproduces the same pattern (midword +2.7pp trigram, cjk 2.1% vs 0% unicode, cjk-3char +5.7pp trigram, short 0.3% vs 0%).

**Read**: trigram wins exactly the two classes it exists for — **Latin mid-word substrings** and **≥3-char CJK substrings** — and it _loses_ the two classes that dominate real CJK usage: **2-char CJK** (the standard CJK word length) and **<3-char terms**. Both losses go to 0 rows (LIKE fallback).

### 3.2 Index size

| corpus                      | unicode61  | trigram    | delta     |
| --------------------------- | ---------- | ---------- | --------- |
| 8k repetitive (upper bound) | 868 KiB    | 6,032 KiB  | **×6.95** |
| 8k unique (realistic)       | 1,848 KiB  | 10,320 KiB | **×5.58** |
| 50k repetitive              | 6,032 KiB  | 28,868 KiB | ×4.79     |
| 50k unique                  | 11,520 KiB | 58,984 KiB | ×5.12     |

Vocab (8k, fts5vocab `instance`): unicode61 **142,333** tokens / 16,333 terms; trigram **931,299** tokens / 2,984 terms — **6.5× the token count** for ~5× the bytes.

> **Design-doc correction:** `optimization-memories-fts5.md` §2.3 estimated trigram "roughly doubles index size". Measured real-world delta is **×4.8–7.0** (×5.1–5.6 on the realistic unique corpus). This is the single strongest argument against switching.

### 3.3 Latency — p50/p95 (ms), 8k corpus (300 iters), 50k in brackets (120 iters)

| shape                                        | unicode61               | trigram                     | trigramRaw | LIKE baseline |
| -------------------------------------------- | ----------------------- | --------------------------- | ---------- | ------------- |
| single-broad `sqlite`                        | 2.23 / 2.83 [11.5/13.7] | 3.35 / 4.40 [17.9/20.5]     | 3.14       | 0.34 [0.35]   |
| single-cjk `记忆`                            | 0.35 / 0.45 [1.23/1.74] | 0.02 / 0.03 [0.02/0.04]     | 0.01       | 0.72 [0.75]   |
| multi-and `vector embedding semantic search` | 1.99 / 2.39 [9.9/15.6]  | **5.74 / 6.79** [32.0/43.3] | 4.79       | 3.22 [20.6]   |
| phrase `"semantic search"`                   | 0.67 / 0.98 [2.8/4.8]   | 2.61 / 3.74 [11.2/15.7]     | 2.52       | 3.71 [21.9]   |
| short `e` (pathological)                     | 3.20 / 3.71 [18.5/22.7] | 0.05 / 0.07 [0.07/0.11]     | 0.01       | 0.15 [0.20]   |

Notes:

- **trigram is faster only when it matches nothing** (CJK 2-char and short queries → 0 rows → instant), and **slower on every query it actually answers** (multi-and ~3×, broad ~1.5×, phrase ~4×). Its fast rows all fall through to the LIKE fallback in production.
- LIKE is deceptively fast at 8k because dense hits short-circuit under `ORDER BY id LIMIT 50`; at 50k, sparse LIKE full-scans reach 20–22 ms (phrase, multi-and) where both FTS shapes are indexed and faster. FTS's latency win is at scale + sparse matches, not at small corpora.
- unicode61 short-query cost (`e*`, 3.2 ms → 18.5 ms at 50k) is a genuine weakness: production `buildFtsMatchQuery` has **no min-length guard**, so 1–2 char queries hit broad FTS sorts. A `LIKE`-first or min-length guard for terms <3 would fix this regardless of tokenizer.

### 3.4 <3-char corner (len 1/2/3) — explicit probe

| query (len) | LIKE oracle | unicode61 found@50 | trigram found@50 |
| ----------- | ----------- | ------------------ | ---------------- |
| `ui` (2)    | 1,947       | 50                 | **0**            |
| `go` (2)    | 1,230       | 50                 | **0**            |
| `ts` (2)    | 3,140       | 50                 | **0**            |
| `id` (2)    | 2,018       | 50                 | **0**            |
| `e` (1)     | 8,000       | 50                 | **0**            |
| `AI` (2)    | 558         | 0 (mid-word only)  | **0**            |

Trigram cannot index or query <3-char tokens — **every** 1–2 char query returns 0 rows and always falls back to LIKE. unicode61 covers token-initial short terms natively (`ui*`, `go*`, `ts*`, `id*`, `e*` all return rows). This is a broad FTS-layer coverage regression for common terms (`ui`, `AI`, `ts`, `go`, `id`, `fs`, …), insulated only by the LIKE fallback (which adds a full scan on top of the empty FTS call).

### 3.5 EXPLAIN QUERY PLAN (8k)

All MATCH shapes on both tokenizers use the FTS virtual-table index; LIKE is a full table scan:

```
single-broad "sqlite":
  unicode61: SCAN memories_fts_unicode VIRTUAL TABLE INDEX 0:M3
  trigram:   SCAN memories_fts_trigram VIRTUAL TABLE INDEX 0:M3
  LIKE:      SCAN memories                                    ← full table scan
multi-and "vector embedding semantic search":   (identical shape per tokenizer)
phrase "semantic search":                       (identical shape per tokenizer)
single-cjk "记忆":                               (identical shape per tokenizer)
```

The plan shape is identical between tokenizers; the measured latency gap comes from index internals (trigram posting lists are ~6.5× longer). Both avoid the LIKE full scan; the cost delta is inside the FTS index walk + bm25 sort of a larger candidate set.

## 4. CJK findings

| probe                  | len | LIKE oracle | unicode61  | trigram    | trigramRaw |
| ---------------------- | --- | ----------- | ---------- | ---------- | ---------- |
| `记忆` (run-initial)   | 2   | 266         | 50 (18.8%) | **0**      | 0          |
| `语义` (run-initial)   | 2   | 162         | 50 (30.9%) | **0**      | 0          |
| `向量` (mid-run)       | 2   | 463         | 0          | **0**      | 0          |
| `索引` (mid-run)       | 2   | 426         | 0          | **0**      | 0          |
| `理系` (mid-run)       | 2   | 132         | 0          | **0**      | 0          |
| `管理系统` (run tail)  | 4   | 132         | 0          | 50 (37.9%) | 50         |
| `数据库` (run-initial) | 3   | 280         | 50 (17.9%) | 50 (17.9%) | 50         |
| `理系统` (mid-run)     | 3   | 132         | 0          | 50 (37.9%) | 50         |
| `量搜索` (mid-run)     | 3   | 162         | 0          | 50 (30.9%) | 50         |

Conclusions, verified empirically:

1. **The dominant CJK query is 2 characters** (记忆, 向量, 语义, 索引 — standard CJK word length). On those, **trigram returns 0 rows** (min-3 rule). Switching to trigram does **not** fix the CJK case users actually type; it converts "unicode61 matches when the run starts with the term" into "nothing matches at all".
2. trigram's CJK win is confined to **≥3-char substrings** (mid-run `理系统`, `量搜索`), which are unusual CJK queries — and even those are only +19.0 to +34.4pp over an already-partial unicode61.
3. Both tokenizers fail 2-char mid-run CJK (`向量`, `索引`, `理系` → 0 rows) → those fall back to LIKE today and would continue to do so under trigram. **No tokenizer change removes the LIKE dependency for CJK.**

## 5. Other probes

- **`*` is a no-op for trigram**: prod shape vs trigramRaw are identical on every query (recall and latency). A trigram switch would require rewriting `buildFtsMatchQuery` to drop the `*` and add a min-3-char guard — the query builder is unicode61-shaped today.
- **Case**: SQLite 3.53's trigram is **case-insensitive for ASCII** (older SQLite was not) — `VECTOR*` and `vector*` both match lowercase content. Tie with unicode61.
- **Diacritics**: unicode61 folds `café → cafe` (`cafe*` finds 50 rows the LIKE oracle can't see); trigram and LIKE are byte-sensitive (`cafe*` finds 0). **unicode61 strictly better** for accented content.
- **Phrase queries**: trigram executes `"semantic search"` without error and is ~4× slower than unicode61 (2.6 vs 0.7 ms) — no correctness issue, slower index.

## 6. Recommendation + GO/NO-GO verdict conditions

### Verdict: **KEEP `unicode61`** (+ permanent LIKE fallback). **NO-GO** for switching `memories_fts` to `trigram` on measured evidence.

### Proposed GO/NO-GO gate (thresholds as a function of the measured numbers)

Switch to `trigram` **only if ALL four conditions hold**:

| #   | condition                                                     | threshold                                                 | measured                                                                                  | pass?                  |
| --- | ------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------- |
| G1  | index-size delta, realistic (unique) corpus                   | **≤ 2.5×**                                                | **×5.58** (8k) / **×5.12** (50k); ×4.79–6.95 across corpora                               | ❌ **FAIL**            |
| G2  | trigram recall ≥ unicode61 on the classes it exists for (@50) | **+10 pp** latin-midword, cjk-run≥3                       | midword **+18.3**, cjk-run3 **+19.0**, cjk-3char **+34.4**                                | ✅ pass                |
| G3  | no regression where unicode61 currently wins                  | trigram @50 **≥** unicode61 @50 on 2-char CJK and <3-char | cjk **0% vs 12.4%**, short **0% vs 1.9%**, diacritic **0 vs 50**                          | ❌ **FAIL**            |
| G4  | recall target is FTS-layer-only (fallback is free)            | —                                                         | LIKE full-scan is 3–22 ms at scale; every trigram-missed query pays FTS-empty + LIKE-scan | ❌ **FAIL** (not free) |

**G1 and G3 fail decisively** (measured ×5.1–7.0 index growth vs the ≤2.5× budget; and 2-char CJK + <3-char recall drops to 0). The "escalate to trigram if CJK recall is insufficient" path documented in `optimization-memories-fts5.md` §2.4/§7 is therefore **not the correct escalation**: trigram does not improve the CJK pattern that dominates (2-char words) — it eliminates it.

**What would change the verdict (GO)**: a hard, quantified product requirement for mid-word Latin substring recall _and_ ≥3-char CJK substring recall **without** the fallback, with an index budget of ≥5× and acceptance of (a) a `buildFtsMatchQuery` rewrite (drop `*`, min-3 guard, keep phrase), (b) a second query path because trigram-only misses 2-char CJK/short terms (a hybrid unicode61 + trigram pair is the only way to capture both — strictly more maintenance), and (c) being the only trigram table in the DB.

**Recommended non-switch improvements** (separate tasks, not this gate): add a min-length guard / `LIKE`-first path for terms <3 chars (kills the 18.5 ms `e*` at 50k), and evaluate a CJK-aware tokenizer (per-character or segmentation-based) if CJK recall is later measured insufficient — that, not trigram, is the targeted CJK fix.

## 7. Reproducibility

```bash
node scripts/bench/fts-trigram-eval.mjs                       # 8k corpus, 300 iters → canonical JSON
node scripts/bench/fts-trigram-eval.mjs --rows 50000 --iter 120   # scale run
node scripts/bench/fts-trigram-eval.mjs --json-out /tmp/r.json    # custom JSON path
```

Artifacts: harness `scripts/bench/fts-trigram-eval.mjs`; results `.agents/documents/analysis/fts5-trigram-eval-results.json`. No production code touched — the harness is standalone (isolated temp DB, mirrored pragmas, no migrations, no `src/mcp` edits, no tool registration).
