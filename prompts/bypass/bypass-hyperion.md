---
name: bypass-hyperion
description: Bypass Hyperion (Byfron) in Roblox
arguments:
  - name: level
    description: 'devirt / dump / hook'
    required: false
---

# Bypass Hyperion (Byfron)

## Steps

1. Capture a current build of RobloxPlayerBeta.
2. Dump decrypted VM image via OEP intercept or `[[angr-mcp]]` symbolic.
3. Cluster handler table + mutation pattern (per-build).
4. Lift semantics to IR (VTIL or custom).
5. Decide bypass path: full devirt (hard) vs targeted handler patch (practical).

## Skills

- [[hyperion-roblox-rev]]
- [[byfron]]

## Related

Pairs with the `roblox-researcher` agent.
