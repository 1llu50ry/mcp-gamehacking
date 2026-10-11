# Rendering Memory And Input

## Overlay & Rendering

### Overlay Methods
- **DirectX Hook**: D3D9/11/12 Present hook
- **Vulkan Hook**: vkQueuePresentKHR hook
- **OpenGL Hook**: wglSwapBuffers hook
- **DWM Overlay**: Desktop Window Manager
- **External Window**: Transparent overlay window
- **Steam Overlay**: Hijacking Steam's overlay
- **NVIDIA Overlay**: GeForce Experience hijack

### Rendering Libraries
- **Dear ImGui**: Immediate mode GUI
- **GDI/GDI+**: Windows graphics
- **Direct2D**: Hardware-accelerated 2D

## Memory Access Methods

### User-Mode
```
- OpenProcess + ReadProcessMemory
- NtReadVirtualMemory
- Memory-mapped files
- Shared memory sections
```

### Kernel-Mode
```
- Driver-based access
- Physical memory access
- MDL-based copying
- KeStackAttachProcess
```

### Advanced Methods
```
- DMA (Direct Memory Access)
- EFI runtime services
- Hypervisor-based access
- Hardware-based (FPGA)
```

## Driver Communication

### Full Taxonomy (40+ methods in README)
```
IOCTL-based:
- Standard DeviceIoControl with custom control codes
- Buffered I/O, Direct I/O, METHOD_NEITHER

Data pointer swaps (abusing legitimate syscalls):
- NtUserGetObjectInformation
- NtConvertBetweenAuxiliaryCounterAndPerformanceCounter
- NtUserRegisterRawInputDevices
- NtGdiGetCOPPCompatibleOPMInformation
- NtDxgkGetTrackedWorkloadStatistics
- NtUserGetPointerInfoList
- NtUserSetInformationThread
- NtDCompositionSetChildRootVisual
- Win32k syscall hooks

Shared memory:
- Named shared sections (ZwCreateSection + ZwMapViewOfSection)
- Physical memory mapping
- Shared event objects for signaling

Callback-based:
- Registry callbacks (CmRegisterCallbackEx)
- Minifilter communication ports (FltCreateCommunicationPort)
- Object callbacks with embedded data

Unconventional channels:
- Named pipes from kernel
- Window messages (NtUserPostMessage)
- ETW provider channels
- Socket from kernel (Winsock Kernel / WSK)
- File system filter callbacks
- Debugging APIs (DbgPrint interception)
```

## World-to-Screen Calculation

### Basic Formula
```cpp
Vector2 WorldToScreen(Vector3 worldPos, Matrix viewMatrix) {
    Vector4 clipCoords;
    clipCoords.x = worldPos.x * viewMatrix[0] + worldPos.y * viewMatrix[4] +
                   worldPos.z * viewMatrix[8] + viewMatrix[12];
    clipCoords.y = worldPos.x * viewMatrix[1] + worldPos.y * viewMatrix[5] +
                   worldPos.z * viewMatrix[9] + viewMatrix[13];
    clipCoords.w = worldPos.x * viewMatrix[3] + worldPos.y * viewMatrix[7] +
                   worldPos.z * viewMatrix[11] + viewMatrix[15];

    if (clipCoords.w < 0.1f) return invalid;

    Vector2 NDC;
    NDC.x = clipCoords.x / clipCoords.w;
    NDC.y = clipCoords.y / clipCoords.w;

    Vector2 screen;
    screen.x = (screenWidth / 2) * (NDC.x + 1);
    screen.y = (screenHeight / 2) * (1 - NDC.y);

    return screen;
}
```

## Input Simulation

### Software Methods
- SendInput API
- mouse_event/keybd_event
- DirectInput hooking
- Raw input injection
- Driver-based input (mouclass)

### Kernel-Level
- Mouse class service callback
- Keyboard filter drivers
- HID manipulation

### Input Sources and Observation Scope

Protocol-conformant input does not authenticate human intent. Raw Input can
identify different source devices, while API-generated input has its own
platform contract; neither observation alone establishes a cheating decision.
[Microsoft Raw Input](https://learn.microsoft.com/en-us/windows/win32/inputdev/about-raw-input),
[Microsoft SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)

Use this comparison as a collection plan, with no concealment ordering:

| Source class | Evidence potentially available | Benign controls and limits |
|---|---|---|
| External HID or input bridge | Device identity/topology, reported input and relevant host associations | Ordinary peripherals, KVMs, remappers and accessibility devices; device names alone do not establish behavior |
| Vendor or other input driver | Exact image/version, service/device ownership and observed operations | Legitimate vendor software; a familiar publisher does not demonstrate a game-specific exemption |
| Input filter component | Driver provenance, configured role and available input-path observations | Authorized filters and accessibility software; presence alone is not a verdict |
| User-mode input API | Caller/path evidence where available, integrity-level context and observed events | UI testing and accessibility; API visibility and collection coverage vary |

Record actual observer access, provider health, sampling, input transformation
and gameplay context. A remote decision process or additional device changes
which components need examination; it does not make the entire pipeline less
observable in every deployment. The table's review criteria are a synthesis,
not a documented guarantee that any one detector collects these fields.

Use [input provenance](../../anti-cheat/references/input-provenance-and-measurement.md)
for units, client uploads and missing samples. Sources reviewed: 2026-09-09.

### KMBox Protocol Details
```
KMBox Net (network variant) — UDP-based protocol:

Packet header (16 bytes, Little-Endian):
Offset  Field      Size   Description
0x00    MAC        4 B    Device UUID (unique per device, used for auth)
0x04    RAND       4 B    Random value or parameter
0x08    INDEXPTS   4 B    Incrementing sequence number (replay protection)
0x0C    CMD        4 B    Command code

Key command codes:
The values below are firmware/API-version examples; verify them against the
exact device implementation before analysis.
Code          Command          Description
0xAF3C2828    connect          Establish connection with device
0xAEDE7345    mouse_move       Direct mouse movement (dx, dy)
0xAEDE7346    mouse_automove   Human-like movement with interpolation
0xA238455A    mouse_beizer     Bézier curve mouse movement
0x9823AE8D    mouse_left       Left button press/release
0x238D8212    mouse_right      Right button press/release
0x97A3AE8D    mouse_middle     Middle button press/release
0xFFEEAD38    mouse_wheel      Scroll wheel
0x123C2C2F    keyboard_all     Keyboard key event

Mouse API functions:
- move(x, y):                 Direct relative movement, no interpolation
- move_auto(x, y, ms):        Interpolated movement over ms milliseconds
- move_beizer(x, y, ms,       Second-order Bézier curve with custom
    x1, y1, x2, y2):          control points for trajectory shaping

Encrypted variants (enc_*):   Same functions with packet-level encryption
                               to resist network packet analysis

Performance:
- Measure command rate, latency distribution, loss, buffering, and jitter on
  the exact firmware, transport, host, and network; fixed figures do not
  transfer across setups

KMBox B / B Pro (serial variant):
- USB CDC serial communication (COM port)
- Baud rate is firmware/configuration-specific (115200 is one common setting)
- Simpler protocol: ASCII or binary command frames
- Benchmark round-trip timing on the deployed serial stack

Physical keyboard/mouse monitoring:
- monitor() function reads real user input from the device
- Enables "pass-through + inject" mode:
  real user input flows through normally,
  AI-calculated deltas are added on top

Arduino / Teensy HID protocol:
- Custom serial command format (typically simple ASCII):
  "M,dx,dy\n"      — mouse move
  "C,button\n"      — click (1=left, 2=right, 3=middle)
  "K,keycode\n"     — keypress
- USB HID report generated by ATmega32U4 (Leonardo)
  or ARM-based Teensy (3.2, 4.0, 4.1)
- HID report descriptor mimics standard mouse:
  buttons (3 bits) + X delta (8-16 bits) + Y delta (8-16 bits)
- No custom driver needed — OS uses generic HID driver

Logitech driver API (exploitable versions):
- G HUB versions prior to certain patches expose internal functions
- Key DLLs: LGS (lcore.dll), G HUB (ghub_mouse.dll or internal APIs)
- ghub_mouse_move(dx, dy) or equivalent internal symbol
- Accessed via DLL injection into GHUB process
  or LoadLibrary + GetProcAddress
- Movement appears as Logitech device input in the HID stack
- Patched in newer G HUB versions; specific version numbers
  circulate in cheat communities
```
