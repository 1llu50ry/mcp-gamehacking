---
name: disasm-desync-jump-target
description: "Disassembly-desync tricks — overlap-byte jumps, mid-instruction jump targets, PUSH-RET as JMP, nested call pairs. Breaks linear-sweep disassemblers (ldasm, Zydis in linear mode) while recursive-descent (IDA, Ghidra) survives but gets confusing graph layouts."
metadata:
  type: reference
  source: curated
  topics: [disasm-desync, overlap-bytes, mid-instruction, push-ret, linear-sweep]
---
# Disassembly desynchronisation

Classic family of anti-RE tricks. Each one is cheap in build cost and hostile to linear-sweep disassemblers.

## Techniques

1. **Overlap-byte jump**: `EB FF C0` — the `0xFF 0xC0` is `inc eax` to a linear scanner but a jump into the middle of itself to recursive-descent. Reading starts in the wrong place.
2. **Mid-instruction jump target**: an opcode starts at byte N+1 inside what the previous instruction looked like, so the apparent flow is wrong.
3. **PUSH-RET as JMP**: `68 XX XX XX XX C3` is `push imm32; ret` — functionally `jmp 0xXXXXXXXX` but the disassembler shows two instructions and the destination doesn't appear in the control flow.
4. **Nested CALL pairs**: `call+5 / add [rsp], imm / ret` moves the return address into the middle of a different function.
5. **Toggled Thumb / IT blocks** (ARM equivalent).

## Why cheat developers use it

- Cheap, build-step only.
- Confuses IDA's auto-analysis so each basic block has to be inspected manually.
- Combined with [[control-flow-flattening]], makes the function graph unreadable without hand-cleanup.

## Related

[[anti-disassembly-techniques]], [[control-flow-flattening]], [[themida-oreans-vm]].
