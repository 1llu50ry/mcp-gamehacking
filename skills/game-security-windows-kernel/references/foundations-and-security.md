# Foundations And Security

## Driver Attack Surface and Evidence

For event provenance, provider/callback scope and absent telemetry, use
[observation coverage](../../anti-cheat/references/input-provenance-and-measurement.md).

| Threat class | Necessary capability or boundary | Evidence and defensive focus |
|---|---|---|
| Dangerous privileged interface | A caller can reach sensitive driver operations | Device ACLs, per-operation authorization, constrained functionality |
| Vulnerable signed-driver abuse | An affected driver is loaded or loadable and its interface reachable | Exact hash/version, provenance, loaded inventory, applicable policy |
| Driver-mediated acquisition | A host kernel acquisition component and usable interface | Driver/service identity, acquisition process, interface access, timeline |
| Kernel code/data tampering | Ability to modify the affected protected state | Trusted comparison evidence, ownership, protection and integrity events |

Review buffer lengths, output initialization, object lifetime, cancellation,
and IRQL alongside caller authorization. Signed code can still expose unsafe
operations. The table is a threat-model synthesis; actual reachability requires
evidence for the specific build and configuration.
[Microsoft driver security checklist](https://learn.microsoft.com/en-us/windows-hardware/drivers/driversecurity/driver-security-checklist)

Distinguish VBS/HVCI capability, configuration, and running state. Memory
integrity imposes executable-memory constraints; compatibility does not prove
every driver interface or data operation safe.
[Memory integrity compatibility](https://learn.microsoft.com/en-us/windows-hardware/drivers/driversecurity/implement-hvci-compatible-code)

Driver blocklists have incomplete coverage. Distinguish controls that prevent
writing a vulnerable driver to disk from policies that block loading it, and
record the active policy/version rather than assuming protection from the OS name.
[Microsoft driver block rules](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/design/microsoft-recommended-driver-block-rules)

Use Driver Verifier on a recovery-capable test system when evaluating owned
drivers; preserve tested configuration and crash artifacts. It can deliberately
bugcheck a system and does not establish a low false-positive anti-abuse detector.
[Driver Verifier](https://learn.microsoft.com/en-us/windows-hardware/drivers/devtest/driver-verifier)

For acquisition relayed over USB or a network, use the
[source/transport distinction](../../dma-attack/references/acquisition-and-transport.md).
Legitimate incident response can produce the same acquisition artifacts.
Sources in this section were reviewed on 2026-09-09.

## README Coverage

- `Cheat > PatchGuard-related`
- `Cheat > Driver Signature enforcement`
- `Cheat > Windows Kernel Explorer`
- `Cheat > EFI Driver` (cross-reference with game-hacking skill)
- `Cheat > Vulnerable Driver`
- `Anti Cheat > Detection:Attach`
- `Anti Cheat > Detection:Hide`
- `Anti Cheat > Detection:Vulnerable Driver`
- `Anti Cheat > Detection:Spoof Stack`
- `Anti Cheat > Windows Ring3 Callback`
- `Anti Cheat > Windows Ring0 Callback`
- `Anti Cheat > Information System & Forensics`
- `Some Tricks > Windows Ring0`
- `Windows Security Features`

## Core Kernel Concepts

### Important Structures
- EPROCESS / ETHREAD
- KTHREAD / KAPC / KAPC_STATE
- MMVAD / VAD tree nodes
- PEB / TEB
- DRIVER_OBJECT
- DEVICE_OBJECT
- IRP (I/O Request Packet)

### Key Tables
- SSDT (System Service Descriptor Table)
- IDT (Interrupt Descriptor Table)
- GDT (Global Descriptor Table)
- PspCidTable (Process/Thread handle table)
- PiDDBCacheTable / MmUnloadedDrivers / PoolBigPageTable

## User-Mode Kernel Symbol Walking

### Methodology
```
- Load local ntoskrnl image (typically C:\Windows\System32\ntoskrnl.exe)
- Use dbghelp + symbol server path (srv*cache*https://msdl.microsoft.com/download/symbols)
  to resolve exported symbol RVAs and type information
- Build structure-aware field lookup:
  - Query field offset directly (e.g., _EPROCESS.Token)
  - Enumerate all members of a target struct (_TOKEN, _EPROCESS, etc.)
  - Search a field name across all known structs (useful when parent type is unknown)
- Keep symbol path configurable for offline/private symbol repositories
```

### Why It Matters in Game Security
```
- Reduces hardcoded-offset fragility across Windows builds
- Helps map kernel object layouts used by anti-cheat and drivers
- Supports rapid adaptation when anti-cheat-relevant fields shift
  (EPROCESS, ETHREAD, token/handle/security-related members)
```

### Gadget Scanning Workflow
```
- Map executable sections of ntoskrnl image in user mode
- Scan for short control-flow gadgets (e.g., pop rcx ; ret, jmp rax)
- Use as a research primitive for:
  - ROP chain feasibility analysis
  - Kernel exploit mitigation evaluation
  - Anti-cheat hardening review against gadget-dependent attack paths
```

## Security Features

### PatchGuard (Kernel Patch Protection)
```
- Protects critical kernel structures
- Periodic verification checks
- BSOD on tampering detection
- Multiple trigger mechanisms
```

### Driver Signature Enforcement (DSE)
```
- Requires signed drivers
- CI.dll verification
- Test signing mode
- WHQL certification
```

### Virtualization-Based Security (VBS)
```
Architecture:
- Uses the Windows hypervisor to create an isolated execution environment
- Splits the system into Virtual Trust Levels (VTLs)
  - VTL0: Normal world — standard Windows kernel and user-mode processes
  - VTL1: Secure world — Secure Kernel, security policy enforcement
- VTL1 is designed to remain isolated from a compromised VTL0, assuming the
  hypervisor, secure kernel, hardware, and configuration path remain trustworthy
- Three main buckets:
  - Memory-protection features (HVCI)
  - Virtual Trust Levels (VTL0/VTL1 separation)
  - VBS enclaves (isolated execution for selected workloads)
```

### Hypervisor-Enforced Code Integrity (HVCI)
```
- Also known as Memory Integrity
- Ensures only trusted, validated code executes in kernel mode
- Combines Windows hypervisor + Secure Kernel (VTL1) for enforcement
- Key mechanism: W→X transition restriction
  - Enforced code pages are not intended to be writable from VTL0
  - Executability is granted only after the configured code-integrity checks
- Enforcement pipeline:
  - Code integrity policy defines what is trusted
  - Hypervisor memory enforcement via second-stage address translation (EPT/SLAT)
  - Once a kernel page is validated, strict execution rules are enforced
- Driver compatibility requirements: drivers must be HVCI-compatible
```

### Secure Boot
```
- UEFI-based boot verification
- Boot loader chain validation
- Kernel signature checks
- DBX (forbidden signatures)
- Foundation for attestation and DMA-hardening assumptions
```
