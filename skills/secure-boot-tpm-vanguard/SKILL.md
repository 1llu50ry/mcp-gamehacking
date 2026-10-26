---
name: secure-boot-tpm-vanguard
description: "Secure Boot + TPM 2.0 + HVCI enforcement by Riot Vanguard 2024+ -- what each layer measures, how it ties to Windows 11, and research vectors around measured-boot."
metadata:
  type: tool-reference
  source: curated
  topics: [secure-boot, tpm, hvci, vanguard, measured-boot, pcr]
---
# Secure Boot + TPM + HVCI for Vanguard

Riot Vanguard on Windows 11 (2024+) refuses to launch unless:

- Secure Boot is on (UEFI).
- TPM 2.0 is present and bound to Windows (`fTPM` on AMD or `PTT` on Intel is fine).
- HVCI (Hypervisor-Protected Code Integrity) is on and Memory Integrity is enabled.
- Boot measurements (PCR[0..7]) match a known-clean baseline.

## Measured-boot primer

- UEFI firmware extends TPM PCR[0] with the PE32+ CRTM hashes.
- `winload.efi` extends PCR[11] with every loaded kernel-mode driver.
- Vanguard's `vgk.sys` reads PCRs via TBS driver before accepting the game session.

## Research vectors

- EFI pre-boot hypervisor that measures-into-a-shadow-PCR but keeps real-PCR clean (`Boothole`-style).
- Signed+blocklisted driver abuse (BYOVD) before HVCI takes over; after HVCI boot, the driver is rejected.
- Hyper-V nested with VMBus-based memory read.

## Related

[[vanguard]], [[byovd]], [[efi-persistence]].
