---
name: dxvk-vkd3d-hook
description: "DXVK / VKD3D-Proton hook techniques -- intercepting Vulkan calls that originate from Direct3D 11/12 games under Proton. Overlay rendering, chams, draw-call capture."
metadata:
  type: tool-reference
  source: curated
  topics: [dxvk, vkd3d, vulkan, proton, overlay, chams]
---
# DXVK / VKD3D Hooks

DXVK/VKD3D translate D3D to Vulkan at the DLL boundary. The resulting Vulkan call stream is what you actually hook when targeting Proton games.

## Where to hook

- `vkQueuePresentKHR` / `vkCreateSwapchainKHR` -- overlay insertion point.
- `vkCmdDrawIndexed` / `vkCmdBindPipeline` -- per-draw-call interception for chams and draw-skip.
- `vkCmdPushConstants` / `vkCmdBindDescriptorSets` -- recover view/proj matrices from CB updates.
- `vkCreateGraphicsPipelines` -- intercept shaders before they are JIT'd; patch SPIR-V.

## Vulkan Layer idiom

A VK_LAYER_* lib listed in the ICD json is loaded by the loader before DXVK sees the device, so you intercept native Vulkan dispatch tables.

## Related

[[steam-deck-game-hacking]], the `rendering` subagents (`screen-capture-reference`, `w2s-calculator`).
