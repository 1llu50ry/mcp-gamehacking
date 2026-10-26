---
name: xenia-emulator-rev
description: "Xenia (Xbox 360) emulator reverse engineering -- Xbox 360 kernel, XEX loading, hypervisor, how to read + patch guest memory and recover Xbox 360 SDK symbols."
metadata:
  type: tool-reference
  source: curated
  topics: [xenia, xbox-360, ppc, xex, hypervisor]
---
# Xenia (Xbox 360) Emulator Reverse Engineering

Xenia emulates the Xbox 360 PPC Xenon CPU. Guest address space big-endian PPC with a thin Xbox kernel layer.

## Access vectors

- **xenia debugger**: GPU state capture, register dump, memory view.
- **XEX parsing**: encrypted/compressed PE sibling (`XEX1`/`XEX2`). Use `XexTool` to extract then feed Ghidra PPC analyzer.
- **PGO + kernel hooks**: trampoline the Xbox 360 kernel exports (NtAllocateVirtualMemory, XexImportFunc).

## Related

[[dolphin-emulator-rev]], [[rpcs3-emulator-rev]], [[cemu-emulator-rev]].
