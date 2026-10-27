# Context Reuse Telemetry

`ENABLE_REUSE_TELEMETRY=false` disables telemetry correlation state and database access; the compiler still emits its normal opaque `context_pack_id` contract. It is enabled by default and stores only hourly numeric aggregates scoped by owner/repo.

## Privacy and retention

The table contains `owner`, `repo`, hourly bucket, metric name, optional source name, count, and numeric value. It never stores prompts, memory/observation text, code bodies, file paths, symbol names, secrets, or raw session IDs. Correlation identifiers are process-local SHA-256 prefixes; `context_pack_id` combines a scope hash with a random UUID.

- `REUSE_TELEMETRY_RETENTION_DAYS` defaults to 30 (1–365 effective range).
- `REUSE_TELEMETRY_MAX_ROWS` defaults to 20,000; oldest aggregate rows are discarded.
- Relevant hot paths update bounded in-memory counters and flush every 4,096 tool/context events or after a minute of subsequent activity (not every sub-counter); shutdown and explicit metrics reads force a final flush.
- Explicit `context_pack_id` calls use an eight-entry, five-minute in-process cache; typical serialized packs keep this comfortably below the 2 MB RAM budget.
- The dashboard `/api/metrics?owner=...&repo=...&hours=24` surface flushes pending counters and returns the repo/time-window summary.

## Metric semantics

- `context_packs_requested`, `context_cache_hits|misses`: pack demand and real hits/misses in the bounded five-minute cache. Hit/miss counters apply only to opt-in calls carrying `context_pack_id`; default calls always compile fresh.
- `context_items_included|excluded` and `context_estimated_tokens`, grouped by source, reconcile with the compiler allocation.
- `observation_ids_reused`, `evidence_pointers_reused`, `stale_observations_rejected` are counts only.
- `repeated_file_reads|repeated_symbol_reads` count repeated hashed pointers inside one bounded process session.
- `claim_to_first_action_ms` sums elapsed milliseconds; divide value by count for the mean. Its `by_source` keys are bounded latency buckets (`le_100ms` through `gt_30s`), providing a histogram without raw events.
- `retrievals_acknowledged_used` counts explicit `memory-write acknowledge=used` calls.
- `observation_tokens_avoided` uses **96 estimated tokens per reused evidence pointer**. This is a deterministic comparison heuristic, not tokenizer output, billing data, or guaranteed savings.

## North-star summary

Reuse is improving when context packs deliver more fresh observation/code evidence while repeated file/symbol reads and stale rejections fall. The primary ratio is:

`avoided repeated reads / total file+symbol reads`

Interpret it beside context tokens delivered and acknowledgement/use counts; no single counter proves product value.

## Deterministic benchmark

Run `node --expose-gc --import tsx scripts/bench/context-reuse-bench.ts` (or `npx tsx ...` when only latency/disk data is needed). On the reference local run, median CPU overhead was 0.50%, heap delta 92,984 bytes, aggregate DB growth 0 bytes after schema creation (720,896 bytes total), and two aggregate rows were retained. The no-LLM scenario models explore → orchestrator → two implementers twice: baseline agents repeat file/symbol reads, while shared-context agents consume one evidence-backed pack. It reports file reads, symbol reads, estimated tokens, elapsed latency, peak heap, database bytes, and the median instrumentation CPU overhead across seven paired SQLite trials. Values are estimates for regression comparison, not provider billing. Establish a stable CI baseline before enforcing a hard threshold; local warm runs target median overhead below 1%.
