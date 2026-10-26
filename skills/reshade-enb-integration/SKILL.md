---
name: reshade-enb-integration
description: "ReShade and ENB post-processing injection -- DX11/12 effect pipeline, custom shaders, chams via depth-buffer access."
metadata:
  type: tool-reference
  source: curated
  topics: [reshade, enb, shader-mod, chams, post-processing]
---
# ReShade and ENB

ReShade injects a shader pipeline between the game's backbuffer and present. ENB does the same for older DX9. Both wedge in via dxgi.dll proxy. Used for shader-based chams: read depth, compare against world distance, emit outline when enemy-mesh distance less than wall-mesh distance.

## Install surface
- `dxgi.dll` proxy loader next to the game exe.
- ReShade.ini: effect search path, performance mode.
- Compute pass for depth test (`BUFFER_WIDTH` / `BUFFER_HEIGHT`).

## Chams via ReShade
- Read depth via `__DEPTH_LINEAR` samplers.
- Compare enemy shader output vs world depth.
- Emit outline color when ray-depth > vertex-depth (wallhack approx).

Anti-cheat: BE/EAC watch for dxgi.dll proxy; detection depends on build date of the proxy. Vanguard blocks shader hot-reload.

## Related
[[directx-12-overlay]], [[vulkan-layer-overlay]], the `rendering` subagents.
