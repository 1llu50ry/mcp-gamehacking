---
name: spoof-hardware
description: Design HWID spoofing strategy -- disk, NIC, GPU, SMBIOS, registry, firmware-level.
arguments: 
---

Design HWID spoofing strategy against `{target_ac}`.
Level: {level}

## Spoof Targets

### 1. Disk Serial
- IOCTL_STORAGE_QUERY_PROPERTY interception
- SMART data spoofing
- NVMe serial (IOCTL_SCSI_MINIPORT)
- Registry: HKLM\HARDWARE\DEVICEMAP\Scsi

### 2. Network Adapter
- NDIS OID_802_3_PERMANENT_ADDRESS
- Registry MAC override
- NdisMSetMiniportAttributes hook

### 3. SMBIOS / DMI
- GetSystemFirmwareTable hook
- SMBIOS table patching (Type 1 UUID, serial)
- EFI variable modification

### 4. GPU
- Direct3D adapter LUID
- NVIDIA/AMD serial via WMI
- Display EDID

### 5. Motherboard
- SMBIOS Type 2 (baseboard serial)
- Registry BIOS info
- ACPI table modification

### 6. TPM / Secure Boot
- TPM EK certificate
- Measured Boot PCR values
- Secure Boot variable spoofing

## Detection Methods Per AC
Cross-reference with `anti-cheat-timeline` plugin.

## Detailed Workflow
### Goal
HWID spoof plan

### Steps
enumerate collection surface (SMBIOS/disk/MAC/CPUID/TPM/machine GUID) -> pick vectors -> implement coordinated spoof

### Artifacts
SMBIOS loader, disk-serial driver hook, MAC rotator, machine GUID rewriter
### Context Gathering Protocol
Before planning:
1. `search_skills` with 3-5 keyword combinations around the task.
2. `read_skill` on the 2-3 most relevant hand-written skills for depth.
3. `grep_sources` across the `ags-*` archive for real implementations.
4. Cross-reference offsets/signatures across multiple sources; use `offset-confidence-scorer`.

### Quality Checklist
- Every offset carries data type + size + source attribution
- Every code block compiles under the declared toolchain
- Every technique carries a detection-risk tier
- Every version-specific detail is labelled with build id
- Every referenced skill actually exists in the library

### Related Prompts
- `analyze-cheat` for architectural context
- `find-bypass` for anti-cheat evasion
- `build-*` for feature implementation
- `reverse-*` for binary analysis
- `write-*` for code generation
- `migrate-*` for cross-version updates

Each line is cross-linked back to the 177 hand-written skills plus the 3,985 archived projects (prefixed `ags-`).

<!-- enriched:v2 -->
