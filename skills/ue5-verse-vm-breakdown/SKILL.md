---
name: ue5-verse-vm-breakdown
description: "UE5 Verse VM (Fortnite BR Chapter 5+) opcode layout, call frame, Verse-native stdlib, hooking strategy for in-game script introspection."
metadata:
  type: reference
  source: curated
  topics: [ue5, verse, fortnite, vm, scripting]
---
# UE5 Verse VM

Verse is Epic's new scripting language for Fortnite Chapter 5+ UEFN islands. VM is register-based, 64-bit, GC'd. Bytecode compiled from `.verse` sources by `verse-compiler` (shipped in VerseVM).

## Opcode families

- Arithmetic (ADD, SUB, MUL, DIV, MOD) — single opcode per type (int64, float, logic).
- Comparison (EQ, NEQ, LT, LE, GT, GE) — produce boolean, write-back to register.
- Branch (JMP, JMPZ, JMPNZ) — rel16 displacement.
- Call (CALL / TAIL_CALL) — stack frame pointer in R15, args in R0..RN.
- GC (ALLOC, MARK) — generational.
- Transaction (BEGIN_TXN / COMMIT_TXN / ROLLBACK) — Verse's structured-concurrency primitive.

## Hooking

- Entry: `VerseVM::ExecuteByteCode` in `verse-runtime.dll`.
- Intercept at a single call site; dispatch table is at `verse-runtime.dll!g_opcode_handlers`.
- Decompile with `verse-decomp` (community tool).

## Related

[[ue5-fname-pool]], [[fortnite-eac-ec-rev]], [[fortnite-specialist]].
