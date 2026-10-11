# Analysis And Protection

## Anti-Analysis Bypass

### Techniques
- Anti-debug detection bypass
- VM/Sandbox evasion
- Timing attack mitigation
- PatchGuard circumvention

### Tools
- **TitanHide**: Anti-debug hiding
- **HyperHide**: Hypervisor-based hiding
- **ScyllaHide**: Anti-anti-debug plugin

## Game-Specific Analysis

### Unity Games
1. Locate `GameAssembly.dll` (IL2CPP) or managed DLLs
2. Use IL2CPP Dumper for structure recovery
3. Apply dnSpy for Mono games
4. Hook via Unity-specific frameworks

### Unreal Engine Games
1. Identify UE version from signatures
2. Use SDK generators (Dumper-7)
3. Analyze Blueprint bytecode
4. Hook UObject/UFunction systems

### Native Games
1. Standard PE analysis
2. Import/export reconstruction
3. Pattern scanning for signatures
4. Runtime memory analysis

## Workflow Best Practices

### Initial Analysis
```
1. Identify protections (packer, obfuscator, anti-cheat)
2. Determine game engine and version
3. Collect symbol information if available
4. Map out key modules, callbacks, and trust boundaries
```

### Deep Analysis
```
1. Locate target functionality
2. Trace execution flow
3. Document structures, memory artifacts, and relationships
4. Correlate IOCTLs, callbacks, and runtime checks
```

## Obfuscation Taxonomy

### Mixed Boolean-Arithmetic (MBA)
```
- Linear MBA: e.g., x + y = (x ^ y) + 2*(x & y)
- Polynomial MBA: higher-degree expressions over boolean/arithmetic mix
- Tools: SSPAM, MBA-Blast, SiMBA for simplification
- Common in: VMProtect, Themida, custom LLVM passes
```

### Control Flow Flattening (CFF)
```
- OLLVM-style: many protected basic blocks routed through a dispatcher loop
- Recovery: symbolic execution, pattern matching, deobfuscation passes
- Tools: D-810 (IDA), de-ollvm scripts, SATURN
- Variants: nested dispatchers, encrypted state variables
```

### Opaque Predicates
```
- Invariant conditions injected to confuse static analysis
- Number-theoretic (x² mod 4 ∈ {0,1}), pointer-aliasing based
- Detection: abstract interpretation, SMT solvers (Z3)
```

### Virtualization-Based Obfuscation
```
VMProtect / Themida / Code Virtualizer:
- Custom bytecode VM with randomized opcode set per build
- Handler table dispatch loop: fetch → decode → execute
- Devirtualization approaches:
  - Trace-based: record handler execution, lift to IR
  - Pattern-based: identify handler semantics by structure
  - Symbolic: concolic execution through VM dispatch
- Tools: VMPAttack, NoVmp, Oreans UnVirtualizer, vtil
```

### Binary Lifting
```
- Lift machine code to compiler IR (LLVM IR, VEX, ESIL)
- Enables compiler-level optimization passes for deobfuscation
- Tools: McSema, remill, RetDec, Binary Ninja MLIL/HLIL
```
