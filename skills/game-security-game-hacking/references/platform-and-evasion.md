# Platform And Evasion

## EFI/UEFI Threat Boundaries

Classify boot-component tampering, runtime firmware behavior and device-originated
memory access as separate capabilities. Record the boot stage, affected component,
necessary privilege or trust failure, persistence evidence and observation point.
Runtime residency does not by itself demonstrate persistence across a reboot.

Secure Boot, Windows startup integrity and measured-boot assessment address
different parts of the trust chain. An assertion that code runs before the OS,
is test-signed, or uses a firmware interface does not demonstrate acceptance by
the actual configured policy. Preserve firmware/build identity, active trust and
revocation policy, and available measurement evidence.
[Microsoft boot security](https://learn.microsoft.com/en-us/windows/security/operating-system-security/system-security/secure-the-windows-10-boot-process)

Combining firmware and DMA claims establishes no general stealth advantage.
Identify the memory accessor and its trust boundary independently. Microsoft
separates post-OS Kernel DMA Protection from firmware responsibility during boot;
evaluate both stages rather than extending a runtime policy conclusion backwards
through the boot process.
[Kernel DMA Protection](https://learn.microsoft.com/en-us/windows/security/hardware-security/kernel-dma-protection-for-thunderbolt)

Missing OS image-load or driver-bookkeeping evidence must be scoped to the
collector and lifecycle it covers. Corroborate with available boot, firmware,
device and runtime evidence; a quiet channel is not proof that execution was
invisible. Use [windows-kernel](../../windows-kernel/SKILL.md) for callback contracts
and [dma-attack](../../dma-attack/SKILL.md) for acquisition boundaries.
Sources reviewed: 2026-09-09.

## HWID Spoofing

### Targets
```
- Disk serial: IOCTL_STORAGE_QUERY_PROPERTY, SMART data
- NIC MAC address: NDIS OID_802_3_PERMANENT_ADDRESS
- SMBIOS: motherboard serial, system UUID, BIOS vendor
- GPU serial: registry-based or NVAPI/ADL queries
- Monitor EDID: display serial number
- Volume serial: NtQueryVolumeInformationFile
- TPM EK: Endorsement Key fingerprint
```

### Techniques
```
- Disk filter driver: intercept IOCTL and replace serial in response
- Registry value spoofing: modify cached hardware IDs
- SMBIOS table patching: modify raw SMBIOS memory region
- NIC driver hook: replace MAC in NDIS miniport response
- Full HWID spoofer: coordinated spoofing across all identifiers
```

## Stack Spoofing

### Return Address Spoofing
```
- Replace return address on stack before API call
- Restore original after call returns
- Evades stack-walk-based detection (RtlWalkFrameChain)
- Techniques: JMP RBX gadget, synthetic frames, fiber-based
```

### Call Stack Reconstruction
```
- Build fake but plausible call stack frames
- Match expected module return addresses (ntdll, kernel32)
- Evade NtQueryInformationThread stack inspection
- Tools: SpoofCallStack, Vulcan, CallStackSpoofer
```

### Detection & Evasion
```
- Anti-cheat walks thread stacks looking for non-module returns
- Stack unwinding via .pdata / UNWIND_INFO validation
- Spoofed stacks must pass RtlVirtualUnwind consistency checks
```

## Anti-Detection Techniques

### Code Protection
- Polymorphic code
- Code virtualization
- Anti-dump techniques
- String encryption

### Runtime Evasion
- Stack spoofing
- Return address manipulation
- Thread context hiding
- Module concealment
