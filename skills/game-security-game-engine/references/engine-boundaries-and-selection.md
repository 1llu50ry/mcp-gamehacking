# Engine Boundaries And Selection

## Engine Trust Boundaries and Evidence

For tick/frame distinctions, prediction, replication ordering and replay
limitations, use [time and replay evidence](../../game-server-security/references/time-ordering-and-replay.md).

Use [game-server-security](../../game-server-security/SKILL.md) for authority,
sessions, inventory and purchases, and
[game-supply-chain-security](../../game-supply-chain-security/SKILL.md) for build,
update and mod-distribution trust. For owned-build diagnostic reports, use
[robustness and triage](../../research-rigor/references/robustness-and-triage.md).

Baseline the engine branch, game build/hash, platform/ABI, scripting backend,
stripping configuration, symbol availability, and plugin versions. Separate
reflected metadata, native/managed execution, serialized assets, plugins, and
client/server replication; each exposes a different research surface.

Describe attack scenarios by the boundary that must fail: untrusted content
accepted by an importer, a plugin granted in-process execution, or client
assertions accepted as authoritative game state. Correlate asset provenance,
plugin inventory, owned-build diagnostics, serialization checks, and server
validation evidence. Engine identification or object discovery alone does not
establish compromise.

- Unreal reflection covers annotated members; native-only members and object
  lifetime require separate evidence. A reflected schema is not a complete C++
  layout. [Epic Objects](https://dev.epicgames.com/documentation/en-us/unreal-engine/objects-in-unreal-engine)
- Unity IL2CPP involves managed assemblies, stripping, C++ generation, and native
  compilation. Reconstructed names or metadata do not guarantee complete type
  coverage or original-source recovery.
  [Unity IL2CPP](https://docs.unity3d.com/Manual/il2cpp-introduction.html)
- Extension compatibility is versioned: the Godot 4.4 manifest documents engine
  compatibility and platform/build/architecture selection. Verify the target
  release rather than projecting this example onto all versions.
  [Godot 4.4 GDExtension manifest](https://docs.godotengine.org/en/4.4/tutorials/scripting/gdextension/gdextension_file.html)
- Distinguish open-source engines, licensed engine source, SDK game code, and
  reference-source subsets. Source SDK 2013 has its own non-commercial license;
  repository visibility does not imply unrestricted reuse.
  [Valve Source SDK 2013](https://github.com/ValveSoftware/source-sdk-2013)

Report the affected boundary, prerequisite, artifact, observed result, benign
controls, and version-dependent limits. Sources above were reviewed on 2026-09-09.

## README Coverage

- `Game Engine > Guide`
- `Game Engine > Source`
- `Game Engine Plugins:Unreal`
- `Game Engine Plugins:Unity`
- `Game Engine Plugins:Godot`
- `Game Engine Plugins:Lumix`
- `Game Engine Detector`
- `Cheat > SDK CodeGen`
- `Cheat > Game Engine Explorer:Unreal`
- `Cheat > Game Engine Explorer:Unity`
- `Cheat > Game Engine Explorer:Source`
- `Anti Cheat > Game Engine Protection:Unreal`
- `Anti Cheat > Game Engine Protection:Unity`
- `Anti Cheat > Game Engine Protection:Source`
- `Game Develop > MCP server`

## Major Engine Categories

### Unreal Engine
- Official documentation and forums
- Source code access (requires Epic Games account)
- Community guides and tutorials
- Plugin development references

### Unity Engine
- C# reference source code
- Asset store resources
- Unity-specific design patterns
- VR/AR development guides

### Open Engines and Source-Available SDKs
- **Godot**: Free and open-source, supports GDScript and C#
- **Cocos2d-x**: Cross-platform 2D game framework
- **CRYENGINE**: High-fidelity graphics engine
- **Source SDK**: Valve game-code SDKs with version-specific license terms

### Custom/Educational Engines
- Hazel Engine (TheCherno's educational series)
- Bevy (Rust-based data-driven engine)
- Fyrox (Rust game engine)

## Key Technical Areas

### Rendering
- Software renderers for learning
- Ray tracing implementations
- Shader development tutorials
- Post-processing effects

### Mathematics
- Linear algebra libraries (GLM, DirectXMath)
- Physics simulation (PhysX, Bullet)
- Collision detection algorithms

### Networking
- Client-server architectures
- KCP reliable UDP protocol
- Steam networking integration
- MMORPG server implementations

## Resource Categories

### Documentation & Guides
```markdown
- Learning resources and tutorials
- Architecture documentation
- Best practices and style guides
```

### Source Code
```markdown
- Complete engine implementations
- Subsystem references (renderer, physics, audio)
- Plugin and extension examples
```

### Plugins & Extensions
```markdown
- ImGui integration for debug UIs
- Scripting language bindings (Lua, .NET)
- Editor tool plugins
```

## Engine Selection Criteria

When researching engines for security analysis or development:

1. **Target Platform**: PC, mobile, console compatibility
2. **Source Access**: Open source vs proprietary
3. **Language**: C++, C#, Rust, or scripting
4. **Graphics API**: DirectX, OpenGL, Vulkan, Metal
5. **Community**: Documentation and support quality
