# Engines And Workflow

## Engine-Specific Techniques

### Unity (Mono)
- Assembly-CSharp.dll analysis
- Mono JIT hooking
- Il2CppDumper for IL2CPP builds
- Method address resolution

### Unity (IL2CPP)
- GameAssembly.dll analysis
- Metadata recovery
- Type reconstruction
- Native hooking

### Unreal Engine
- GObjects/GNames enumeration
- UWorld traversal
- SDK generation (Dumper-7)
- Blueprint hooking

### Source Engine
- Entity list enumeration
- NetVars parsing
- ConVar manipulation
- Signature scanning

## Development Workflow

### External Cheat
```
1. Pattern scan for signatures
2. Read game memory externally
3. Process data in separate process
4. Render overlay or use input simulation
```

### Internal Cheat
```
1. Inject into game process
2. Hook rendering functions
3. Access game objects directly
4. Render through game's graphics context
```
