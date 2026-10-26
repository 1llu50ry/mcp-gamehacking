---
name: ricochet-ac-rev
description: "Ricochet Anti-Cheat (Call of Duty) -- kernel driver (ricochet.sys) internals, hypervisor-aware checks, HWID collection, and the server-side ban-wave pattern."
metadata:
  type: tool-reference
  source: curated
  topics: [ricochet, cod, warzone, kernel-driver, hvci, hwid]
---
# Ricochet Anti-Cheat

Activision's kernel-mode anti-cheat for Call of Duty (Warzone, MW/MW2/MW3, BO6). Loaded as `ricochet.sys`.

## Kernel surface

- Process creation callback + image load callback.
- MmGetSystemRoutineAddress bulk harvest to detect hook on NT exports.
- Hypervisor probing: CPUID[0x40000000..0x40000006] vendor sniff, EPTP leak via `invept`.
- Session-rolling XOR of in-game offsets (anti-dumper), rotated per launch.

## Server side

- Behavior ML (shadow-ban first, hardware ban later).
- Weekly ban-wave Thursday-morning US time.

## Mitigation vectors (research)

- Custom hypervisor + EPT read (hvci-compatible).
- DMA (PCILeech / Screamer).
- Hardware ID spoof across SMBIOS + MAC + disk + CPUID + machine GUID coherent.

## Related

[[battleye]], [[eac]], [[vanguard]], [[pcileech-mcp]].
