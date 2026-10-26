---
name: reverse-emulator-game
description: Reverse engineer a game inside an emulator (Dolphin, RPCS3, Cemu, yuzu, Xenia)
arguments:
  - name: emulator
    description: dolphin / rpcs3 / cemu / yuzu / xenia
    required: true
  - name: game
    description: Target title
    required: true
---

# Reverse an Emulated Game

## Steps

1. Dump the game media (ISO, NSP, PKG, XEX, WUD) + extract main executable.
2. Load into Ghidra/IDA with the right processor module (PowerPC-32, AArch64, PPC-64 big-endian for Xbox 360).
3. Match SDK symbols: Nintendo SDK IDS for GC/Wii/Wii U/Switch; CELL for PS3; Microsoft Xbox SDK for 360.
4. Live-attach: Dolphin via DME; Cemu via gdbstub; yuzu via gdbstub; Xenia via its own debugger.
5. Translate guest offsets to host offsets using the per-emulator formula.
6. Build cheats as emulator plug-ins (Cemuhook graphics-pack, Dolphin AR codes).

## Skills

- [[dolphin-emulator-rev]]
- [[rpcs3-emulator-rev]]
- [[yuzu-emulator-rev]]
- [[cemu-emulator-rev]]
- [[xenia-emulator-rev]]
- [[switch-atmosphere-rev]]
