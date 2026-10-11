# Engines Rendering And Network

## Unity Mobile Games

### IL2CPP Analysis
```
1. Locate libil2cpp.so (Android) or UnityFramework (iOS)
2. Find global-metadata.dat
3. Run IL2CPPDumper
4. Generate SDK/headers
5. Hook target functions
```

### Mono Analysis
```
1. Extract managed DLLs
2. Decompile with dnSpy/ILSpy
3. Modify and repackage
4. Or hook at runtime
```

### Common Targets
```
- Currency/coins values
- Player stats (health, damage)
- Inventory manipulation
- Premium unlocks
- Ad removal
```

## Unreal Mobile Games

### Analysis Approach
```
1. Identify UE version
2. Dump SDK using appropriate tool
3. Locate GObjects, GNames
4. Find target functionality
5. Apply memory patches or hooks
```

## Overlay Rendering (Android)

### Surface-Based
```cpp
// Native surface overlay
ANativeWindow* window = ANativeWindow_fromSurface(env, surface);
// Render using OpenGL ES or Vulkan
```

### ImGui Integration
- Zygisk + ImGui modules
- Surface hijacking
- Direct framebuffer access

## Network Analysis

### Authorized Transport Observation

Use existing captures or an owned test build to distinguish connection metadata,
TLS validation and decrypted application content. A proxy or packet record only
covers traffic visible at that observation point; it does not establish that
all networking libraries or the release build use the same trust configuration.

### Trust Configuration and Pinning Evidence

For Android, inspect the actual networking stack, target SDK, manifest-linked
Network Security Configuration, domain policy and build variant. Android's
documented default CA trust changes with the target SDK; debug-only trust anchors
apply when the application is debuggable. A successful debug capture cannot
establish release-build trust or pinning behavior.

A replacement Java trust manager is not a universal TLS or certificate-pinning
analysis method: custom/native stacks and independently configured checks require
their own contracts and evidence. Preserve the test configuration, relevant
validation result and unobserved paths. Review authorized debug configuration
and release checks without weakening production trust or publishing a bypass
recipe. Consult iOS-specific trust contracts separately.
[Android Network Security Configuration](https://developer.android.com/privacy-and-security/security-config),
[unsafe trust-manager guidance](https://developer.android.com/privacy-and-security/risks/unsafe-trustmanager).

Source reviewed: 2026-09-09.

## Anti-Cheat on Mobile

### Common Systems
- **Tencent ACE**: Chinese games
- **NetEase Protection**: NetEase games
- **Custom solutions**: Per-game implementations

### Detection Methods
```
- Root/jailbreak detection
- Frida detection
- Emulator detection
- Integrity checks
- Debugger detection
- Hook detection
```

### Detection Finding Review

For a claimed integrity failure, identify the signal, observer, required attacker
capability and the boundary affected. Correlate available package, process,
platform and server evidence with legitimate debug/development use. Missing
instrumentation telemetry or one passed local check does not establish an
unmodified device or a successful concealment technique. Retain collection
limits and uncertain attribution in the final finding.
