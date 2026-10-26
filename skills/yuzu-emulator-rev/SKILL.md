---
name: yuzu-emulator-rev
description: "yuzu / Ryujinx (Nintendo Switch) emulator reverse engineering -- NSO loading, dynamic recompiler internals, hooking guest code from the host, and SDK symbol recovery."
metadata:
  type: tool-reference
  source: curated
  topics: [yuzu, ryujinx, switch, nso, aarch64, emulator, ipc]
---
# Switch Emulator Reverse Engineering (yuzu + Ryujinx)

Yuzu (C++ / dynarmic) and Ryujinx (C# / ARMeilleure) both emulate the Switch's AArch64 Tegra X1 and the Horizon OS.

## Access vectors

- **nxdt** / **nxdumptool** on real hardware yields NSOs; the emulator loads them and extracts rodata/text segments.
- **Dinput / Frida**: hook the emulator's `Core::Memory::Read*` + `Core::Memory::Write*` to intercept all guest-side accesses.
- **Ryujinx's logging + REUS**: emits every HOS IPC call -- enough to reverse SDK usage.

## Horizon OS surface

- IPC via CMIF / HIPC. Session handles across pm, nn::settings, nn::account.
- Services identified by name hash; dynamic.table in NSO carries SDK ABI.
- Common hook target: `nn::ro::LookupSymbol`, `nn::os::SendMessage`.

## Related

Pairs with [[arm-pac-analysis]], the `nso-analyzer` plugin, and the `android-researcher` agent (ARM64 shared skills).
