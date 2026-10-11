# Apis And Rendering

## Rendering and Capture Threat Model

Distinguish application render targets, presentation queues, compositor
output, physical display output, and captured images. A capture is an observation
at one layer, not an interchangeable copy of every other layer.

Classify unauthorized in-process graphics changes, separate-process overlay
abuse, and inappropriate frame access by the required capability. Correlate
module provenance, graphics-layer configuration, resource ownership, capture
process identity, and timing where available. Include legitimate recording,
debugging, accessibility, and vendor tools as counterexamples.

For owned sample applications, record a coverage matrix: API, OS/driver,
windowed/fullscreen state, presentation model, HDR/SDR, monitors, capture
backend, cursor handling, and timestamps. Black, missing, or stale frames need
candidate explanations; they are not sufficient evidence of concealment.

- DXGI composition, DirectFlip, and Independent Flip depend on configuration;
  a fixed assumption about compositor involvement is unreliable.
  [Microsoft flip-model guidance](https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/for-best-performance--use-dxgi-flip-model)
- Desktop Duplication is a particular acquisition path with its own behavior
  and protected-content restrictions.
  [Desktop Duplication API](https://learn.microsoft.com/en-us/windows-hardware/drivers/display/desktop-duplication-api)
- Vulkan validation and synchronization validation diagnose API/resource misuse.
  Preserve VUIDs, SDK/layer versions, and diagnostics; a validation finding is
  not an anti-abuse verdict.
  [Khronos development tools](https://docs.vulkan.org/guide/latest/development_tools.html)
- Windows documents `SwapBuffers` through GDI. Do not assume a similarly named
  wrapper or hook-library symbol is the platform contract.
  [Microsoft SwapBuffers](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-swapbuffers)

Sources above were reviewed on 2026-09-09. Use the active path and measured
controls when interpreting older API examples in this skill.

## README Coverage

- `DirectX > Guide`
- `DirectX > Hook`
- `DirectX > Tools`
- `DirectX > Emulation`
- `DirectX > Compatibility`
- `DirectX > Overlay`
- `OpenGL > Guide`
- `OpenGL > Source`
- `OpenGL > Hook`
- `Vulkan > Guide`
- `Vulkan > API`
- `Vulkan > Hook`
- `Cheat > Overlay`
- `Cheat > Render/Draw`
- `Cheat > Anti Screenshot`
- `Anti Cheat > Screenshot`
- `Anti Cheat > Detection:Overlay`

## DirectX

### DirectX 9
```cpp
// Key functions to hook
IDirect3DDevice9::EndScene
IDirect3DDevice9::Reset
IDirect3DDevice9::Present
```

### DirectX 11
```cpp
// Key functions to hook
IDXGISwapChain::Present
ID3D11DeviceContext::DrawIndexed
ID3D11DeviceContext::Draw
```

### DirectX 12
```cpp
// Key functions to hook
IDXGISwapChain::Present
ID3D12CommandQueue::ExecuteCommandLists
```

### VTable Hooking
```cpp
// DX11 Example
typedef HRESULT(__stdcall* Present)(IDXGISwapChain*, UINT, UINT);
Present oPresent;

HRESULT __stdcall hkPresent(IDXGISwapChain* swapChain, UINT syncInterval, UINT flags) {
    // Render overlay here
    return oPresent(swapChain, syncInterval, flags);
}

// Hook via vtable
void* swapChainVtable = *(void**)swapChain;
oPresent = (Present)swapChainVtable[8];  // Present is index 8
```

## OpenGL

### Key Functions
```cpp
wglSwapBuffers
glDrawElements
glDrawArrays
glBegin/glEnd (legacy)
```

### Hook Example
```cpp
typedef BOOL(WINAPI* wglSwapBuffers_t)(HDC);
wglSwapBuffers_t owglSwapBuffers;

BOOL WINAPI hkwglSwapBuffers(HDC hdc) {
    // Render overlay
    return owglSwapBuffers(hdc);
}
```

## Vulkan

### Key Functions
```cpp
vkQueuePresentKHR
vkCreateSwapchainKHR
vkCmdDraw
vkCmdDrawIndexed
```

### Instance/Device Layers
- Use validation layers for debugging
- Custom layers for interception
- Layer manifest configuration

## Universal Hook Libraries

### Kiero
- Cross-API hook library
- Supports DX9/10/11/12, OpenGL, Vulkan
- Automatic method detection

### Universal ImGui Hook
- Pre-built ImGui integration
- Multiple API support
- Easy deployment

## ImGui Integration

### Setup (DX11)
```cpp
// In Present hook
ImGui_ImplDX11_Init(device, context);
ImGui_ImplWin32_Init(hwnd);

// Render
ImGui_ImplDX11_NewFrame();
ImGui_ImplWin32_NewFrame();
ImGui::NewFrame();

// Your rendering code
ImGui::Begin("Overlay");
// ...
ImGui::End();

ImGui::Render();
ImGui_ImplDX11_RenderDrawData(ImGui::GetDrawData());
```

### Window Procedure Hook
```cpp
// Required for ImGui input
LRESULT CALLBACK WndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (ImGui_ImplWin32_WndProcHandler(hWnd, msg, wParam, lParam))
        return true;
    return CallWindowProc(oWndProc, hWnd, msg, wParam, lParam);
}
```
