---
name: prefetch-kernel-hook-filter
description: "Minifilter driver that intercepts `IRP_MJ_WRITE` on the Windows Prefetch path — used to hide a dropper's prefetch footprint, or (defensive) to detect writes to prefetch that look like evidence tampering."
metadata:
  type: reference
  source: curated
  topics: [prefetch, minifilter, irp-mj-write, kernel, forensics]
---
# Prefetch kernel minifilter

`C:\Windows\Prefetch\*.pf` is a forensic artefact: Windows writes a prefetch file the first time (and periodically after) a binary runs. Attackers want to delete / forge it; defenders want to detect tampering.

## Minifilter shape

- Register `PFLT_FILTER` via `FltRegisterFilter` with a `FLT_OPERATION_REGISTRATION` for `IRP_MJ_WRITE`.
- `FLT_PRE_OPERATION_CALLBACK` compares `FltObjects->FileObject->FileName` against a cached `UNICODE_STRING` for the prefetch dir.
- Match → either suppress the write (attacker variant), or ETW-emit a tamper event (defender variant).

## Attacker use

- Drop a payload, suppress the prefetch write so no `payload.exe-<hash>.pf` lands.
- Combined with event-log tamper + MFT $J unlink, significantly delays IR triage.

## Defender use

- The same filter in `postOp` observes writes that would delete / zero prefetch and emits ETW events.
- Pair with [[windows-internals-agent]] for the kernel-callback inventory.

## Related

[[windows-internals-agent]], [[driver-developer]], [[forensics-specialist]], [[module-hiding-reference]].
