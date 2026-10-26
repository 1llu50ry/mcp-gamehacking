---
name: emulator-attach-reference
description: Cross-emulator attach/attach-vector reference -- Dolphin, RPCS3, Cemu, yuzu/Ryujinx, Xenia, PCSX2. Guest-memory base addresses, gdbstubs, plugin APIs.
type: tool-plugin
---

# Plugin: emulator-attach-reference

Reference for attaching cheats + RE tooling to each supported emulator.

## Entries

| Emulator | Guest VA | Host VA | Attach vector |
|---|---|---|---|
| Dolphin | 0x80000000..0x81800000 (MEM1), 0x90000000..0x94000000 (MEM2) | DolphinMemoryEngine Lua + API | DME, gdbstub, Lua, Frida on `Memory::Read_U*` |
| RPCS3 | 0x00010000..0xD0000000 | `vm::g_base_addr` (near 0x100000000 Win) | built-in debugger, TMAPI, external attach |
| Cemu | 0x10000000..0x50000000 | Cemuhook API | Cemuhook, gdbstub, graphics-pack hook |
| yuzu / Ryujinx | AArch64 full | `Core::Memory::Read*` | gdbstub, Frida |
| Xenia | PPC big-endian | xenia debugger | xenia debugger, kernel-trampoline |
| PCSX2 | 0x00100000..0x02000000 | emu-side allocator | debugger pane, Lua, DX11 overlay hook |

<!-- enriched:v2 -->
