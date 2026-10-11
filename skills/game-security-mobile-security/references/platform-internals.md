# Platform Internals

## eBPF-Based Tools

### Tracing & Hooking
```
- stackplz: eBPF-based stack trace tool for Android
- eDBG: eBPF-powered debugger for Android processes
- tracee: Aqua Security's eBPF runtime security tool (Linux/Android)
- eBPF hooking: attach to tracepoints, kprobes, uprobes without kernel module
```

### Advantages Over Traditional Approaches
```
- No kernel module compilation required (runs in eBPF VM)
- May work on compatible GKI kernels when BPF features, BTF, privileges,
  SELinux policy, lockdown state, and required attach points permit it
- Can avoid a custom kernel module, but programs, maps, links, helpers, and
  privileged loader activity still create an observable surface
- CO-RE improves portability across kernels with compatible BTF/type changes;
  it does not guarantee run-everywhere behavior
- The verifier rejects many unsafe programs and reduces risk, but verifier,
  helper, JIT, driver, and kernel bugs can still cause failures
```

## Android Kernel Driver Development

### Development Patterns
```
- Loadable kernel module (LKM) for older kernels
- GKI-compatible modules via vendor_dlkm partition
- Kernel build scripts: build from AOSP source or vendor BSP
- Device Trees: hardware description for board-specific drivers
```

### Common Use Cases in Game Security
```
- Process memory access: /dev/custom_mem → read/write target process
- Syscall hooking: __NR_read, __NR_write interception
- Binder hooking: intercept IPC transactions
- GPU memory inspection: access GPU buffers directly
```

### Android Kernel Source
```
- AOSP Common Kernel (ACK): google/common branch
- GKI: versioned Generic Kernel Image model; capabilities and module rules vary
  across Android releases and OEM implementations
- Vendor-specific: Qualcomm (CodeAurora), MediaTek, Samsung Exynos
- Build system: build/build.sh or Bazel-based (newer)
```

## HarmonyOS / OpenHarmony

```
- HarmonyOS (Huawei): abc file format for compiled apps
- arkdecompiler: decompile HarmonyOS abc bytecode
- OpenHarmony: open-source base, growing ecosystem
- Security model differs from Android: distributed capabilities
- Reverse engineering challenges: new bytecode VM, different IPC
```

## Android CVE Research

### Application-Level CVEs
```
- WebView RCE (CVE-based exploit chains)
- Intent redirection / deep link abuse
- Content provider data leaks
- Serialization vulnerabilities (Parcel, Bundle)
```

### Kernel-Level CVEs
```
- Use-after-free in Binder driver
- Privilege escalation via ion/DMA-BUF
- GPU driver vulnerabilities (Adreno, Mali, PowerVR)
- SELinux policy bypass chains
- Reference: Android Security Bulletins (monthly)
```

## Emulator Considerations

### Android Emulators
- **LDPlayer**: Gaming focused
- **BlueStacks**: Popular emulator
- **NoxPlayer**: Game optimization
- **MEmu**: Android gaming

### Emulator Detection
```
- Build.FINGERPRINT checks
- Hardware sensor verification
- File system characteristics
- Performance timing
```
