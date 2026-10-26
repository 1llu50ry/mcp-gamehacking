---
name: steam-deck-game-hacking
description: "Steam Deck / Proton game hacking -- how Proton (Wine + DXVK + VKD3D) rewrites D3D11/D3D12 to Vulkan, where to inject into a Proton-wrapped game, SteamOS/Arch internals."
metadata:
  type: tool-reference
  source: curated
  topics: [steam-deck, proton, wine, dxvk, vkd3d, vulkan, linux]
---
# Steam Deck + Proton Reverse Engineering

Proton = Wine + DXVK (D3D11->Vulkan) + VKD3D-Proton (D3D12->Vulkan) + Steamworks shim. Games run inside Wine prefixes under SteamOS (Arch-based).

## Attach vectors

- **LD_PRELOAD into Wine's `wine64-preloader`**: inject native Linux .so's that Wine then exposes to the Windows game.
- **Vulkan layer**: write a `VK_LAYER_*` that intercepts vkQueuePresent for in-game overlay (Vulkan is the real backend).
- **Wine DLL overrides**: `WINEDLLOVERRIDES="d3d11=n,b"` to force native DLL at load time.
- **gdb attach**: works on Proton processes with debug build or `WINEDEBUG=+relay`.

## Anti-cheat compatibility

- EAC and BattlEye both ship Proton builds. They use Wine's `winevulkan` and still enforce signatures.
- Vanguard does not run on Proton (no HVCI / TPM on Deck in standard mode).
- Server-side VACnet still applies.

## Related

[[dxvk-vkd3d-hook]], [[frida-mcp]], the `cheat-developer` agent, and the `windows-internals-agent` (Wine mimics NT).
