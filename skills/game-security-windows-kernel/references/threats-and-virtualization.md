# Threats And Virtualization

## Vulnerable Driver Exploitation

### Common Vulnerability Types
- Arbitrary read/write primitives
- IOCTL handler vulnerabilities
- Pool overflow
- Use-after-free

### Notable Vulnerable Drivers
```
- gdrv.sys (Gigabyte)
- iqvw64e.sys (Intel)
- MsIo64.sys
- Mhyprot2.sys (Genshin Impact)
- dbutil_2_3.sys (Dell)
- RTCore64.sys (MSI)
- Capcom.sys
```

### Exploitation Steps
1. Load vulnerable signed driver
2. Trigger vulnerability
3. Achieve kernel read/write
4. Disable DSE or load unsigned driver
5. Execute arbitrary kernel code

## PatchGuard Bypass Techniques

### Timing-Based
- Predict PG timer
- Modify between checks

### Context Manipulation
- Exception handling
- DPC manipulation
- Thread context tampering

### Hypervisor-Based
- EPT manipulation
- Memory virtualization
- Intercept PG checks

## EFI/Boot-Time Threats

### EFI Driver Cross-Reference
```
The README's > EFI Driver subcategory (under Cheat) contains 30+ projects:
- EFI bootkit frameworks: UEFI DXE drivers that persist across boots
- Boot-time memory mappers: inject code before Windows kernel initializes
- ExitBootServices hooks: intercept Windows boot handoff
- EFI runtime service abuse: GetVariable/SetVariable for kernel ↔ EFI comm

See also: game-hacking skill for EFI cheat workflows
```

### Boot-Time Access
```
- EFI runtime services persist after ExitBootServices
- DXE (Driver Execution Environment) phase: full hardware access
- Pre-kernel execution: no DSE, no PatchGuard, no HVCI enforcement
- Secure Boot is the primary mitigation (firmware signature verification)
```

### Memory Access
```
- GetVariable/SetVariable: pass data between EFI and OS runtime
- Runtime memory mapping via EFI memory map
- Physical memory access before Windows memory manager initializes
- ACPI table injection for persistent low-level modifications
```

## Hypervisor Development

### Hypervisor Types
```
Type 1 (bare-metal):
- Runs directly on hardware
- Examples: VMware ESXi, Microsoft Hyper-V, Xen
- Used for VBS, production security enforcement

Type 2 (hosted):
- Runs on top of a host operating system
- Examples: Oracle VirtualBox, VMware Workstation
- Common for research, development, and testing
```

### Hardware Virtualization Platforms
```
Intel VT-x:
- Introduced 2005, widely supported on modern Intel CPUs
- Foundation for VMCS, EPT, VM exits

AMD-V (SVM):
- AMD's counterpart to VT-x, also introduced 2005
- VMCB structure, NPT (Nested Page Tables)

ARM Virtualization Extensions:
- EL2 (hypervisor mode) and stage-2 memory translation
- Used on ARM platforms for mobile and embedded security
```

### Intel VT-x Core Concepts

#### VMCS (Virtual Machine Control Structure)
```
Central data structure for Intel VT-x:
- Describes guest state, host state, and virtualization controls
- Tells the processor:
  - What state to restore on VM entry
  - What state to save on VM exit
  - Which events transfer control back to the hypervisor

Guest/Host State Areas:
- Control registers (CR0, CR3, CR4)
- Segment registers (CS, SS, DS, ES, FS, GS)
- Debug registers (DR7 — hardware breakpoints)
- Descriptor-table registers (GDTR, IDTR)
- Key fields:
  - CR3: root of guest page tables, central to virtual memory
  - GDTR/IDTR: Global/Interrupt Descriptor Tables
  - CS/SS: code and stack segments
  - DR7: hardware breakpoint control

Control Fields:
- Pin-based controls
- Primary processor-based controls
- Secondary processor-based controls
- Events that cause VM exits:
  - CPUID interception
  - INVLPG interception
  - Control-register access
  - EPT violations
  - MSR access
```

#### EPT (Extended Page Tables)

EPT is Intel's second-stage translation for guest-physical to host-physical
addresses; guest page tables separately translate guest virtual addresses.
Review the processor capabilities and active virtualization controls before
assuming a paging depth, page size or particular handling of a denied access.
A four-level diagram describes one configuration, not every implementation.
[Intel system-programming manuals](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html)

Second-stage permissions constrain CPU access to the configured guest mappings.
They do not themselves identify the responsible module or decide whether an
operation is legitimate. Device-originated access needs its own IOMMU and device
policy analysis; use [DMA analysis](../../dma-attack/SKILL.md). A guest virtual
address or module name must be correlated with the observed mapping and execution
context before making an attribution claim.

#### VM Exits & VMCALL
```
VM Exits:
- Occur when configured events happen in the guest
- Triggers: CPUID, CR access, I/O instructions, EPT violations, MSR access
- On exit: processor saves guest state (per VMCS), restores host state,
  records exit reason for hypervisor handler

VMCALL:
- Guest intentionally transfers control to hypervisor
- Similar in concept to a system call (guest → hypervisor)
- Used for guest-hypervisor communication interfaces
```

#### Nested Virtualization
```
- Running a hypervisor inside a VM managed by another hypervisor
- Useful for research, testing, and development
- Adds complexity: multiple layers participate in the same virtualization flow
- Relevant for testing hypervisor-based defense under VMware/Hyper-V
```

### AMD-V (SVM)
- VMCB (Virtual Machine Control Block) structure
- NPT (Nested Page Tables) — AMD's SLAT equivalent
- SVM operations (VMRUN, VMSAVE, VMLOAD)

### Review Use Cases

Use virtualization evidence to examine guest isolation, authorized introspection
and integrity policy. Treat unauthorized concealment or tampering as threat
categories with explicit access prerequisites and observation limits; the
presence of virtualization is also normal for development and platform security.

### Windows Hypervisor Platform (WHP) API

WHP exposes user-mode APIs to manage guest partitions, virtual processors and
guest-physical mappings using the Windows hypervisor. It does not grant a tool
arbitrary control over the running host kernel. Record the host/guest boundary,
Windows build, architecture, SDK, feature state and actual capabilities.
[WHP API contract](https://learn.microsoft.com/en-us/virtualization/api/hypervisor-platform/hypervisor-platform)

The current `WHvRunVirtualProcessor` contract lists Windows 10 version 1803 for
x64 and Windows 11 version 24H2 build 26100.3915 for Arm64. Its successful return
and exit context describe a stop in guest execution, not complete tracing of
every instruction or a deterministic replay. Capabilities and available exit
contexts are architecture- and configuration-dependent; there is no generic
`syscall` exit reason in the documented enumeration. Correlate the actual reason
and context with the analysis question.
[Run contract](https://learn.microsoft.com/en-us/virtualization/api/hypervisor-platform/funcs/whvrunvirtualprocessor),
[exit contexts](https://learn.microsoft.com/en-us/virtualization/api/hypervisor-platform/funcs/whvexitcontextdatatypes),
[capabilities](https://learn.microsoft.com/en-us/virtualization/api/hypervisor-platform/funcs/whvgetcapability).

Preserve unmodeled device, scheduler, timing and concurrency effects in a result.
A CPU feature name or enabled optional feature alone does not prove that a given
analysis tool, nested environment or third-party hypervisor combination is
supported. Use product/build-specific evidence for compatibility; do not impose
a universal coexistence or conflict rule.

## Hypervisor-Based Defense

### Enforcement Boundary

A trusted hypervisor can enforce a separate guest-memory protection boundary.
Windows VBS/KDP is one concrete architecture; other platforms' isolated execution
environments require their own contracts and must not be equated with EPT hooks.
Protecting selected data also differs from validating kernel code, authenticating
an administrative request or preserving a detector's end-to-end coverage.
[Microsoft KDP architecture](https://www.microsoft.com/en-us/security/blog/2020/07/08/introducing-kernel-data-protection-a-new-platform-security-technology-for-preventing-data-corruption/)

### Conditions for a Supported Protection Claim

| Review question | Evidence required |
|---|---|
| What is covered? | Exact protected memory, active mappings, access class and lifecycle; names such as callback list or ETW structure are not enough |
| Who owns the policy? | Hypervisor/security-component provenance and the authority allowed to change mappings or configuration |
| Was an access observed? | Available fault/exit context, collection coverage and correlation with the relevant mapping and execution context |
| Was the operation prevented? | Enforced decision and resulting state; a reported exit alone does not establish denial or continuing integrity |
| What remains outside scope? | Unprotected aliases or state, permitted update paths, device DMA, firmware and independent event or service failures |

For a vulnerable-driver threat, first establish the affected driver's presence,
reachable interface and required privilege. A claim that attempted kernel data
tampering was blocked additionally requires the protection evidence above.
Do not infer that every driver-mediated write would fault or that every callback
remains intact merely because a hypervisor is installed.

A CPU fault gives machine context; identifying a trustworthy principal and
handling an allowed update are separate policy problems. Report detection,
prevention, post-event integrity and recovery as different outcomes. Guest-kernel
compromise does not automatically defeat an independently enforced boundary,
but that claim assumes the hypervisor, hardware and configuration path remain
trustworthy. Preserve those assumptions and any missing coverage explicitly.

Sources for these virtualization-boundary corrections reviewed: 2026-09-09.
