---
name: vulkan-layer-overlay
description: "Vulkan overlay via a VK_LAYER_* installed in the loader's ICD path -- intercepts vkQueuePresentKHR for Proton games + native Linux + Switch/Android emulators."
metadata:
  type: tool-reference
  source: curated
  topics: [vulkan, overlay, vk-layer, icd, proton]
---
# Vulkan Overlay (via VK_LAYER)

Instead of hooking the game's PE/ELF, drop a Vulkan layer at the loader level. Loader loads your layer before the game sees the device.

## Install

- Linux: write `~/.config/vulkan/implicit_layer.d/your_layer.json`.
- Windows: `HKCU\Software\Khronos\Vulkan\ImplicitLayers`.
- The JSON points at a `.so` / `.dll` exporting `vkGetInstanceProcAddr`.

## Intercept points

- `vkCreateInstance` / `vkCreateDevice` -- store dispatch pointers.
- `vkQueuePresentKHR` -- draw your overlay here.
- `vkCreateSwapchainKHR` -- recreate overlay resources on size change.

## AC implications

- `vkQueuePresentKHR` is below any usermode AC hook that watches game modules.
- BE/EAC on Proton: the layer runs inside the Wine process; still visible via module list.

## Related

[[dxvk-vkd3d-hook]], [[steam-deck-game-hacking]], the `rendering/overlay-reference` plugin.
