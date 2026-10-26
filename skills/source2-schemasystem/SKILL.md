---
name: source2-schemasystem
description: "Source 2 SchemaSystem (CS2, Dota2, Deadlock) -- how classes/fields are registered, how to resolve offsets at runtime, how NetVar hashing differs from Source 1."
metadata:
  type: tool-reference
  source: curated
  topics: [source2, cs2, dota2, schemasystem, netvar]
---
# Source 2 SchemaSystem

Source 2 replaced the Source 1 `recv_props` mechanism with a `SchemaSystem_001` singleton exposing every network-replicated class and field.

## Flow

```cpp
auto sys = CreateInterface("schemasystem.dll", "SchemaSystem_001");
auto scope = sys->FindTypeScopeForModule("client.dll");
auto cls = scope->FindDeclaredClass("C_CSPlayerPawn");
for (auto& field : cls->GetFields()) {
    // field.name, field.offset, field.type_name
}
```

## Why this matters

- Offsets no longer require re-signaturing on every patch.
- One tool call enumerates the entire class graph; dumpers (cs2-dumper) use this exclusively.

## Related

[[source-sdk-reference]], the `cs2-specialist` and `source-engine-specialist` agents.
