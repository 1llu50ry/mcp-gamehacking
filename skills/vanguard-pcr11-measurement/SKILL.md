---
name: vanguard-pcr11-measurement
description: "Riot Vanguard measured-boot PCR[11] expectations on Windows 11 24H2 — which drivers get hashed into PCR[11], how Vanguard reads TPM via TBS, what breaks the measurement."
metadata:
  type: reference
  source: curated
  topics: [vanguard, tpm, pcr, measured-boot, hvci]
---
# Vanguard PCR[11] measurement

On Windows 11 24H2, PCR[11] is extended by `winload.efi` with every loaded kernel-mode driver's PE hash. Vanguard (`vgk.sys` / `vgc.exe`) reads PCR[11] via the TPM Base Services (`TBS.dll`) at game-session start and matches it against a known-clean baseline.

## What extends PCR[11]

- Every signed KM driver loaded during boot.
- HVCI-rejected drivers are *not* extended (never load).
- A BYOVD attempt in early boot shows up as an unexpected hash — Vanguard rejects session.

## Research vectors

- EFI-stage shadow TPM that fakes a clean PCR[11] while a real HV runs underneath (Bootkitty-style).
- Nested virt where Vanguard runs in a VM with a vTPM Vanguard thinks is real.
- Driver-less memory read (DMA via [[pcileech-mcp]]).

## Related

[[secure-boot-tpm-vanguard]], [[hvci-compat-driver]], [[efi-persistence]].
