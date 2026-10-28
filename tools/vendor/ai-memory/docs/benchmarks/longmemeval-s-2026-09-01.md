# LongMemEval-S retrieval — 2026-09-01T15:29:14.188132847Z

- commit: `496e419ff60ece21e1c7dfc76a960c92043e75c8`
- dataset: `longmemeval_s` (sha256 `08d8dad4be43ee20…`)
- mode: zero-llm
- hardware: AMD Ryzen 9 7950X3D 16-Core Processor (32 threads)
- questions scored: 470 (30 abstention questions excluded)

| slice | n | hit@1 | hit@3 | hit@5 | hit@10 | recall@1 | recall@3 | recall@5 | recall@10 |
|---|---|---|---|---|---|---|---|---|---|
| knowledge-update | 72 | 0.528 | 0.653 | 0.708 | 0.806 | 0.264 | 0.451 | 0.493 | 0.604 |
| multi-session | 121 | 0.388 | 0.504 | 0.570 | 0.669 | 0.168 | 0.290 | 0.333 | 0.448 |
| overall | 470 | 0.449 | 0.566 | 0.617 | 0.713 | 0.297 | 0.430 | 0.472 | 0.570 |
| single-session-assistant | 56 | 0.696 | 0.750 | 0.804 | 0.875 | 0.696 | 0.750 | 0.804 | 0.875 |
| single-session-preference | 30 | 0.367 | 0.567 | 0.600 | 0.733 | 0.367 | 0.567 | 0.600 | 0.733 |
| single-session-user | 64 | 0.406 | 0.453 | 0.484 | 0.547 | 0.406 | 0.453 | 0.484 | 0.547 |
| temporal-reasoning | 127 | 0.394 | 0.551 | 0.598 | 0.709 | 0.190 | 0.364 | 0.410 | 0.507 |

Notes: hit@k = any evidence session in top k (the "Recall@k" most systems publish); recall@k = fraction of evidence sessions found. Session attribution: `sessions/<id>.md` pages and raw observation hits; unattributable pages never score. Capture is production-shaped: excerpts bounded at the 2 KB privacy boundary.
