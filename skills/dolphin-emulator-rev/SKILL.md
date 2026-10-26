---
name: dolphin-emulator-rev
description: "Dolphin (GameCube / Wii) emulator reverse engineering -- how to attach to the emulator's virtual memory, read guest MEM1 / MEM2 via Dolphin's HLE wrappers, and build cheats + mods against GameCube and Wii titles."
metadata:
  type: tool-reference
  source: curated
  topics: [dolphin, emulator, gamecube, wii, homebrew, hle, ppc]
---
# Dolphin Emulator Reverse Engineering

Dolphin is the Gamecube/Wii emulator. Its virtual memory map puts guest MEM1 at `0x80000000..0x81800000` and MEM2 at `0x90000000..0x94000000`. Cheat developers hook Dolphin's host-process address space and translate guest addresses on the fly.

## Access vectors

- **Dolphin Memory Engine (DME)**: scans + edits guest memory while Dolphin is running. GUI + Lua scripting.
- **Dolphin's Lua scripting fork**: run scripts in-emu for per-frame logic.
- **Dolphin SlippiCSS**: a melee-only sidecar that reads game state from Dolphin's host memory.
- **Attach via Frida/x64dbg**: hooks Dolphin's `Memory::Read_U32`/`Memory::Write_U32` wrappers (`PowerPC::HostRead`/`HostWrite`) to monitor guest memory accesses.

## PPC reversing in guest ROM

- Dolphin saves ISOs/WADs with symbol maps when available (`.map` files).
- Ghidra PowerPC-32 analyzer + Dolphin's known MMIO ranges give a good first pass.
- Nintendo SDK string residue is heavy -- search for `"PanicAlert"`, `"OSPanic"`, `"NW4R"` to triage.

## Related

Pairs with [[rpcs3-emulator-rev]] (PS3), [[yuzu-emulator-rev]] (Switch), [[cemu-emulator-rev]] (Wii U), the `cheat-developer` agent, and the `offset-finder` subagent.
