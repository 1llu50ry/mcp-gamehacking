---
name: hyperion-roblox-rev
description: "Hyperion (Byfron) Roblox client -- VM-based protection with mutating handler tables, syscall emulation, JIT devirt, and runtime integrity checks. Updated bypass approaches."
metadata:
  type: tool-reference
  source: curated
  topics: [hyperion, byfron, roblox, vm-protection, devirt, jit]
---
# Hyperion (Byfron) Roblox Protection

Hyperion is Byfron's VM-based packer wrapping the Roblox client (`RobloxPlayerBeta.exe`). Rolled out 2023, mutates frequently.

## Observations

- Virtualized integrity checks across the Lua VM and the C++ shell.
- Custom syscall dispatcher -- direct `ntdll` calls are stripped and replaced with VM handlers.
- Hypervisor presence check (CPUID[1].ECX bit 31, Hyper-V vendor string match).
- Encrypted module blobs decrypted into RWX during VM execution; refcounted to deter dumping.

## Devirt pointers

- `vm_handlers` table dispatched by XOR-rolling opcode byte.
- Handler semantics map 1:1 to a subset of x86 (mov/add/xor/jmp/call/ret) + VM-internal ops (vm_jmp_slot, vm_assertions).
- Known lifters: `hyperion-devirt` (community), partial VTIL translator.

## Related

[[byfron]], [[roblox-researcher]] (agent), [[angr-mcp]] (symbolic lift of handlers).
