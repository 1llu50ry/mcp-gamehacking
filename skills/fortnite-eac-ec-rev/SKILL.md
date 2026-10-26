---
name: fortnite-eac-ec-rev
description: "Fortnite anti-cheat chain -- EAC + EOS AntiCheatClient + hypervisor-aware probes + Verse VM (Fortnite BR Chapter 5+)."
metadata:
  type: tool-reference
  source: curated
  topics: [fortnite, eac, eos, verse-vm, ue5, epic]
---
# Fortnite Anti-Cheat Chain

Current Fortnite shipping with:

- `EasyAntiCheat_EOS.sys` (kernel).
- `EOSSDK-Win64-Shipping.dll` with `EOS_AntiCheatClient_*` interface.
- Verse VM in-game script engine (new runtime surface for cheats + checks).
- UE5 FNamePool + chunked FUObjectArray.

## Detection surfaces

- Hypervisor probe (CPUID, Hyper-V, VMBus).
- Kernel callback inventory.
- EOS tickets + session integrity.
- UE RPC pattern monitoring (server-side).

## Research notes

- EPT read + external aim is the dominant modern vector.
- Verse scripting is sandboxed but exposes new introspection surface.
- Fortnite ban-wave weekly, HWID + Epic account.

## Related

[[eac]], [[hyperv-ept-hook]], [[ue5-fname-pool]], the `fortnite-specialist` agent.
