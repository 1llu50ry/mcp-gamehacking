---
name: vulkan-layer-reference
description: Vulkan loader + implicit-layer reference. VK_LAYER_*.json locations, dispatch tables, vkCreateInstance/Device chaining, overlay hook points.
type: tool-plugin
---

# Plugin: vulkan-layer-reference

Reference for building VK_LAYER_* implicit layers that intercept Vulkan calls at the loader level.

## Install path per OS

- Linux: `/etc/vulkan/implicit_layer.d/`, `~/.config/vulkan/implicit_layer.d/`
- Windows: `HKCU\Software\Khronos\Vulkan\ImplicitLayers` + `HKLM\Software\Khronos\Vulkan\ImplicitLayers`
- macOS: `~/.config/vulkan/implicit_layer.d/`

## Dispatch chaining

- `vkGetInstanceProcAddr` -> own + next in chain
- `vkGetDeviceProcAddr` -> own + next in chain
- Grab base function pointer from `pLayerInfo->pfnNextGetInstanceProcAddr`

## Common hook points

- `vkQueuePresentKHR`
- `vkCmdDrawIndexed`, `vkCmdBindPipeline`
- `vkCreateGraphicsPipelines`
- `vkCmdPushConstants`, `vkCmdBindDescriptorSets`

## Related

[[vulkan-layer-overlay]], [[dxvk-vkd3d-hook]], the `cheat-developer` agent.

<!-- enriched:v2 -->
