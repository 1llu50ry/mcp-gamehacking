---
name: hyperv-ept-hook
description: "EPT hook via a thin hypervisor (Hyperplatform / bareflank / ddimon) -- how to shadow a page's R and X views so AC sees untouched code while execution hits the hook."
metadata:
  type: tool-reference
  source: curated
  topics: [hypervisor, ept, vmx, shadow-page, hook]
---
# EPT Hook via Thin Hypervisor

EPT split lets you serve two physical pages to the guest for the same GPA: one for reads (clean), one for exec (patched). Anti-cheat scans see the clean page; the CPU executes the patched one.

## Setup

1. Allocate two 4K pages: `clean_page` (copy of victim) and `patched_page` (hook trampoline).
2. In the VMM, locate the EPT PTE for the victim's GPA.
3. First state: PTE points at `clean_page`, R=1, W=0, X=0.
4. On EPT violation (X=0 trap), swap PTE to `patched_page`, R=0, W=0, X=1; set MTF (Monitor Trap Flag).
5. On MTF VM-exit, swap back to clean.

## Pitfalls

- Must invept after every PTE swap.
- SMP: shootdown IPI across cores to flush remote TLB.
- HVCI compatibility: the host hypervisor must not install itself over HVCI (either run before HVCI or use nested VMX).

## Related

[[hvci-compat-driver]], [[secure-boot-tpm-vanguard]], the `hypervisor-researcher` agent.
