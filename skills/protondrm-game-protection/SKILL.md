---
name: protondrm-game-protection
description: "Denuvo (and sibling DRM: VMProtect-Denuvo, Enigma, Themida) -- VM obfuscation layered on online activation, ticket exchange, Chip-level HWID bind."
metadata:
  type: tool-reference
  source: curated
  topics: [denuvo, drm, vm-protection, activation, ticket]
---
# Denuvo Anti-Tamper

Vendor: Irdeto. Vector against DRM-less piracy. Layers:

1. **Online activation**: challenge/response over HTTPS, ties to a hardware fingerprint (CPUID + disk + MAC + motherboard).
2. **Entitlement ticket**: time-bounded JWT-like token stored in `%APPDATA%\Denuvo\`, refreshed in background.
3. **VM**: Denuvo's own VM atop the game binary. Dispatcher mutates per build; handlers are classical fetch-decode-execute over a bytecode slice of x86.
4. **Trigger density**: thousands of VM entry trampolines sprinkled through the binary (hot functions wrapped individually).

## Cracking state of the art

- Partial devirt via `VMPAttack`, `NoVmp`, `Triton`; full devirt impractical.
- Current scene approach: wait for a leaked / insecure build (e.g., EGS pre-release).

## Research signals

- Section names `.denuvo` / `.1`.
- Thread with heavy TLS callbacks that mutate the CFG.
- `kernelbase!GetSystemFirmwareTable('RSMB')` for SMBIOS, `physicaldrive0 IOCTL_STORAGE_QUERY_PROPERTY`.

## Related

[[themida-analyzer]], [[vmp-analyzer]], [[entropy-analyzer]], [[hwid-reference]].
