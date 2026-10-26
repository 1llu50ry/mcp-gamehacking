---
name: directx-12-overlay
description: "DirectX 12 overlay via a Present-pointer hook + stealthy command list injection -- how to compose ImGui over a game's DX12 swap chain without stuttering."
metadata:
  type: tool-reference
  source: curated
  topics: [dx12, overlay, imgui, command-list, swapchain]
---
# DX12 Overlay

DX12 overlays are more work than DX11 because of command list ownership + per-frame heaps.

## Setup

1. Hook `IDXGISwapChain3::Present` (vtable[8]) via kiero or inline.
2. Grab `ID3D12CommandQueue` from the swap chain's queue (undocumented but stable: swap chain owns a `pDevice->GetCommandQueue()` ref).
3. Create your own `ID3D12DescriptorHeap` (CBV_SRV_UAV + RTV).
4. Allocate per-frame `ID3D12CommandAllocator` + `ID3D12GraphicsCommandList`.
5. In each Present: reset allocator -> record ImGui draws -> execute on the game's queue.

## Pitfalls

- RTV mismatch: swap chain back-buffer index != your frame index.
- Resource state transitions: Present wants `PRESENT`; your overlay transitions back/forth.
- Multi-threaded command recording in the game: coordinate with a critical section.

## Related

[[directx-state-reference]], [[imgui-widget-library]], the `rendering` subagents.
