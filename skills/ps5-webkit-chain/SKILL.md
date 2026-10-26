---
name: ps5-webkit-chain
description: "PS5 kernel exploitation entry point via WebKit -- known chains (TheFloW, FontFace), JSC heap primitives, kernel pivot."
metadata:
  type: tool-reference
  source: curated
  topics: [ps5, webkit, exploit, jsc, kernel]
---
# PS5 WebKit Entry Point

PS5 jailbreaks publicly rely on a WebKit JSC bug chained to a kernel bug.

## Public chains

- **TheFloW's WebKit chain** (6.00+): fontface + heap spray -> arbitrary R/W in JSC -> ROP into Blink -> IPV6 kernel exploit.
- Successor chains target IPv6 route cache races.

## Scope

- No persistent write; soft-mod only (reboot clears).
- Enables game backup launch, HEN, future hypervisor research.

## Related

Pairs with [[switch-atmosphere-rev]] for console RE context; [[hopper-mcp]] for Mach-O-ish FreeBSD PRX.
