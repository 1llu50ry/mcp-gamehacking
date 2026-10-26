---
name: vmp-devirt-pipeline
description: "Pipeline for devirtualizing VMProtect 3.x: handler map, taint tracing, VTIL lifting, and LLVM backend emission for an unprotected approximation of the original."
metadata:
  type: tool-reference
  source: curated
  topics: [vmprotect, devirt, vtil, llvm, obfuscation]
---
# VMProtect Devirtualization Pipeline

End-to-end pipeline turning a VMProtect-protected routine back into readable C.

## Steps

1. **Entry locate**: find VMP VM entry sequences via signature `MOV REG, offset vm_dispatch` + `JMP vm_entry`.
2. **Handler clustering**: extract handler bodies; map opcodes by taint-driven dispatcher trace.
3. **IL lift**: translate each handler to VTIL IR. Semantics for VMP's "VM-add", "VM-xor", "VM-call", "VM-jmp" are documented in `NoVmp`.
4. **Optimize**: constant-fold, dead-store, loop canonicalize.
5. **Backend emit**: VTIL -> LLVM IR -> `opt -O2` -> optional Hex-Rays decomp.

## Tooling

- `NoVmp` (es3n1n)
- `VMPAttack` (community)
- `Triton` for symbolic step-through
- `VTIL` as the common IR

## Related

[[vmp-analyzer]], [[angr-mcp]], the `obfuscation-analyst` agent.
