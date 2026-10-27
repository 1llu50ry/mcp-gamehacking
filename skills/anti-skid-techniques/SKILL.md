---
name: anti-skid-techniques
description: "AntiSkid tactics — delayed error messages, watermark leakage via sub-nanosecond timing drift, build-stamp canaries, TPM EK burn-in, poisoned string-pool entries that only decode on the correct seed."
metadata:
  type: reference
  source: curated
  topics: [antiskid, anti-crack, watermark, canary, licensing]
---
# Anti-skid

'Skid' = kid who buys a cheat, cracks the licensing, redistributes for free. Anti-skid tactics raise the cost of that pipeline without defeating a real analyst.

## Observed tactics

- **Delayed error** — don't crash on bad license immediately. Wait 10-20 minutes, then subtly misbehave (missed shots at 0.1% rate). Harder to bisect.
- **Watermark leakage** — different builds have different timing drifts in a background thread. A leaked crack carries the drift signature of its origin build; publisher traces the leaker.
- **Build-stamp canary** — license hash is embedded as a dead-code constant. A cracker who edits the hash still leaves the original somewhere.
- **TPM EK burn-in** — see [[tpm-license-checker]]. Non-portable across machines.
- **Poisoned string-pool** — the string pool contains fake entries that decrypt only on the real seed. A cracker who rips strings post-decrypt still carries the fake plaintexts, which trigger server-side flags.

## Related

[[tpm-license-checker]], [[protondrm-game-protection]], [[watermark-fingerprinting]].
