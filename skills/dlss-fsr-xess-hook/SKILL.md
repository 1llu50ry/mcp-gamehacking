---
name: dlss-fsr-xess-hook
description: "Hook NVIDIA DLSS / AMD FSR / Intel XeSS upscalers -- intercept the super-resolution path to inject chams via motion-vector + depth buffer analysis."
metadata:
  type: tool-reference
  source: curated
  topics: [dlss, fsr, xess, upscaler, motion-vectors]
---
# DLSS / FSR / XeSS Hooks

Upscalers receive the full G-buffer: color, depth, motion vectors. Hooking the upscaler entry point gives full-frame access without hunting draw calls.

## Entry points
- NVIDIA DLSS: `NGX_D3D11_EVALUATE_DLSS` / `NGX_D3D12_EVALUATE_DLSS`
- AMD FSR: `ffxFsr2ContextDispatch`
- Intel XeSS: `xessD3D12Execute`

## Hook strategy
- VMT swap on the `ID3D12GraphicsCommandList` + inline hook on the upscaler entry.
- Capture color + depth + MV textures; run compute overlay.

## Related
[[directx-12-overlay]], [[reshade-enb-integration]].
