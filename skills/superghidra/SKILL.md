---
name: superghidra
description: "SuperGhidra -- Python toolkit around Ghidra 11/12 with a warm read-only daemon on 127.0.0.1:5073, SQLite L2 cache, non-destructive JSON write overlay, MFC/C++ class recovery, Serialize() layout tracing, cross-version function matching, Z3 P-code equivalence checker, GPU/SIMD ARM64 sweeps, and LZ4/Zstd buffer compression. Replaces 5-15 s JVM-cold-start-per-headless-run and .rep lock contention."
metadata:
  type: tool-reference
  source: better-options/SuperGhidra-master
  topics: [ghidra, reverse-engineering, mcp, class-recovery, pyghidra, z3, headless, mfc]
---

# SuperGhidra

Python-first productivity layer around Ghidra. Keeps one read-only Ghidra JVM warm as a daemon (`127.0.0.1:5073`), fronts it with an SQLite L2 cache and a non-destructive JSON write overlay, and ships standalone pure-Python / NumPy-SIMD / WGPU-compute pipelines for the sweeps Ghidra cannot do out of the box.

## Why

- Avoids 5-15 s JVM cold-start per headless run.
- Avoids `.rep` project lock contention while the Ghidra GUI is open on the same project.
- MFC `CRuntimeClass` and `Serialize()` layout recovery that Ghidra lacks out of the box.
- MSVC RTTI + classic ClassInformer-grade recovery with pure-Python standalone fallbacks.
- Cross-version function matching for diffing game updates and anti-cheat drivers.
- Z3 SMT equivalence checking for P-code snippets (patch validation, deobfuscation).

## Operating Modes

| Task | Entry point | Needs JVM? | Writes `.rep`? |
|---|---|---|---|
| Decompile / xrefs / rename | `python ghidra_oracle.py <subcommand>` | Yes (Ghidra 11/12 + OpenJDK 21 + PyGhidra) | No (JSON overlay) |
| MSVC RTTI, MFC `CRuntimeClass`, `Serialize()`, PE/ELF/Mach-O headers | `python -m superghidra.formats.msvc_class_recovery <binary>` or `superghidra rtti-recover <binary> -o classes.json` | No | No |
| AI agent integration | `superghidra-mcp` (via [[superghidra-mcp]]) | Yes (connects to daemon) | No (validation + overlay sync) |
| GPU/SIMD ARM64 scans, LZ4/Zstd compression, Z3 P-code checks | `superghidra <subcommand>` | No | No |

## Pipelines Worth Knowing

- `ghidra_oracle.py` -- single long-lived daemon that answers decomp/xref/rename queries.
- `binary_diff_engine.py` -- cross-version function matcher (useful on game-update offset migration).
- `apk_jni_cross_referencer.py` -- JNI method <-> native xref recovery.
- `arm_thumb_decode.py` -- Thumb/Thumb-2 decoder for AArch32 game binaries.
- `d_lift_verifier.py` + `egraph_mlir_pipeline.py` -- MLIR + e-graph passes over Ghidra P-code.
- `gpu_adrp_scanner.py` -- WGPU AArch64 ADRP+ADD/LDR pair sweep (fast page-base recovery).
- `ida_flirt_bridge.py` + `ida_til_importer.py` -- shuttle FLIRT signatures and TIL type libs into Ghidra.
- `dwarf_pdb_preindexer.py` -- preindex DWARF/PDB symbols without touching the Ghidra project.
- `emulator_memory_sidecar.py` -- shadow emulator memory alongside Ghidra for comparing emulated vs disassembled behavior.
- `evidence_ledger.py` -- append-only ledger of RE decisions for reproducibility.

## When to Pick SuperGhidra

- Repeated headless analyses that would otherwise burn JVM cold-start cost.
- `.rep` project where the GUI must stay open (lock contention would normally break headless scripts).
- MFC-heavy Windows targets (older games, VC6/VC2008 binaries) where class/Serialize layouts matter.
- Need Z3-based patch equivalence as part of a deobfuscation or exploit chain.
- GPU-accelerated ARM64 sweeps of large firmware (Switch, iOS, Android native).

## Related

Pairs with [[superghidra-mcp]] for AI agent integration, [[ida-pro-mcp]] for the IDA Pro equivalent, [[vibe-reverse-engineering]] for lighter LLM-first binaries, [[rea-reverse-engineer-anything]] for cross-tool orchestration, and [[x64dbg-mcp-server]] for live debugging. Supports workflows in `reverse-binary`, `analyze-update`, `analyze-cheat`, `reverse-unreal-game`, and the `ghidra-specialist` agent.
