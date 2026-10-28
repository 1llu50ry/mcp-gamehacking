# LongMemEval-S retrieval — 2026-09-01T22:19:24.828453944Z

- commit: `0ac0dcf8f89a1f12d38f68e776e8aa1ab08a0f96`
- dataset: `longmemeval_s` (sha256 `08d8dad4be43ee20…`)
- mode: zero-llm
- hardware: AMD Ryzen 9 7950X3D 16-Core Processor (32 threads)
- questions scored: 470 (30 abstention questions excluded)

| slice | n | hit@1 | hit@3 | hit@5 | hit@10 | recall@1 | recall@3 | recall@5 | recall@10 |
|---|---|---|---|---|---|---|---|---|---|
| knowledge-update | 72 | 0.583 | 0.750 | 0.764 | 0.778 | 0.292 | 0.549 | 0.562 | 0.590 |
| multi-session | 121 | 0.446 | 0.554 | 0.579 | 0.603 | 0.193 | 0.350 | 0.385 | 0.403 |
| overall | 470 | 0.534 | 0.647 | 0.668 | 0.696 | 0.351 | 0.510 | 0.538 | 0.566 |
| single-session-assistant | 56 | 0.679 | 0.786 | 0.804 | 0.839 | 0.679 | 0.786 | 0.804 | 0.839 |
| single-session-preference | 30 | 0.300 | 0.467 | 0.533 | 0.667 | 0.300 | 0.467 | 0.533 | 0.667 |
| single-session-user | 64 | 0.625 | 0.656 | 0.688 | 0.703 | 0.625 | 0.656 | 0.688 | 0.703 |
| temporal-reasoning | 127 | 0.535 | 0.654 | 0.661 | 0.677 | 0.264 | 0.456 | 0.478 | 0.493 |

Notes: hit@k = any evidence session in top k (the "Recall@k" most systems publish); recall@k = fraction of evidence sessions found. Session attribution: `sessions/<id>.md` pages and raw observation hits; unattributable pages never score. Capture is production-shaped: excerpts bounded at the 2 KB privacy boundary.
