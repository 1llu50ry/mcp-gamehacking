---
name: rpcs3-emulator-rev
description: "RPCS3 (PS3) emulator reverse engineering -- how to read guest PPC/SPU memory, hook game modules, and build cheats on top of RPCS3's LLVM/ASMJIT recompilers."
metadata:
  type: tool-reference
  source: curated
  topics: [rpcs3, emulator, ps3, ppc, spu, llvm, homebrew]
---
# RPCS3 Emulator Reverse Engineering

RPCS3 emulates the PS3 PPE (PowerPC) + 7 SPUs. The guest memory space (`0x00010000..0xD0000000`) is reachable through RPCS3's host-side allocator (`vm::g_base_addr`), typically mapped near `0x100000000` on Windows and `0x200000000` on Linux.

## Access vectors

- **RPCS3's built-in debugger**: PPU/SPU stepping, memory viewer, breakpoints.
- **Lua / Python external scripts**: attach via dbgeng/Frida and translate `vm::ptr<T>` offsets.
- **TMAPI/PS3MAPI**: tracker API used by homebrew cheat trainers.

## PPC/SPU internals

- Each SPU runs independent 256 KiB local store with asymmetric MFC DMA to main memory.
- CELL ABI: argument passing in `r3..r10`, system call via `sc` with syscall number in `r11`.
- Common hook target: `cellGameBootCheck`, `cellSysmoduleLoadModule`.

## Related

[[dolphin-emulator-rev]], [[yuzu-emulator-rev]], [[cemu-emulator-rev]], [[xenia-emulator-rev]].
