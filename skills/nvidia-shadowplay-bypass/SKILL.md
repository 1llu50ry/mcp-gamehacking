---
name: nvidia-shadowplay-bypass
description: "NVIDIA ShadowPlay / NvContainer anti-detection — ShadowPlayPatch pattern, manual-map of a shim DLL into NvContainer, byte-patch tables to blind ShadowPlay's capture-detection probe used by some anti-cheats."
metadata:
  type: reference
  source: curated
  topics: [nvidia, shadowplay, nvcontainer, manual-map, capture-detect]
---
# NVIDIA ShadowPlay bypass

Some anti-cheats query NVIDIA ShadowPlay / GeForce Experience to confirm the player is streaming or capturing. ShadowPlay also hooks the game's present chain for recording. Hiding both from the anti-cheat is one of the goals of a cheat.

## Technique

- Enumerate NvContainer-* processes via `CreateToolhelp32Snapshot`.
- Manual-map a shim DLL into NvContainer process (via a kernel-side writer or BYOVD).
- Shim installs byte-patches on NVAPI entry points that return 'ShadowPlay disabled' to anti-cheat probes.
- Shim also strips the ShadowPlay capture hook from the game's present chain so AC can't observe a secondary SwapChain capture pointer.

## Why anti-cheats care

- An unexplained second SwapChain capture pointer = overlay suspicion.
- Anti-cheats fingerprint ShadowPlay's hook signature; a mismatch suggests tampering.

## Related

[[cheat-attack-surface]], [[dxvk-vkd3d-hook]], [[directx-12-overlay]], [[anti-screenshot]].
