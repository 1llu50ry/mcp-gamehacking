# Overlays Capture And Measurement

## Overlay Techniques

### External Overlay
```
1. Create transparent window
2. Set WS_EX_LAYERED | WS_EX_TRANSPARENT
3. Use SetLayeredWindowAttributes
4. Render with GDI+/D2D
5. Position over game window
```

### DWM Overlay
```
- Hook Desktop Window Manager
- Render in DWM composition
- Higher privilege requirements
- Observability depends on the actual composition and collection environment
```

### Steam Overlay Hijack
```
- Hook Steam's overlay functions
- Use existing overlay infrastructure
- Requires Steam running
```

### NVIDIA Overlay Hijack
```
- Hook GeForce Experience overlay
- Native-looking overlay
- May require specific drivers
```

## Shader and Depth-State Evidence

Unauthorized shader or pipeline-state changes can alter visibility and
appearance, but the affected stage must be identified. A pixel shader returning
a particular color or alpha does not by itself force depth testing to pass.
Direct3D's output-merger combines shader output with render-target blending and
depth/stencil processing; the bound resources and state matter.
[Microsoft output-merger stage](https://learn.microsoft.com/en-us/windows/win32/direct3d11/d3d10-graphics-programming-guide-output-merger-stage)

For an owned sample or supplied frame capture, preserve the shader identity,
pipeline/depth-stencil state, bound targets, draw order and event context. Compare
with the expected material/render pass, including legitimate debug visualization
and accessibility modes. A colored object or unexpected pixel is evidence to
investigate, not proof of a particular state change or malicious intent.
Source reviewed: 2026-09-09.

## Rendering Concepts

### World-to-Screen
```cpp
D3DXVECTOR3 WorldToScreen(D3DXVECTOR3 pos, D3DXMATRIX viewProjection) {
    D3DXVECTOR4 clipCoords;
    D3DXVec3Transform(&clipCoords, &pos, &viewProjection);

    if (clipCoords.w < 0.1f) return invalid;

    D3DXVECTOR3 NDC;
    NDC.x = clipCoords.x / clipCoords.w;
    NDC.y = clipCoords.y / clipCoords.w;

    D3DXVECTOR3 screen;
    screen.x = (viewport.Width / 2) * (NDC.x + 1);
    screen.y = (viewport.Height / 2) * (1 - NDC.y);

    return screen;
}
```

### View Matrix Extraction
```
- From device constants
- Pattern scanning
- Engine-specific locations
- Reverse engineered addresses
```

## Debugging Tools

### PIX for Windows
- Frame capture and analysis
- GPU profiling
- Shader debugging

### RenderDoc
- Open-source frame debugger
- Multi-API support
- Resource inspection

### NVIDIA Nsight
- Performance analysis
- Shader debugging
- Frame profiling

## Screenshot Evidence and Capture Boundaries

Choose the observation layer before interpreting a screenshot. These mechanisms
have different contracts and do not establish interchangeable coverage:

| Path | Documented scope and evidence limit |
|---|---|
| Window/DC capture | Record the actual API and window. `PrintWindow` asks the owning application to render into the supplied DC; the call is not an independent guarantee of the physical display contents. |
| Desktop Duplication | Acquires desktop data along output boundaries with associated metadata and protected-content restrictions. Record output selection and processing of frame/cursor metadata. |
| Swap-chain presentation observation | Identifies an application presentation operation. DXGI presentation queues can discard frames under documented conditions; a `Present` call does not establish that every submitted frame appeared on the monitor. |
| Render-target readback | Establishes the retained resource at a defined synchronization point, whose relationship to later composition and display must be demonstrated. |

Primary contracts: [PrintWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-printwindow),
[Desktop Duplication](https://learn.microsoft.com/en-us/windows-hardware/drivers/display/desktop-duplication-api),
[DXGI Present](https://learn.microsoft.com/en-us/windows/win32/api/dxgi/nf-dxgi-idxgiswapchain-present).

### Exclusion Claims and Benign Counterexamples

Window display affinity is a platform capture-control mechanism, not a guarantee
that content is unobservable through every route. Microsoft explicitly disclaims
strict content protection. Verify the active OS/composition path and the collector's
result before attributing a missing region to concealment.
[Window display affinity contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity)

`IDXGIOutput::FindClosestMatchingMode` selects a matching display mode; it does not
establish allocation of a hardware overlay plane or screenshot exclusion. Claims
about plane composition need evidence from the actual presentation path.
[Display-mode matching](https://learn.microsoft.com/en-us/windows/win32/api/dxgi/nf-dxgi-idxgioutput-findclosestmatchingmode)

Use owned known-content controls to distinguish capture failure, application
rendering behavior, protected content, output selection, stale frames and actual
content differences. Scheduled snapshots cover their acquisition intervals;
intermittent absence does not establish absence throughout the session. Preserve
capture settings, API return/error information, timestamps and missing frames.
Sources reviewed: 2026-09-09.

## OBS Capture Pipeline and AI Visual Cheat Surface

### OBS Frame Capture Modes
```
OBS is one possible frame source for AI visual systems. Capture implementation
varies by OBS, Windows, graphics API, and source settings, so identify the
active path before inferring artifacts:

Game Capture:
- On supported Windows paths, commonly injects an OBS graphics-capture hook into
  the game and intercepts API-specific presentation/capture points
- Commonly transfers frames through shared graphics resources rather than
  requiring a full CPU readback for every frame
- Often offers low-latency pre-composition capture, but performance and quality
  depend on API, synchronization, settings, and version
- The hook module and resource-sharing behavior may be observable, but they are
  also legitimate OBS activity and are not attribution by themselves

Window Capture:
- May use Windows Graphics Capture, BitBlt, or another version/settings-specific
  backend without injecting a game-capture hook
- Captures a window/composited path; occlusion, cursor, HDR, and latency behavior
  depend on the selected backend
- Attribute the actual API and owning process rather than assuming Desktop
  Duplication

Display Capture:
- Captures a monitor/output through a platform-specific backend such as Desktop
  Duplication or Windows Graphics Capture
- Composition coverage and latency vary; protected content and hardware overlays
  can create exceptions
- A display-source label alone does not establish which processes or modules
  the complete recording configuration interacts with; inspect the active setup

OBS Virtual Camera:
- Outputs captured frames as a virtual camera device
- Can feed AI model running in separate process or machine
- May be discoverable through virtual-camera device registration and media
  pipeline activity, depending on platform and OBS version
```

OBS Window Capture exposes backend selection, including BitBlt and Windows
Graphics Capture in its Windows implementation. Do not equate every Window
Capture configuration with Desktop Duplication or transfer its coverage claims
to another source type. Compare the selected backend and observed frames against
legitimate recording controls.
[OBS Window Capture documentation](https://obsproject.com/kb/window-capture-sources),
[OBS Windows capture implementation](https://github.com/obsproject/obs-studio/blob/master/plugins/win-capture/window-capture.c).
Sources reviewed: 2026-09-09.

### Frame Pipeline for AI Aimbot
```
Capture path (latency-critical):
  Game render → Present hook copies backbuffer
  → Shared GPU texture (ID3D11Texture2D, GPU-side)
  → GPU→CPU readback (staging texture + Map/Unmap)
  → CPU-side frame buffer (system memory)
  → Crop to ROI (Region of Interest, e.g., 640x640 around crosshair)
  → AI inference input (CUDA/TensorRT/DirectML)

OBS plugin form factor:
  AI model implemented as OBS video filter plugin
  → Receives frames through obs_source_frame callback
  → Runs inference in-process
  → Outputs mouse commands to hardware device
  → Appears as "OBS running a filter" to the system

Dual-machine pipeline:
  Game PC OBS → NDI (Network Device Interface) or capture card
  → Cheat PC receives video stream
  → AI inference on cheat PC GPU
  → Mouse commands sent via network to KMBox on game PC
  Added latency depends on capture hardware, buffering, transport, encoding,
  network, synchronization, and receiver configuration

Performance measurement:
  Measure capture, synchronization, transfer/readback, preprocessing, inference,
  postprocessing, transport, and input stages separately on the deployed setup.
  Report percentile end-to-end latency and dropped/stale frames; fixed latency
  budgets do not transfer across hardware and configurations.
```

### Detection-Relevant Graphics Signals
```
- obs-graphics-hook64.dll in game process module list
- IDXGISwapChain::Present hook or detour in game process
- Repeated readback/copy behavior involving staging resources, shared textures,
  or API-specific capture objects; efficient pipelines may reuse resources
- GPU-to-CPU memory copy bandwidth anomaly (Map/Unmap calls
  or equivalent synchronization/readback patterns)
- DXGI shared handle creation from game process to external process
- NDI SDK DLLs loaded (Processing.NDI.Lib.*.dll)
- Virtual camera driver (obs-virtualcam) registered

These are collection signals, not proof of a visual cheat. Correlate them with
plugin provenance, process behavior, trusted gameplay telemetry, and the
legitimate streaming/accessibility context.
```

## Anti-Detection Considerations

### Present Hook Detection
```
- VTable integrity checks
- Code section verification
- Call stack analysis
- Module list scanning for known capture DLLs
```

### Evasion Techniques
```
- Trampoline hooks
- Hardware breakpoints
- Timing obfuscation
```

## Performance Optimization

### Best Practices
```
1. Minimize state changes
2. Batch draw calls
3. Use instancing
4. Cache resources
5. Profile regularly
```

### Common Issues
```
- Flickering: Double buffer sync
- Artifacts: Clear state properly
- Performance: Reduce overdraw
```
