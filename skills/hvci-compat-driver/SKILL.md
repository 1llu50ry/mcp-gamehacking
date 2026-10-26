---
name: hvci-compat-driver
description: "How to build a kernel driver that loads under HVCI / Core Isolation (no RWX pages, no self-modify, no dynamic code). Guidance + what breaks + alternatives."
metadata:
  type: tool-reference
  source: curated
  topics: [hvci, driver, core-isolation, nx, kernel]
---
# HVCI-Compatible Driver

HVCI (Core Isolation / Memory Integrity on Windows 11 24H2) forbids kernel-mode RWX pages and dynamic code generation. Drivers that create or modify executable memory at runtime are blocked.

## What breaks

- Self-modifying trampolines (classic kernel inline hooks).
- `ExAllocatePool2(POOL_FLAG_EXECUTE,...)` -- executable pool allocations rejected.
- JIT'd shellcode in paged pool.
- MmCopyVirtualMemory into executable regions.

## HVCI-friendly patterns

- Pre-compute all code at build time; no runtime patching.
- Use kernel's existing extension points: callback registration (PsSetCreate*NotifyRoutine), filter manager minifilter, WDF.
- For hook-like behavior, use data patches (callback-table rewrites) rather than code patches.

## Research vectors around HVCI

- EPT hooks via a thin hypervisor the OS doesn't know about.
- Guest-level patching in VMs where HVCI isn't on.
- Hypervisor-privileged "co-stealth driver" + unmodified Windows loader.

## Related

[[secure-boot-tpm-vanguard]], [[byovd]], [[hyperv-ept-hook]].
