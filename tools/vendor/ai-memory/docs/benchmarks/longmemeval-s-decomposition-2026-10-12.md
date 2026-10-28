# LongMemEval-S retrieval decomposition (2026-10-12)

This report splits ai-memory's LongMemEval-S `hit@5` into its parts:
evidence the index never sees, ranking on evidence it does see, and
artifacts of the harness itself. It then records what the observation
stream, shipped in 3.0, recovered.

It publishes two kinds of number, and they answer different questions:

- **Pipeline** numbers run the shipped system end to end. Each haystack
  replays through `POST /hook/batch` at production cadence, the server builds
  its zero-LLM session pages, and `memory_query` ranks them. This is what a
  user of ai-memory gets.
- **Component** numbers skip capture. Each raw session is written as one page
  through `POST /admin/write-page`, so ranking sees the full text. This
  measures the ranker alone.

Every number below comes from the in-repo harness (`evals/`, see
[`evals/README.md`](../../evals/README.md)), with the flags shown.

## Provenance

Decomposition runs (2026-10-10 to 2026-10-11):

- server: `release/3.0` at `7dd6b2c2` (the binary reports 2.6.3), before the
  observation stream existed
- harness: `420a8556` (the instruments) and `31f515dc` (adds
  `--http-timeout-secs`); `release/3.0` carries the same `evals/` tree as
  `7a2c603d` and `8b797e08`
- dataset: `longmemeval_s` (sha256 `08d8dad4be43ee2049a22ff5674eb86725d0ce5ff434cde2627e5e8e7e117894`);
  where noted, `longmemeval_s_cleaned` (Hugging Face
  `xiaowu0162/longmemeval-cleaned` at `98d7416c24c778c2fee6e6f3006e7a073259d48f`,
  sha256 `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`)
- hardware: AMD Ryzen 9 7950X3D 16-Core (32 threads), about 90 GB RAM,
  Linux 7.2.5, rustc 1.95.0
- local model: all-MiniLM-L6-v2
- questions: the 470 answerable questions (30 abstention questions excluded),
  or a stratified sample: `--stratify N` takes the first N questions of each
  of the six types (single-session-preference has only 30)

Pipeline re-runs (2026-10-13, corrected harness): the FTS full-set pipeline
with reachability, both date-prefix ablations and the strat-230 local
pipeline-vs-whole-session A/B, on `release/3.0` at `7e08baa7` with
`AI_MEMORY_RETRIEVAL__OBSERVATION_STREAM=false` on every arm (see "Harness
correction").

Observation-stream runs (2026-10-13, corrected harness):

- build: the shipped ranking, `41793120` on top of `25594224`, for the
  full-set FTS and local A/Bs; `release/3.0` at `7e08baa7` for the first
  version. The stream is on by default in both, so the baseline side sets
  `AI_MEMORY_RETRIEVAL__OBSERVATION_STREAM=false` and the candidate side
  `=true`
- harness: `7e08baa7`, which replays each question's sessions under their own
  session ids (see "Harness correction")
- dataset, hardware and model as above (original `longmemeval_s` file)

Latency and ingest throughput were measured while two or three runs shared
the host. Accuracy is unaffected, because each run starts its own server on
its own data dir.

## Pipeline and component numbers (hit@5)

| What is measured | FTS (zero-LLM) | Local embeddings |
|---|---|---|
| Grep over whole raw sessions, no server (`--engine grep`) | 0.887 (470; 417/470 on both dataset files) | n/a |
| **Pipeline**, shipped 2.6 capture and ranking (`--ingest hooks`) | **0.662** (470) | 0.787 (strat-230); 0.800 (strat-120) |
| Pipeline with the per-turn date prefix removed (strat-120) | 0.658 → 0.792 | 0.800 → 0.892 |
| Pages holding only the text capture keeps (`--ingest captured-session`) | 0.968 (470) | 0.943 (strat-230) |
| **Component**, whole raw sessions (`--ingest whole-session`) | **0.972** (470, both dataset files) | 0.957 (strat-230) |

Strat-230 is `--stratify 40` and strat-120 is `--stratify 20`. The published
full-set local pipeline number is 0.815
([`retrieval-ab-r2.md`](retrieval-ab-r2.md)); a full local A/B takes about
3.5 hours on this host, so the local column uses samples.

Other FTS metrics on all 470 questions:

| | pipeline | captured-session pages | whole-session pages |
|---|---|---|---|
| hit@1 | 0.511 | 0.887 | 0.885 |
| hit@10 | 0.687 | 0.979 | 0.977 |
| recall@5 | 0.533 | 0.918 | 0.922 |
| context tokens, mean | 367 | 502 | 505 |
| query p50 / p95 ms | 14 / 95 | 27 / 99 | 28 / 93 |

FTS `hit@5` per slice, pipeline → whole-session: knowledge-update 0.764 →
1.000, multi-session 0.562 → 0.975, single-session-assistant 0.804 → 1.000,
single-session-preference 0.533 → 0.900, single-session-user 0.688 → 1.000,
temporal-reasoning 0.654 → 0.945. Whole-session pages gained about 146
questions and lost 1 (the pipeline row is from the corrected harness, the
whole-session row from the original run; whole-session ingest does not use
session ids, so it is unaffected).

Confirmation runs on strat-120 reproduce each effect: whole vs pipeline FTS
+0.308 (+38/−1) against +0.310 on the full set; captured vs pipeline FTS
+0.300 (+38/−2); local whole vs pipeline +0.142, against +0.170 (+42/−3) on
strat-230 with the corrected harness.
FTS returned identical per-question results across repeated runs.

With the evidence in the index, the same FTS ranks an evidence session into
the top 5 for 97.2% of questions; through capture it managed 66.2%. Most of
the gap is therefore in capture.

## Reachability: the evidence was not on the page

`--reachability` checks, for each answer-bearing turn (the dataset's
`has_answer` flag, 886 turns after removing repeated session ids), whether it
survives into each surface that ranking reads. A turn counts as reachable when
at least half of its distinctive tokens are on the surface. Distinctive tokens
are content words, lowercased, of three or more characters or containing a
digit, minus stopwords, that occur in at most 3 sessions of the question's
haystack. The ceiling is the share of questions with at least one reachable
evidence turn.

Pipeline, FTS, all 470 questions:

| slice | evidence turns | session page: turn / ceiling | observations: turn / ceiling |
|---|---|---|---|
| overall | 886 | 0.056 / **0.102** | 1.000 / **1.000** |
| knowledge-update | 144 | 0.083 / 0.153 | 1.000 / 1.000 |
| multi-session | 323 | 0.034 / 0.083 | 1.000 / 1.000 |
| single-session-assistant | 56 | 0.018 / 0.018 | 1.000 / 1.000 |
| single-session-preference | 44 | 0.250 / 0.367 | 1.000 / 1.000 |
| single-session-user | 66 | 0.167 / 0.172 | 1.000 / 1.000 |
| temporal-reasoning | 253 | 0.016 / 0.031 | 1.000 / 1.000 |

The cause is the shape of the zero-LLM session page `sessions/<id>.md`. Its
indexed body lists only each observation's title
(`crates/ai-memory-hooks/src/synth.rs`, `render_body` and
`render_raw_observation`), and titles are cut to 80 characters
(`truncate_for_title` in `crates/ai-memory-core/src/sanitize.rs`). Assistant
turns (`stop` observations) are titled just `stop`, so no assistant text
reaches the page at all. The full observation bodies were indexed in
`observations_fts` the whole time, but `memory_query` read them only when page
search found nothing. With about 50 session pages per question that almost
never happened: 44 of 470 questions took that fallback, and those hit at
42/44.

The pipeline still reached 0.662 because sessions were often found through
topic words at the start of a prompt rather than through the answer. Only 39
of its 311 hits had page-reachable evidence. Of its 159 misses, 150 had none;
whole-session pages, which hit 0.972 of the full set, recover nearly all of
them.

The local embedder reads the page body cut to 6,144 bytes and then to 512
tokens. On these short pipeline pages that window holds the whole page. On
full-text pages it covers 0.712 of evidence turns and a 0.791 question
ceiling (whole sessions), or 0.703 and 0.785 (captured text).

## A harness artifact: the per-turn date prefix

A replayed history has to carry its own dates, so the harness prepends
`[session date: YYYY/MM/DD (Day) HH:MM] ` to every turn (`build_items` in
`evals/src/retrieval/ingest.rs`). That is 39 characters, about half of the
80-character title budget. Production capture adds no such prefix.

Moving the date to the session start (`--candidate-date-prefix
session-start`) or dropping it (`none`) on strat-120:

- FTS `hit@5` 0.658 → 0.792 (+0.133; 21 gained, 5 lost). Two independent runs
  gave identical per-question results, and `none` gives the same number.
- Local `hit@5` 0.800 → 0.892 (+0.092; 14 gained, 3 lost).
- Session-page turn reachability rises from 0.080 to 0.267, and the page
  ceiling from 0.142 to 0.408.

So the published pipeline numbers understate shipped behaviour on this
content. The harness keeps `turn` as the default so earlier baselines stay
reproducible.

## The privacy caps are not the cause

Earlier versions of these docs said the 2 KB cap on captured assistant
excerpts explained most of the gap to raw-log retrievers. The measurement
says otherwise. `--ingest captured-session` writes one page per session
holding exactly the text capture keeps: user turns up to 16 KiB and assistant
excerpts cut at 2 KB. Those pages score 0.968 FTS `hit@5` on all 470
questions, against 0.972 for whole raw sessions. The caps cost 0.004. The
step from those pages to the shipped session page, which indexes only the
titles, cost 0.302.

The 16 KiB durable-body backstop does not truncate page writes either: it
applies to observation bodies (`OBSERVATION_BODY_MAX_BYTES`). In the
whole-session run, 3,050 of 23,566 pages were over 16 KiB, and all were
stored whole.

## What the observation stream recovered

The fix keeps the session page as it is and adds the observation bodies to
ranking instead. With `[retrieval] observation_stream` on, project and
`scopes` searches also run full-text search over the project's observations,
and each matching session votes once, through its best observation, for its
own `sessions/<id>.md` page as one more RRF stream. A page the stream voted
for takes its lexical evidence from the stream alone: page FTS over its
title-only body still reports a rank but adds nothing, so a session that only
shares topic words in its titles cannot outvote the session holding the
answer. Hits are still pages, and nothing new is written to the wiki. It is on
by default in 3.0; setting it to `false` restores the previous ranking
exactly.

Stream off → on, same build (`release/3.0` at `41793120` on top of
`25594224`, the shipped ranking), same questions, all 470, corrected harness:

| run | hit@5 | hit@1 | hit@10 | recall@5 | p95 ms | flips |
|---|---|---|---|---|---|---|
| FTS | 0.662 → **0.951** | 0.511 → 0.857 | 0.687 → 0.972 | 0.533 → 0.893 | 90 → 112 | +139/−3 |
| Local embeddings | 0.796 → **0.936** | 0.536 → 0.757 | 0.881 → 0.970 | 0.657 → 0.871 | 264 → 234 | +72/−6 |

FTS `hit@5` per slice, off → on: knowledge-update 0.764 → 1.000,
multi-session 0.562 → 0.967, single-session-assistant 0.804 → 1.000,
single-session-preference 0.533 → 0.700, single-session-user 0.688 → 1.000,
temporal-reasoning 0.654 → 0.921. The FTS and local runs ran at the same time
on one host, so their latencies are only indicative.

Context tokens rise because the candidate returns more hits: with the stream
off, FTS returned fewer than five hits for 219 of 470 questions (5.6 on
average), and with it on, 9.9. The cost of the top five hits rises much less:

| run | mean context tokens, all hits | top five hits only |
|---|---|---|
| FTS | 366.7 → 528.1 | 256.3 → 266.1 (+3.8%) |
| Local embeddings | 451.4 → 528.3 | 225.7 → 264.1 (+17.0%) |

"Top five hits only" scales each question's estimate by `min(returned, 5) /
returned`.

The pipeline now ranks an evidence session into the top five for 95.1% of
questions with FTS alone, against 96.8% for pages holding exactly the captured
text and 97.2% for whole raw sessions. With the stream on, local embeddings
score slightly below FTS alone (0.936 against 0.951), mostly on
single-session-assistant questions (0.875 against 1.000): the session page's
vector, like its FTS row, sees only the title-only body.

### First version

In its first version the stream's vote was added on top of page FTS, so a
session page whose title list shared topic words with the question still
collected both. That version, stream off → on, corrected harness, on
`release/3.0` at `7e08baa7`:

| run | questions | hit@5 | hit@1 | hit@10 | recall@5 | p95 ms | flips |
|---|---|---|---|---|---|---|---|
| FTS, full set | 470 | 0.662 → **0.855** | 0.511 → 0.611 | 0.687 → 0.934 | 0.533 → 0.743 | 84 → 97 | +91/−0 |
| FTS | 180 (`--stratify 30`) | 0.656 → **0.828** | 0.483 → 0.594 | 0.689 → 0.917 | 0.558 → 0.719 | 25 → 40 | +32/−1 |
| Local | 90 (`--stratify 15`) | 0.800 → **0.867** | 0.500 → 0.533 | 0.867 → 0.933 | 0.677 → 0.764 | 68 → 75 | +7/−1 |

FTS `hit@5` per slice on the full set, off → on: knowledge-update 0.764 →
0.944, multi-session 0.562 → 0.868, single-session-assistant 0.804 → 0.839,
single-session-preference 0.533 → 0.667, single-session-user 0.688 → 0.875,
temporal-reasoning 0.654 → 0.835. No slice dropped, and no question lost its
top-5 hit. The three runs ran one after another on one host. An earlier build whose observation scan was not yet bounded to the
project measured a candidate p95 of 1,373 ms; the bounded scan is what
shipped.

Its top-five context cost rose 7.9% (FTS, 470), 7.0% (FTS, 180) and 18.2%
(local, 90). Letting the stream alone rank a page it voted for, the shipped
version above, took FTS `hit@5` from 0.855 to 0.951 and lowered the top-five
token cost.

## Harness correction (2026-10-13)

LongMemEval reuses session ids across questions: 4,715 of the 23,566 scored
haystack sessions, 8 of them evidence sessions, also appear in an earlier
question's haystack. The first runs replayed every session under its raw id,
so a reused session already existed in the earlier question's project when
the later replay arrived. The store filed its turns under the new project but
dropped its `session-end` as naming a foreign scope, so those sessions never
got a session page in the later project. This was the "8 of 845 evidence
sessions had no session page" the first version of this report could not
explain. A real harness mints a fresh id per session, so the replay now
namespaces each id by question (`stored_session_uuid` in
`evals/src/retrieval/ingest.rs`, harness `7e08baa7`), and all 845 evidence
pages are present.

The pipeline numbers above, and the observation-stream runs, are from the
corrected harness. The changes were small for the pipeline and larger for the
stream, which had partly been scoring sessions whose page was missing:

| run | first published | corrected |
|---|---|---|
| FTS pipeline, 470 | 0.666 | 0.662 |
| Local pipeline, strat-230 | 0.809 / 0.804 | 0.787 |
| FTS date-prefix ablation, strat-120 | 0.658 → 0.792 | 0.658 → 0.792 |
| Local date-prefix ablation, strat-120 | 0.800 → 0.900 | 0.800 → 0.892 |
| FTS stream off → on, 470 (first version) | 0.666 → 0.868 | 0.662 → 0.855 |
| Local stream off → on, 90 (first version) | 0.800 → 0.867 | 0.800 → 0.867 |

Component, grep and captured-session runs write pages directly or read the
dataset, never replaying session ids through hooks, so they are unchanged.
Reachability is unchanged too (0.056 / 0.102 on the session page).

## Comparability with other published numbers

- **Harness agreement.** `--engine grep` reimplements agentmemory's grep
  adapter (tokens `[a-z0-9_]+` longer than two characters, substring match
  over the dated session text, stable sort, first occurrence of a repeated
  session). It agrees with agentmemory's archived per-question grep results on
  all 470 questions, for hit, recall@5 and recall-all@5, on both dataset
  files. Both harnesses score the same 470 answerable questions, and our
  `hit@5` is the same statistic as their any-hit@5 over distinct sessions.
  That shows the question set and the metric line up. It is not a comparison
  of the two systems.
- **agentmemory's published figure** on LongMemEval-S is 95.2%
  `recall_any@5`, committed in April 2026. Their benchmark indexes each whole
  raw session as one document directly in in-memory components, with BM25
  plus vectors and the reranker disabled (`rerankEnabled=false`). That is a
  component measurement. ai-memory's pipeline numbers include capture, and
  even its component numbers use a different index, document construction and
  dataset file. **The two are not like-for-like, and no ranking between the
  tools is claimed here.**
- The cleaned dataset file changes the haystacks of 454 questions but keeps
  every question and evidence label. Grep and whole-session FTS score the same
  on both files.

## Caveats

- `belief_authority_weight` could not be measured here. Zero-LLM session pages
  have no `page_evidence` rows, so every page's confidence is 0.0: with
  `AI_MEMORY_RETRIEVAL__BELIEF_AUTHORITY_WEIGHT=0.3` the FTS delta was exactly
  0.000 and the local delta −0.008 (one flip, within local run-to-run noise).
  It needs an LLM-consolidated corpus.
- With full text in the index, local embeddings scored below FTS alone on the
  same 230 questions (0.943 against 0.974 on captured-text pages; 10 lost,
  3 gained). The page vector covers only the first 512 tokens.
- Hook ingest slows as the store grows: in the full pipeline run, completed
  questions per minute fell from about 22 to about 5 (about 23,000 sessions
  across 470 projects, contended host). The cause was not profiled.

## Reproduce

Build once, from a `release/3.0` checkout:

```bash
cargo build --release -p ai-memory-cli -p ai-memory-eval
E=target/release/ai-memory-eval
```

Decomposition (server at `7dd6b2c2`, before the observation stream). On a
build where the stream is on by default, add
`--server-env AI_MEMORY_RETRIEVAL__OBSERVATION_STREAM=false` to reproduce
these:

```bash
# grep calibration, both dataset files
$E retrieval --engine grep
$E retrieval --engine grep --dataset-variant s-cleaned
# pipeline vs component, full set, with reachability
$E retrieval --reachability --ingest hooks --candidate-ingest whole-session
# captured-text pages, full set
$E retrieval --http-timeout-secs 900 --reachability --ingest captured-session
# component on the cleaned file
$E retrieval --http-timeout-secs 900 --dataset-variant s-cleaned --ingest whole-session
# date prefix and belief-weight ablations, confirmations (strat-120)
$E retrieval --stratify 20 --reachability --date-prefix turn --candidate-date-prefix session-start
$E retrieval --stratify 20 --date-prefix turn --candidate-date-prefix none
$E retrieval --stratify 20 --candidate-server-env AI_MEMORY_RETRIEVAL__BELIEF_AUTHORITY_WEIGHT=0.3
$E retrieval --stratify 20 --ingest hooks --candidate-ingest whole-session
$E retrieval --stratify 20 --ingest hooks --candidate-ingest captured-session
# local embeddings (strat-230 and strat-120)
$E retrieval --stratify 40 --embeddings local --ingest hooks --candidate-ingest whole-session
$E retrieval --stratify 40 --embeddings local --ingest hooks --candidate-ingest captured-session
$E retrieval --stratify 20 --embeddings local --ingest hooks --candidate-ingest whole-session
$E retrieval --stratify 20 --embeddings local --date-prefix turn --candidate-date-prefix session-start
$E retrieval --stratify 20 --embeddings local --candidate-server-env AI_MEMORY_RETRIEVAL__BELIEF_AUTHORITY_WEIGHT=0.3
```

Observation stream, shipped ranking (corrected harness, stream on by
default): the full-set FTS and local A/Bs. The first version's runs used the
same commands on `7e08baa7`, plus `--stratify 30` (FTS) and `--embeddings
local --stratify 15`:

```bash
B=target/release
AB="--server-env AI_MEMORY_RETRIEVAL__OBSERVATION_STREAM=false
    --candidate-server-env AI_MEMORY_RETRIEVAL__OBSERVATION_STREAM=true"
$B/ai-memory-eval retrieval --server-bin $B/ai-memory --concurrency 6 --http-timeout-secs 900 $AB
$B/ai-memory-eval retrieval --server-bin $B/ai-memory --concurrency 6 --http-timeout-secs 900 \
    --embeddings local $AB
```
