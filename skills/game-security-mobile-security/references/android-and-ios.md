# Android And Ios

## Mobile Trust Boundaries and Integrity Evidence

Use [game-server-security](../../game-server-security/SKILL.md) for verified
purchases, entitlement transitions, account authorization and retries. Use
[game-supply-chain-security](../../game-supply-chain-security/SKILL.md) when the
question concerns build provenance, updates or third-party content.

Separate app package/signing, process isolation, platform/device integrity,
and server authorization/game rules. Repackaging, privileged instrumentation,
local-data exposure, request replay, and reliance on client assertions affect
different boundaries. State whether the scenario requires ordinary app access,
a developer build, privileged runtime access, kernel control, or server access.

Keep local indicators, verified attestation, backend decisions, and sanctions
separate. A root indicator is not proof of cheating; a valid integrity response
does not validate arbitrary game logic. Record the exact build and signing
identity with the observation source and available counterevidence.

- Android SELinux mandatory access control also applies to root processes.
  Record enforcement state, domain, build, and relevant policy denials instead
  of assigning universal trust or stealth ratings to framework names.
  [AOSP SELinux](https://source.android.com/docs/security/features/selinux)
- Validate Play Integrity request details, identity, binding, and freshness
  before interpreting app/device/account verdicts on the backend.
  [Android integrity verdicts](https://developer.android.com/google/play/integrity/verdicts)
- App Attest requires server verification of attestations/assertions, including
  challenge and counter handling. Keep development and production context
  separate. [Apple server validation](https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server)
- For owned-app transport tests, distinguish debug-only trust anchors from
  release configuration and verify the packaged result.
  [Android network security configuration](https://developer.android.com/privacy-and-security/security-config)

Include supported emulators, stock devices, developer builds, OS updates, and
service/attestation errors as controls. Record unavailable evidence separately
from a verified negative result. Report the boundary, prerequisite, artifact,
backend interpretation, false-positive alternatives, and unresolved limits.
Sources above were reviewed on 2026-09-09.

## README Coverage

- `Cheat > Magisk`
- `Cheat > Xposed`
- `Cheat > Frida`
- `Cheat > Hook ART(android)`
- `Cheat > Hook syscall(android)`
- `Cheat > Android Terminal Emulator`
- `Cheat > Android File Explorer`
- `Cheat > Android Memory Explorer`
- `Cheat > Android Application CVE`
- `Cheat > Android Kernel CVE`
- `Cheat > Android Bootloader Bypass`
- `Cheat > IoT / Smart devices`
- `Cheat > Android ROM`
- `Cheat > Android Device Trees`
- `Cheat > Android Kernel Source`
- `Cheat > Android Root`
- `Cheat > Android Kernel driver development`
- `Cheat > Android Kernel Explorer`
- `Cheat > Android Kernel Driver`
- `Cheat > Android Network Explorer`
- `Cheat > Android memory loading`
- `Cheat > IOS jailbreak`
- `Cheat > IOS Memory Explorer`
- `Cheat > IOS File Explorer`
- `Cheat > IOS App Packaging`
- `Cheat > Injection:Android`
- `Cheat > Injection:IOS`
- `Anti Cheat > Detection:Android root`
- `Anti Cheat > Detection:Magisk`
- `Anti Cheat > Detection:Frida`
- `Some Tricks > Android`
- `Android Emulator`
- `IOS Emulator`

## Android Security

### APK Analysis

#### Tools
- **apktool**: Decompile/recompile APKs
- **jadx**: DEX to Java decompiler
- **APKiD**: Identify packers/protectors
- **Frida**: Dynamic instrumentation
- **APKLab**: VS Code integration

#### Workflow
```bash
# Decompile APK
apktool d game.apk

# Analyze DEX files
jadx -d output game.apk

# Identify protection
apkid game.apk
```

### Native Library Analysis

#### IL2CPP Games (Unity)
```
1. Extract libil2cpp.so from APK
2. Use IL2CPP Dumper to generate headers
3. Analyze with IDA/Ghidra
4. Hook using Frida or native hooks
```

#### Native Games
```
1. Identify target libraries (.so files)
2. Analyze with reverse engineering tools
3. Pattern scan for functions
4. Apply hooks/patches
```

### Memory Manipulation

#### Tools
- **GameGuardian**: Memory editor
- **Cheat Engine (ceserver)**: Remote debugging
- **Custom memory tools**: Direct /proc/pid/mem access

#### Access Methods
```c
// Via /proc filesystem
int fd = open("/proc/pid/mem", O_RDWR);
pread64(fd, buffer, size, address);
pwrite64(fd, buffer, size, address);
```

### Hooking Frameworks

#### Frida
```javascript
// Basic function hook
Interceptor.attach(Module.findExportByName("libgame.so", "function_name"), {
    onEnter: function(args) {
        console.log("Called with: " + args[0]);
    },
    onLeave: function(retval) {
        retval.replace(0);
    }
});
```

#### Native Hooks
- **Substrate**: Inline hooking framework
- **And64InlineHook**: ARM64 inline hooks
- **xHook**: PLT hook library
- **Dobby**: Multi-platform hook framework

### Root Mechanisms and Privilege Boundaries

KernelSU implements a kernel component that grants root privileges to user-space
applications. APatch describes kernel patching through KernelPatch and separately
identifies kernel-space modules. A root-enabled application does not thereby
execute all its code in kernel mode: distinguish user-space credentials,
privileged services, kernel components and their interfaces.
[KernelSU architecture](https://kernelsu.org/guide/what-is-kernelsu.html),
[APatch architecture FAQ](https://apatch.dev/faq.html).

Compare an exact release, kernel/device, boot-image provenance and module
configuration. Do not infer universal stock-kernel compatibility, interchangeable
module APIs, filesystem cleanliness or detectability from a framework name.
Android SELinux normally constrains even root processes; for a modified kernel,
record the observed enforcement and collection trust assumptions rather than
assuming either normal policy behavior or its total absence.
[AOSP SELinux](https://source.android.com/docs/security/features/selinux)

### Dynamic Instrumentation and Observation Limits

Frida distinguishes injected, embedded and preloaded operation. These are
integration modes, not universal stealth levels or guarantees of early-execution
coverage. Bind a report to the exact tool revision, target build, entry point,
required privilege and actual evidence source.
[Frida modes](https://frida.re/docs/modes/)

| Question | Evidence to preserve |
|---|---|
| What boundary was crossed? | Owned debug integration, user-space process access or a privileged/kernel component; avoid treating them as equivalent |
| What changed in the observation? | Available module/memory provenance, process lifecycle, control-channel exposure and instrumentation logs |
| What could be missed? | Uncovered startup periods, native versus managed execution, unloaded components, unavailable logs and effects of the observer itself |
| Is a detector conclusion justified? | Defined observable signal, exact tested configuration, benign/debug-build comparison and false-positive/false-negative limits |

Packing components into one binary, moving work to a different layer or changing
an instrumentation mode does not establish fewer observable artifacts, universal
compatibility or guaranteed nondetection. Evaluate the complete privileged path
and its management interface; do not infer a clean device from one absent signal.

### Local Root Indicators and Attribution

Filesystem/package indicators, build properties and runtime observations may
support a device-state hypothesis. Record how each was obtained, the observer's
privilege and whether the observation source is trustworthy. A developer build,
custom ROM, stale artifact or unavailable visibility can explain an indicator or
its absence. Keep root-state assessment separate from verified attestation,
server authorization and evidence of cheating.

Review how a privileged component could affect the trustworthiness of local
observations at the mechanism level. Do not treat a list of framework names or
local checks as proof of a specific hiding method, or rank systems by a fixed
stealth tier. Sources for these privilege/instrumentation corrections reviewed:
2026-09-09.

### Zygisk Modules

```cpp
// Zygisk module structure
class Module : public zygisk::ModuleBase {
    void onLoad(zygisk::Api *api, JNIEnv *env) override {
        this->api = api;
        this->env = env;
    }

    void preAppSpecialize(zygisk::AppSpecializeArgs *args) override {
        // Before app loads
    }

    void postAppSpecialize(const zygisk::AppSpecializeArgs *args) override {
        // After app loads - inject here
    }
};
```

### Android Protections

#### Common Protectors
- **Tencent ACE**: Chinese market protection
- **AppSealing**: Commercial protection
- **DexGuard/ProGuard**: Obfuscation
- **Arxan**: Enterprise protection

## iOS Security

### Analysis Tools
- **Hopper**: Disassembler
- **IDA Pro**: Industry standard
- **class-dump**: Objective-C header extraction
- **Frida**: Dynamic instrumentation
- **Clutch/dumpdecrypted**: App decryption

### Jailbreak Tools
- **H5GG**: iOS cheat engine
- **Flex**: Runtime patching
- **Cycript**: Runtime manipulation
- **ceserver-ios**: Cheat Engine for iOS

### Hooking (Jailbroken)
```objc
// Using Logos (Theos)
%hook TargetClass
- (int)targetMethod:(int)arg {
    int result = %orig;
    return result * 2;  // Modify return
}
%end
```

### Non-Jailbreak Techniques
- **Sideloading**: Modified IPAs
- **Enterprise certificates**: Custom signing
- **AltStore**: Self-signing tool
