# Extraction And Object Models

## SDK Generation Workflows

### Unreal Engine (Dumper-7)
```
1. Identify UE version from binary signatures
2. Inject Dumper-7 into running game process
3. SDK output: C++ headers with UObject hierarchy
4. Key structures: UObject, FName, UClass, UFunction, UProperty
5. Generated SDK enables: property access, function calls, blueprint hooks
6. Alternative tools: UnrealDumper, UE4SS (live scripting + SDK dump)
```

### Unity (IL2CPPDumper)
```
1. Locate global-metadata.dat + GameAssembly.dll (or libil2cpp.so)
2. Run IL2CPPDumper → outputs: dump.cs, il2cpp.h, script.json
3. Load generated headers into IDA/Ghidra for symbol recovery
4. Key structures: Il2CppClass, MethodInfo, FieldInfo, Il2CppType
5. For Mono builds: directly decompile Assembly-CSharp.dll with dnSpy
```

### Source Engine (NetVar Parsing)
```
1. Walk ClientClass linked list from CHLClient
2. For each class, enumerate RecvTable → RecvProp entries
3. Build offset map: class name → property name → offset
4. Example: CCSPlayer → m_iHealth → 0x100
5. Tools: hazedumper, source2gen (Source 2)
```

## Engine Object Models

### Unreal Engine
```
Core hierarchy:
  UObject → UField → UStruct → UClass
  UObject → AActor → APawn → ACharacter → APlayerCharacter

Key globals:
  GUObjectArray / GObjects: registered UObject slots; lifecycle and reachability
    filtering are still required
  GNames / FNamePool: name storage; symbol and structure names vary by UE version
  GWorld (UWorld*): current world context
  GEngine (UEngine*): engine singleton

Memory layout:
  Common UObject fields include VTable, flags, internal index, class, name, and
  outer pointers; order, packing, and presence are build-specific
  Reflected property offsets come from the version-specific class metadata
```

### Unity (IL2CPP)
```
Core structures:
  Il2CppDomain → Il2CppAssembly → Il2CppImage → Il2CppClass
  Il2CppClass: fields, methods, vtable, static_fields pointer

Key patterns:
  il2cpp_domain_get() → domain singleton
  il2cpp_class_from_name() → class lookup by namespace + name
  il2cpp_runtime_invoke() → call managed methods from native

Metadata:
  global-metadata.dat contains string pool, type definitions, method signatures
  Encrypted metadata in some protected games (requires custom decryptor)
```

### Source Engine
```
Core systems:
  Entity list: IClientEntityList → GetClientEntity(index)
  ConVar system: ICvar → FindVar("sv_cheats")
  NetVars: RecvTable hierarchy for network-replicated properties

Key interfaces (accessed via CreateInterface export):
  IVEngineClient, IClientEntityList, IEngineTrace
  ISurface, IPanel (for overlay rendering in Source)
```

## MCP Servers for Game Development

```
The README's > MCP server subcategory includes servers relevant
to game engine workflows:

- Unreal Engine MCP: AI agent controls UE editor (spawn actors, modify properties, blueprints)
- Unity MCP: AI agent interacts with Unity editor and C# scripting
- Godot MCP: AI agent controls Godot editor and GDScript

These complement the RE-focused MCP tools (see reverse-engineering skill)
by enabling AI-assisted game development and rapid prototyping.
```

## Security Research Focus

For game security research, understanding engine internals helps with:
- Memory layout and object structures
- Rendering pipeline hooks
- Network protocol analysis
- Anti-cheat integration points

---
