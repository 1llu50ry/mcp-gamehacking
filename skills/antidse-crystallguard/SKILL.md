---
name: antidse-crystallguard
description: "CrystallGuard-style Anti-DSE (Dynamic Symbolic Execution) — opaque predicates + Bellum import resolver + unicode-string NTAPI lookup. Specifically targeted at Triton / angr / Z3-driven analysis."
metadata:
  type: reference
  source: curated
  topics: [antidse, crystallguard, opaque-predicates, bellum, import-resolver]
---
# Anti-DSE (Dynamic Symbolic Execution)

Dynamic symbolic execution (Triton, angr, S2E) can walk through most anti-debug/anti-emul. Anti-DSE deliberately adds state the symbolic engine can't model cheaply.

## Techniques observed (CrystallGuard / Bellum)

- **Opaque predicates** — provably-constant branches whose value Z3 can't infer in bounded time (e.g. deep polynomial equivalences, Collatz-style, modular inverses modulo large composites).
- **Bellum-style import resolver** — walk PEB → ldr → `UNICODE_STRING` → `BaseAddress`; resolve by hash of lower-cased unicode name. No static IAT, no `GetProcAddress` call.
- **Context pollution** — large per-handler buffers of initialised-looking garbage that symbolic engines try to track → path explosion.
- **Timer-locked paths** — a loop that must run for N real-seconds before the real branch resolves; symbolic engines don't execute real-time wall clock.
- **Thread-affinity races** — behaviour depends on multiple threads interleaving; angr's default scheduler can't easily reproduce.

## Why it matters for anti-cheat

- Modern AC vendors use dynamic symbolic validation on captured cheat samples. Anti-DSE buys cheat developers weeks of analyst time per build.

## Related

[[control-flow-flattening]], [[angr-mcp]], [[themida-oreans-vm]], [[vmp-devirt-pipeline]].
