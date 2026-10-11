# Evidence And Tools

## Binary Evidence and Attack-Surface Findings

For native Linux or Proton context, first use
[linux-platform-security](../../linux-platform-security/SKILL.md). For diagnostic
reports from owned test builds, use
[robustness and triage](../../research-rigor/references/robustness-and-triage.md).

Preserve the sample hash, provenance, architecture, image layout, tool version,
analysis configuration, and symbol identity. Keep file offsets, RVAs, and
runtime addresses distinct, including relocation assumptions in disk/memory
comparisons. Match symbols to the actual binary; public and private symbol
sets offer different information.
[PE format](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format),
[Symbols and symbol files](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/symbols-and-symbol-files)

Decompiler output is a reconstruction. Validate inferred types, names,
prototypes, and function boundaries against instructions, ABI constraints,
and available observations. Ghidra's instruction semantics and p-code model
are useful for understanding why displayed C is not recovered source.
[Ghidra language documentation](https://ghidra.re/ghidra_docs/languages/index.html),
[Ghidra analysis guide](https://ghidra.re/ghidra_docs/GhidraClass/Beginner/Introduction_to_Ghidra_Student_Guide.html)

Classify the question before selecting an analysis mode:

| Question | Evidence to develop | Limit to state |
|---|---|---|
| Interface abuse | Input origin, callers, required privilege, validation and protected resource | Reachable code is not proof of invocation or abuse |
| Integrity tampering | Independently acquired comparison data and collector trust | A compromised or incomplete collector can distort results |
| Packing/obfuscation | Representation changes and uncertainty in recovered structure | Obfuscation alone does not establish maliciousness |
| Anti-analysis behavior | Conditions associated with differing execution | Observation coverage may be limited by the environment |
| Security-relevant binary change | Semantic differences and affected trust boundary | Compiler, library, and layout changes can dominate a diff |

Report supporting addresses/artifacts and explain each inference. An imported
API, reachable path, and observed call are distinct findings. Preserve missing
symbols, incomplete dumps, generated code, and unexecuted paths as limitations.
Sources in this section were reviewed on 2026-09-09.

## Repository Resource Selection

Choose resources by artifact and evidence need: binary interpretation, bounded
debugger observations, build comparison, or offline dump parsing. Read
[repository resources](repository-resources.md) when selecting a
project or locating the matching README family.

## Debugging Tools

### Windows Debuggers
- **Cheat Engine**: Memory scanner and debugger for games
- **x64dbg**: Open-source x86/x64 debugger
- **WinDbg**: Microsoft's kernel/user-mode debugger
- **ReClass.NET**: Memory structure reconstruction
- **HyperDbg**: Hypervisor-based debugger

### Specialized Debuggers
- **CE Mono Helper**: Unity/Mono game debugging
- **dnSpy**: .NET assembly debugger/decompiler
- **ILSpy**: .NET decompiler
- **frida**: Dynamic instrumentation toolkit

### Platform-Specific
- **edb-debugger**: Linux debugger
- **PINCE**: Linux game hacking tool
- **H5GG**: iOS cheat engine
- **Hardware Breakpoint Tools**: HWBP implementations

## Disassembly & Decompilation

### Multi-Platform
- **IDA Pro**: Industry standard disassembler
- **Ghidra**: NSA's reverse engineering framework
- **Binary Ninja**: Modern RE platform
- **Cutter**: Radare2 GUI

### Specialized Tools
- **IL2CPP Dumper**: Unity IL2CPP analysis
- **dnSpy**: .NET/Unity decompilation
- **jadx**: Android DEX decompiler
- **Recaf**: Java bytecode editor

## Memory Analysis

### Memory Scanners
```
- Cheat Engine: Pattern scanning, value searching
- ReClass.NET: Structure reconstruction
- Process Hacker: System analysis
```

### Dump Tools
```
- KsDumper: Kernel-space process dumping
- PE-bear: PE file analysis
- ImHex: Hex editor for RE
```

## Dynamic Binary Instrumentation (DBI)

### Frameworks
- **Frida**: Cross-platform DBI
- **DynamoRIO**: Runtime code manipulation
- **Pin**: Intel's DBI framework
- **TinyInst**: Lightweight instrumentation
- **QBDI**: QuarkslaB DBI

### Use Cases
1. API hooking and tracing
2. Code coverage analysis
3. Fuzzing harness creation
4. Behavioral analysis
5. Driver IOCTL and callback tracing

### Exception-Driven Instrumentation: Evidence Limits

Exception-driven instrumentation observes selected execution points while changing
some combination of code, memory permissions, exception handling, state or timing.
Treat the resulting trace as an observation under those conditions. A static
control-flow graph or a smaller modification footprint does not establish a
universally safer or more complete strategy.

For owned test programs, assess:

- **Semantic fidelity:** expected registers, memory effects, error handling,
  synchronization and program results remain consistent with an uninstrumented
  baseline under the supported conditions.
- **Coverage:** define the measured unit (instruction, block, edge or function),
  denominator, input set, thread scope and missing intervals. An observed edge
  does not establish every feasible path, and a page event is not an instruction
  trace.
- **Observation cost:** report runtime overhead, exception volume, termination,
  instability and changes in scheduling; distinguish application defects from
  collection artifacts.
- **Scope:** identify unsupported instructions, generated code, external calls
  and collector limitations before transferring results across versions.

[DynamoRIO's transparency documentation](https://dynamorio.org/transparency.html)
explains state, resource, synchronization and timing concerns for its own clients.
It supports these review dimensions; it does not validate the ad hoc exception
instrumentation previously described here. Sources reviewed: 2026-09-09.

### Control Flow Tracing (CFT) Applications
```
- Runtime call graph generation with register context at each edge
- Divergence testing: compare traces across different inputs/environments
  → Quickly locates input validation, anti-debug, anti-tamper trigger points
- Deobfuscation: resolve indirect branches observed under covered executions;
  completeness requires additional path exploration or proof
- Hot path analysis, branch coverage measurement
- Report measured tracing overhead for the exact workload, collector and
  environment; preserve timeouts and observation-induced failures
- Portable to other architectures: ARM (UDF), RISC-V (illegal instruction)
```

### User-Mode Hypervisor-Assisted Analysis

A user-mode application can manage guest partitions and virtual processors through
Windows Hypervisor Platform, backed by the Windows hypervisor. This is not the
same as running the hypervisor inside that process, forcing all guest code to
execute in user mode, or gaining arbitrary control of the running host kernel.
[Microsoft WHP API](https://learn.microsoft.com/en-us/virtualization/api/hypervisor-platform/hypervisor-platform)

For an existing analysis trace, record host/guest boundaries, guest execution
state, modeled memory/devices, enabled capabilities and the actual exit reason.
A page-access exit can support a finding about that access under the configured
policy; it does not provide complete instruction or edge coverage. The documented
exit enumeration has no generic syscall exit: do not assume every guest system
call automatically transfers control to the analysis application.
[Microsoft exit contexts](https://learn.microsoft.com/en-us/virtualization/api/hypervisor-platform/funcs/whvexitcontextdatatypes)

Match OS/SDK/architecture and nested-environment support to the particular API
and tool. Use the [Windows WHP contract](../../windows-kernel/SKILL.md#windows-hypervisor-platform-whp-api)
for version and capability details. Preserve unmodeled scheduler, device, timing
and concurrency effects, along with unsupported instructions and missing trace
intervals. Review semantic fidelity against an owned baseline before drawing
conclusions from a modeled execution. Sources reviewed: 2026-09-09.
