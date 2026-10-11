# Memory And Forensics

## Kernel Pool Architecture and Allocation Contracts

Treat allocator internals as hypotheses tied to an exact kernel binary,
architecture, configuration and matching symbols. Internal structure offsets,
size thresholds, encoded headers, cache depths and allocation-routing diagrams
are not a stable Windows driver interface. A symbol name without sufficient type
information does not establish a layout; public and private symbol content differ.
[Microsoft symbol scope](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/public-and-private-symbols)

### Architecture Questions for a Review

Separate the public allocation request from its observed allocator path. Record
pool flags, requested size, lifetime, calling/access IRQL and any special-pool or
verifier configuration. If a dump or source study identifies size-class,
variable-size, segment-backed or large-allocation paths, report only the path
supported for that artifact. Do not infer the introduction date or every later
layout from the availability of a public API.

For corruption analysis, preserve the useful threat classes: out-of-bounds
access, use after free, double free, uninitialized disclosure and metadata damage.
Each requires evidence of the faulty access or lifetime boundary. A crash, unusual
allocation pattern or integrity-check failure alone does not establish deliberate
exploitation, a specific corruption mechanism or successful privilege escalation.
Do not turn historical metadata-decoding formulas into a current parser contract.

### Public Pool API Boundaries

- `ExAllocatePool2` and `ExAllocatePool3` document Windows 10 version 2004 as
  their minimum supported client. The latter adds extended parameters; match the
  particular parameter contract to the target WDK and OS.
- Pool2 zero-initializes by default unless `POOL_FLAG_UNINITIALIZED` is used.
  Allocation initialization does not cover later buffer reuse or incomplete
  construction of a larger object. Review information disclosure and output
  initialization before removing explicit clearing.
- Review failure handling, quota semantics and pool/access IRQL together.
  At `DISPATCH_LEVEL`, Pool2 requires nonpaged allocation; memory accessed there
  must remain nonpaged even if it was allocated at a lower IRQL.
- Earlier Windows targets require the documented down-level allocation APIs and
  their initialization requirements. Do not assume Pool2 automatically falls
  back to allocation plus clearing on an older kernel.

[ExAllocatePool2](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/wdm/nf-wdm-exallocatepool2),
[ExAllocatePool3](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/wdm/nf-wdm-exallocatepool3).

### KDP and Protected Data

Microsoft's 2020 KDP architecture article describes static data protection and
dynamic secure-pool allocations using VBS/SLAT. It is historical implementation
context, not evidence that a present machine protects every pool allocation or
that an arbitrary Pool3 allocation is secure. Establish the applicable API,
successful protection state, exact region and lifecycle, and the trustworthiness
of the hypervisor and policy path. Content protection does not by itself prove
that every reference to that content, caller or update operation is authorized.
[Microsoft KDP architecture](https://www.microsoft.com/en-us/security/blog/2020/07/08/introducing-kernel-data-protection-a-new-platform-security-technology-for-preventing-data-corruption/)

## Pool Allocation & Forensics

### Attribution and Coverage

Pool tags are caller-supplied labels used by debugging and tracking tools;
PoolMon groups memory use by tag. They are leads for attribution, not
cryptographic driver identities. A rare tag, a shared tag or a lookup in
`pooltag.txt` cannot by itself establish which signed binary allocated a buffer,
that a hidden driver is present, or that the allocation is malicious.
[PoolMon scope](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/using-poolmon-to-find-a-kernel-mode-memory-leak)

If a report invokes `PiDDBCacheTable`, `MmUnloadedDrivers`, `PoolBigPageTable` or
similar internal names, require an exact-build definition, collection method,
retention/coverage limits and supporting artifacts. Do not assume a universal
field layout, complete driver history or a one-to-one relationship between a
pool allocation and a driver object. Missing or malformed data can reflect
image incompleteness, stale symbols, reuse, collection effects or corruption.

### Review Evidence

For an existing authorized image, record its provenance/hash, acquisition time,
OS/architecture, symbol identity, parser version and unavailable regions. Keep
allocation facts, ownership hypotheses and security conclusions separate.
Correlate available allocation stacks, loaded-module provenance, driver/service
records and independent telemetry. Explain benign alternatives before assigning
intent to executable memory, unrecognized tags or unusual allocation counts.

A negative scan describes the selected parser, metadata path and retained
snapshot; it is not proof that all allocations or prior driver activity were
observed. A bugcheck code is a starting point for its parameters, stack and
surrounding state, not a unique allocator-path or attack signature.

Sources for these pool-contract and evidence corrections reviewed: 2026-09-09.

### SSDT Hooking (Legacy)
```
- Modify service table entries
- Requires PG bypass
- High detection risk
```

### IRP Hooking
```
- Hook driver dispatch routines
- Less monitored than SSDT
- Per-driver targeting
```

## Memory Manipulation

### Physical Memory Access
```cpp
MmMapIoSpace
MmCopyMemory
\\Device\\PhysicalMemory
```

### Virtual Memory
```cpp
ZwReadVirtualMemory
ZwWriteVirtualMemory
KeStackAttachProcess
MmCopyVirtualMemory
```

### MDL Operations
```cpp
IoAllocateMdl
MmProbeAndLockPages
MmMapLockedPagesSpecifyCache
```

## Research Tools

### Analysis
- WinDbg / WinDbg Preview
- Process Hacker / System Informer
- OpenArk
- WinArk

### Utilities
- KDU (Kernel Driver Utility)
- OSR Driver Loader
- DriverView

### Monitoring
- Process Monitor
- API Monitor
- ETW consumers
