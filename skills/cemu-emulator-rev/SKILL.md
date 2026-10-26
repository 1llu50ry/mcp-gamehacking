---
name: cemu-emulator-rev
description: "Cemu (Wii U) emulator reverse engineering -- Latte GPU block, Espresso PPC CPU, CafeOS kernel, how to attach cheats via Cemuhook and the Lua script engine."
metadata:
  type: tool-reference
  source: curated
  topics: [cemu, wii-u, ppc, espresso, cafeos, cemuhook]
---
# Cemu (Wii U) Emulator Reverse Engineering

Cemu emulates Wii U's Espresso (3-core PPC) and Latte GPU block. Guest memory is paged; main RAM at `0x10000000..0x50000000`.

## Access vectors

- **Cemuhook**: official hook API; graphics-pack system edits shaders and textures.
- **Cafiine**: on-device file replacement (homebrew), useful for RE on real hardware before migrating to Cemu.
- **gdbstub**: Cemu exposes a gdb server; connect from Ghidra or IDA for live PPC debugging.

## CafeOS

- RPL (relocatable PPC library) format with hashed export tables.
- Common system libs: `coreinit.rpl`, `gx2.rpl`, `nn_act.rpl`, `nsyshid.rpl`.
- Common hook target: `OSSetThreadPriority`, `GX2SetupContextStateEx`.

## Related

[[dolphin-emulator-rev]], [[rpcs3-emulator-rev]], [[xenia-emulator-rev]].
