# Drivers And Observation

## Kernel Callbacks

### Process Callbacks
```cpp
PsSetCreateProcessNotifyRoutine
PsSetCreateProcessNotifyRoutineEx
PsSetCreateProcessNotifyRoutineEx2
```

### Thread Callbacks
```cpp
PsSetCreateThreadNotifyRoutine
PsSetCreateThreadNotifyRoutineEx
```

### Image Load Callbacks
```cpp
PsSetLoadImageNotifyRoutine
PsSetLoadImageNotifyRoutineEx
```

### Object Callbacks
```cpp
ObRegisterCallbacks
// OB_OPERATION_HANDLE_CREATE
// OB_OPERATION_HANDLE_DUPLICATE
```

### APC / Execution Context
```cpp
KeInitializeApc
KeInsertQueueApc
KeStackAttachProcess
RtlWalkFrameChain
```

### Registry Callbacks
```cpp
CmRegisterCallback
CmRegisterCallbackEx
```

### Minifilter Callbacks
```cpp
FltRegisterFilter
// IRP_MJ_CREATE, IRP_MJ_READ, etc.
```

## Driver Development

### Basic Structure
```cpp
NTSTATUS DriverEntry(
    PDRIVER_OBJECT DriverObject,
    PUNICODE_STRING RegistryPath
) {
    DriverObject->DriverUnload = DriverUnload;
    DriverObject->MajorFunction[IRP_MJ_CREATE] = DispatchCreate;
    DriverObject->MajorFunction[IRP_MJ_DEVICE_CONTROL] = DispatchIoctl;
    // Create device, symbolic link...
    return STATUS_SUCCESS;
}
```

### Communication Methods
- IOCTL (DeviceIoControl)
- Direct I/O
- Buffered I/O
- Shared memory

## Kernel Hooking

### ETW (Event Tracing for Windows)
```
- InfinityHook technique
- HalPrivateDispatchTable
- System call tracing
```

## ETW Internals

### Provider / Consumer Model
```
Architecture:
- Providers: kernel or user-mode components that emit events
  - Manifest-based providers (registered via wevtutil)
  - TraceLogging providers (self-describing, no manifest)
  - MOF providers (legacy WMI-based)
- Consumers: tools that subscribe to and process events
  - Real-time consumers (ETW sessions)
  - Log file consumers (.etl files)
- Controllers: manage sessions (xperf, tracelog, logman)

Key kernel providers:
  Microsoft-Windows-Kernel-Process (process/thread lifecycle)
  Microsoft-Windows-Kernel-File (file I/O)
  Microsoft-Windows-Kernel-Audit-API-Calls (security-sensitive APIs)
```

### ThreatIntel ETW Provider
```
- Microsoft-Windows-Threat-Intelligence
- Available to PPL (Protected Process Light) and above
- Events: NtReadVirtualMemory, NtWriteVirtualMemory, NtMapViewOfSection on protected processes
- Used by EDR and anti-cheat for detecting memory access to protected processes
- Attackers target: patch EtwThreatIntProvRegHandle or EtwpEventWriteFull
```

### Common ETW Bypass Patterns
```
- Patch EtwEventWrite in ntdll.dll (user-mode ETW silencing)
- Patch nt!EtwpEventWriteFull in kernel (kernel-mode ETW silencing)
- A debugger-related thread setting does not establish ETW invisibility;
  undocumented cross-subsystem effects need build/provider-specific evidence
- Remove provider registration by walking EtwRegistration list
- EPT-based protection can defend ETW structures from tampering
```
