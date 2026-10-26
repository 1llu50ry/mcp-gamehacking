---
name: switch-atmosphere-rev
description: "Switch homebrew (Atmosphère CFW) reverse engineering -- fs_mitm, LayeredFS, sysmodule hooks, how to dump SDK + per-game RE on real hardware."
metadata:
  type: tool-reference
  source: curated
  topics: [switch, atmosphere, cfw, mitm, sysmodule]
---
# Switch Homebrew RE (Atmosphère)

Atmosphère is the dominant Switch CFW. Key hooks:

- `fs_mitm` -- redirect file reads from NAND to SD card (LayeredFS).
- `set_mitm` -- rewrite system settings.
- `kip_patches` -- kernel ips patches at boot.

## Game RE workflow

1. Boot Atmosphère on real HW.
2. Dump game NSOs + NCA with `nxdumptool`.
3. Decompress with `hactool`.
4. Load into IDA/Ghidra with the AARCH64 analyzer; apply Nintendo SDK IDS.
5. Live attach via Atmosphère's `tc` (telnet console) + gdbserver.

## Related

[[yuzu-emulator-rev]], [[nso-analyzer]], [[arm-pac-analysis]].
