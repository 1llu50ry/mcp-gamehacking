# Research And Threats

## Research Techniques

### Static Analysis
1. Dump and analyze AC drivers
2. Reverse engineer detection routines
3. Identify signature patterns
4. Map callback registrations and trust boundaries

### Dynamic Analysis
1. Monitor system calls
2. Track driver communications
3. Inspect memory layout and module provenance
4. Debug with kernel or hypervisor tools

## Bypass Categories

### Memory Access
- Physical memory read/write
- DMA-based access
- Hypervisor memory virtualization
- Driver-based access

## DMA Cheat Detection Methodology

### PCIe-Layer Detection Pipeline

Compare supported inventory and device observations with a matched, documented
baseline. Record exact SKU/function, firmware, driver, platform topology, power
state, and workload before interpreting an identity or behavior discrepancy.

- Configuration: identifiers, capability structure, OS-assigned resources, and
  collector coverage; an unknown identifier is not an automatic verdict.
- Function: applicable device contract and existing register/driver evidence;
  a zero value or idle device has legitimate explanations.
- Link and errors: negotiated state, platform policy, power/workload context,
  available logs, and missing-data limits.
- Decision: specific discrepancy, plausible benign causes, corroboration, and
  evaluation error rates for the population where the rule will operate.

Windows owns PCI headers and capability registers. A generic collector should
not modify another driver's bus-master, interrupt, BAR, or remapping state as a
live classification probe. Use documented, permitted interfaces and read the
[platform ownership limits](../../dma-attack/references/assurance-boundaries.md).

### Completion Latency Fingerprinting
```
Completion-latency distributions can reflect memory, arbitration, buffering,
power state, link, driver, and workload behavior. A simplistic BRAM-backed
emulator may show unusually low variance, but neither distribution shape is
universal.

Statistical methods:
- Kolmogorov–Smirnov test: compare empirical CDFs vs reference
- Hill estimator: tail index (real silicon has non-trivial tail)
- Anderson-Darling test: sensitive to tail differences

Added random jitter is not equivalent to reproducing a donor distribution.
Validate mean, variance, tails, modes, autocorrelation, and condition changes
against matched hardware.
```

### MSI/MSI-X Behavioral Validation
```
- Device with MSI Enable + programmed Address/Data + attached driver
  should produce interrupts when a verified device condition triggers them
- Zero interrupts when driver should exercise device = anomalous
- Uniform arrival times may indicate timer-driven emulation, but legitimate
  periodic workloads must be excluded
- MSI-X probe: mask vector → induce condition → observe PBA bit →
  unmask → observe interrupt firing. Conforming implementations should preserve
  the expected state transition; incomplete emulations may fail.
```

### Cheat-Phase Access Pattern Recognition
```
One possible pattern is a slow, broad discovery phase followed by narrower,
periodic reads of a smaller offset set during use. Rates and phases vary by
implementation and can be randomized.

Execution phase statistical signature:
- High temporal periodicity
- Low address-space breadth
- Alignment to game-frame intervals
- Distinguishing features: Fano factor, autocorrelation at frame intervals,
  address-space coverage entropy

Decoy evidence must identify the requester and collector. An EPT trap concerns
CPU access; device DMA needs its own remapping/fault or platform evidence.
An application event has different semantics. None alone establishes cheating.
```

### IOMMU-Layer Detection
```
Fault-Rate Monitoring:
- Per-device fault rate from IOMMU fault-recording / WHEA
- Establish a platform-, device-, driver-, and workload-specific benign
  baseline; legitimate bugs, resets, firmware issues, and mapping races can
  produce faults
- A sustained nonzero rate is evidence of failed or invalid DMA requests, not
  by itself evidence of cheating or actor intent

Domain Assignment Audit:
- Flag devices on passthrough/identity domains under strict mode
- Flag unexpectedly large IOMMU groups (poor ACS topology)
- Verify multi-function devices sharing Domain ID legitimately

ACS Topology Verification:
- Walk bridge topology, verify Source Validation, Translation Blocking,
  P2P Request/Completion Redirect on every relevant bridge
- Missing/disabled ACS is a potential isolation gap where peer routing is
  possible; confirm the full topology, root-complex behavior, and IOMMU grouping
```

### IOMMU Containment Boundaries

Identify the OS/platform authority for device isolation, the affected hierarchy,
current mappings, in-flight work, recovery owner, and evidence of completed
isolation. Remapping, bus-master state, and downstream-port containment have
separate prerequisites; their effectiveness is not determined by a firmware tier.

A generic game-security driver must not take ownership of another driver's PCI
configuration or remapping state. Use documented platform lifecycle/policy
controls, evaluate availability effects, and separate authorized access restriction
from a sanction decision.
[Containment contract](../../dma-attack/references/assurance-boundaries.md)

### External Trust Anchors

Attestation can support confidence in selected measurements when key enrollment,
verifier trust, freshness, measurement-log consistency, and appraisal policy are
validated. It does not automatically reveal a present DMA device or every live
IOMMU mapping, and a manufacturer certificate is not a universal attestation-key
trust chain.

PCR meanings and reset/extend rules depend on the platform profile. The Windows
OEM DMA-protection event has a specified scope; interpret absence only with an
applicable and trustworthy measurement path. Keep measured boot, runtime evidence,
and protection-policy compliance as separate findings.
[TPM and platform evidence](../../dma-attack/references/assurance-boundaries.md)

### Layered Detection Synthesis
```
No single signature is durable. Production pipeline layers:

1. Pre-game: record platform support, effective remapping and security policy,
   observed-running services, applicable firmware fixes, topology, attestation
   coverage, and explicit unknowns; apply a documented deployment baseline

2. Inventory: supported device/configuration snapshot with readable span,
   missing fields, problem codes, and SMBIOS slot cross-reference

3. Config integrity: per-donor reference database comparison

4. Behavioral sampling: Link Status, AER counters, interrupt rates,
   IOMMU fault rates, BAR content

5. Statistical analysis: latency distributions, interrupt distributions,
   ASPM transition rates

6. Cheat-phase: honeypot access, access pattern classifiers

Verdict requires multi-signal correlation — single signals can
false-positive. Use causally distinct signals and measure the joint error rate;
correlated detectors can fail together, and no fixed signal count guarantees a
practical false-positive rate.
```

### Device Evidence Instead of Firmware Tiers

Public/private labels and informal tier numbers are not validated assurance
levels. Evaluate identity/provenance, configuration/function, runtime behavior,
remapping policy, and platform trust separately. An identifier match can support
a classification rule only within its evaluated scope; it does not imply
immediate detection or malicious intent. No device label establishes that TPM
attestation is necessary or sufficient for its detection.

Report observed dimensions, untested properties, collector requirements, matched
benign baselines, and measured decision error rates.
[Device evidence dimensions](../../dma-attack/references/assurance-boundaries.md)

### Forensic Evidence for DMA Cases
```
Capture on detection:
- Supported configuration snapshot and capability structure, with missing fields
- PCIe link state history (LTSSM, ASPM transitions)
- MSI/MSI-X arrival timeline
- AER correctable counts
- IOMMU fault log entries + domain assignments
- ACS bridge state
- Protected-page CPU events (EPT evidence, with policy context)
- Device DMA events from the relevant platform/IOMMU collector
- TPM quote, selected measurement profile, and consistent event log
- MCFG / DMAR / IVRS ACPI tables
- SMBIOS slot inventory + BIOS version
- Completion latency distribution histograms

A useful evidence package combines hardware, behavioral, and temporal signals.
The combined package is stronger only when provenance is trusted, alternative
causes are tested, and the joint false-positive behavior is validated.
```

### Code Execution
- Manual mapping
- Thread hijacking
- APC injection
- Kernel callbacks

### Detection Evasion
- Signature mutation
- Timing attack mitigation
- Stack spoofing
- Module hiding

## Security Features Interaction

### Windows Security
- Driver Signature Enforcement (DSE)
- PatchGuard/Kernel Patch Protection
- Hypervisor Code Integrity (HVCI)
- Secure Boot
- TPM-backed attestation considerations

### Virtualization Detection
- VT-x/AMD-V detection
- Hypervisor presence checks
- VM escape detection
- Timing-based detection

### Hypervisor-Based Defense for Anti-Cheat

A trusted hypervisor can enforce processor memory permissions outside the guest
kernel's direct control. This is conditional isolation, not a guarantee that
all kernel-level tampering is prevented. Verify the actual integration, protected
regions and lifetimes, policy/configuration authority, backing-memory isolation,
and coverage of other privileged access paths.

EPT violations concern CPU access under an active policy. Device DMA uses the
separate IOMMU path; a hypervisor may manage both, but EPT alone is neither DMA
protection nor DMA telemetry. Conversely, device DMA does not universally defeat
a hypervisor deployment that also enforces appropriate IOMMU policy.

Operating outside the guest kernel does not imply invisibility. Hyper-V provides
guest-visible discovery interfaces, and performance or compatibility effects may
also be observable. Presence alone identifies neither misuse nor specific
protection coverage.

Treat VBS/memory integrity, driver-blocking policy, and DMA remapping as separate
controls with deployment and compatibility requirements. Memory integrity does
not make every signed driver safe. Report supported, configured, and running
state; a missing feature is not by itself misconduct. Use existing trusted
platform evidence and owned-build review to verify these assumptions.
[Hypervisor and DMA assurance](../../dma-attack/references/assurance-boundaries.md)

## Code Protection Techniques

### Page Protection
```
- Executable page guard pages and trap-based integrity monitoring
- NX bit enforcement and DEP policy
- PAGE_GUARD + single-step trap for code coverage without patching
- VirtualProtect monitoring to detect runtime permission changes
```

### Binary Packing & Encryption
```
- PE packers: UPX, Themida, VMProtect, Enigma, MPRESS
- CLR protection: .NET obfuscation (ConfuserEx, Dotfuscator, .NET Reactor)
- Encrypt Variable: runtime value encryption to frustrate memory scanners
- Lazy Importer: compile-time import hiding to avoid IAT-based detection
- Compile-time techniques: string encryption, constexpr obfuscation, COFF obfuscation
```

### Shellcode & Obfuscation
```
- Shellcode engines: position-independent code generation, syscall stubs
- Obfuscation engines: OLLVM-based, custom LLVM passes, MBA (Mixed Boolean-Arithmetic)
- Anti-disassembly: opaque predicates, junk code insertion, control flow flattening
```

## Heartbeat & Screenshot

### Heartbeat Mechanisms
```
- Periodic client-to-server health check packets
- Encrypted challenge-response with server nonce
- Timing anomalies can reflect scheduling, transport, collector or backend
  faults as well as other causes; diagnose the observation path first
- Apply documented access-continuity policy separately from misconduct
  attribution; heartbeat failure alone does not establish grounds for a sanction
```

### Screenshot Capture
```
- AC-initiated screen capture for manual or automated review
- BitBlt / PrintWindow / DXGI desktop duplication
- Anti-screenshot evasion: overlay hiding, DWM composition bypass
- Server-side ML classifiers for ESP/overlay detection in captured frames
```

## Telemetry Pipeline

### Client-Side Collection
```
- Module list enumeration and hash reporting
- Handle table snapshots for suspicious access patterns
- Stack trace sampling at periodic intervals
- Driver load events and callback registration state
- Hardware fingerprint (disk serial, NIC MAC, SMBIOS, GPU)
```

### Transport & Server-Side
```
- Encrypted telemetry channel (TLS + custom encryption layer)
- Server-side aggregation and anomaly scoring
- ML-based behavioral clustering for ban waves
- Replay system integration for suspicious session review
```

## Ethical Considerations

### Research Guidelines
- Focus on understanding, not exploitation
- Report vulnerabilities responsibly
- Respect Terms of Service implications
- Consider impact on gaming communities

### Legal Aspects
- DMCA considerations
- CFAA implications
- Regional regulations
- ToS enforcement
