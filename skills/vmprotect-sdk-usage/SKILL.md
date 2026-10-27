---
name: vmprotect-sdk-usage
description: "VMProtect SDK (`VMProtectSDK.h`) marker API — `VMProtectBegin*` / `VMProtectEnd` call-pairs that tell VMProtect which code regions to virtualise, mutate, or ultra-mutate. Build-side usage pattern + reverse-side signature."
metadata:
  type: reference
  source: curated
  topics: [vmprotect, sdk, markers, virtualization, build]
---
# VMProtect SDK usage

VMProtect is applied at post-link time to regions you tag with SDK calls. The SDK itself is tiny (`VMProtectSDK.h` + `VMProtectSDK64.lib`); the heavy lifting is in `VMProtect.exe`.

## Marker calls

- `VMProtectBeginVirtualization(const char* MarkerName)` → `VMProtectEnd()` — virtualise the region in VMProtect's VM.
- `VMProtectBeginMutation(name)` — mutation only, no VM.
- `VMProtectBeginUltra(name)` — mutation + VM + extras.
- `VMProtectDecryptStringA / W` — load an encrypted string at runtime.
- `VMProtectIsProtected / IsDebuggerPresent / IsVirtualMachinePresent` — queries to the VM about the environment.
- `VMProtectSetSerialNumber` / `VMProtectActivateLicense` — licensing hooks.

## Reverse-side signature

- Marker calls become `call VMProtect_<name>` relocations before protection, then disappear into VMProtect VM entries after.
- Pre-protection build has `__declspec(dllimport)` IAT entries to `VMProtectSDK64.dll`; post-protection those are stripped.
- The marker-name string often survives in `.vmp0` and gives analysts a function-name hint. Developers who care disable marker names.

## Related

[[vmp-devirt-pipeline]], [[vmp-analyzer]], [[themida-oreans-vm]].
