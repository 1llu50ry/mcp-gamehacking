---
name: tpm-license-checker
description: "TPM-backed license / HWID checker — EK (Endorsement Key) read via TBS, EK hash as license fingerprint, bind-to-TPM so license is non-portable even if disk + MAC are spoofed."
metadata:
  type: reference
  source: curated
  topics: [tpm, ek, licensing, hwid, tbs]
---
# TPM license checker

Software licensing bound to TPM EK (Endorsement Key). More robust than SMBIOS + disk-serial because EK is a per-device permanent key material burned at TPM manufacture.

## Flow

1. Query TPM via `Tbsi_GetDeviceInfo` + `Tbsip_Submit_Command` (TBS = TPM Base Services).
2. Fetch the EK public key (TPM2_ReadPublic with TPM_RH_ENDORSEMENT).
3. Hash EK pubkey → device fingerprint.
4. Server-side licensing compares fingerprint against the sold entitlement.
5. On mismatch, time-bomb or refuse to decrypt the main payload.

## Why it defeats basic HWID spoof

- SMBIOS / disk / MAC can all be rewritten.
- EK requires physical TPM swap or firmware-level TPM emulation. Hardware swap = different machine entirely.
- Spoof-vector: nested virt with a vTPM whose EK you control (Hyper-V TPM-in-VM). Mitigation: license checker rejects known vTPM vendor EKs.

## Related

[[hwid-reference]], [[secure-boot-tpm-vanguard]], [[hwid-spoof]].
