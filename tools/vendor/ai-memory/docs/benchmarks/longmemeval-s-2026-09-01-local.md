# LongMemEval-S retrieval — 2026-09-01T22:38:38.981115401Z

- commit: `0ac0dcf8f89a1f12d38f68e776e8aa1ab08a0f96`
- dataset: `longmemeval_s` (sha256 `08d8dad4be43ee20…`)
- mode: local-embeddings
- hardware: AMD Ryzen 9 7950X3D 16-Core Processor (32 threads)
- questions scored: 470 (30 abstention questions excluded)

| slice | n | hit@1 | hit@3 | hit@5 | hit@10 | recall@1 | recall@3 | recall@5 | recall@10 |
|---|---|---|---|---|---|---|---|---|---|
| knowledge-update | 72 | 0.625 | 0.806 | 0.903 | 0.944 | 0.312 | 0.590 | 0.736 | 0.875 |
| multi-session | 121 | 0.471 | 0.760 | 0.876 | 0.950 | 0.203 | 0.462 | 0.624 | 0.801 |
| overall | 470 | 0.536 | 0.726 | 0.823 | 0.889 | 0.343 | 0.566 | 0.680 | 0.812 |
| single-session-assistant | 56 | 0.714 | 0.804 | 0.821 | 0.839 | 0.714 | 0.804 | 0.821 | 0.839 |
| single-session-preference | 30 | 0.433 | 0.633 | 0.767 | 0.867 | 0.433 | 0.633 | 0.767 | 0.867 |
| single-session-user | 64 | 0.453 | 0.656 | 0.750 | 0.812 | 0.453 | 0.656 | 0.750 | 0.812 |
| temporal-reasoning | 127 | 0.535 | 0.669 | 0.780 | 0.866 | 0.255 | 0.485 | 0.584 | 0.763 |

Notes: hit@k = any evidence session in top k (the "Recall@k" most systems publish); recall@k = fraction of evidence sessions found. Session attribution: `sessions/<id>.md` pages and raw observation hits; unattributable pages never score. Capture is production-shaped: excerpts bounded at the 2 KB privacy boundary.
