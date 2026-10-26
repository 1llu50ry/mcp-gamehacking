---
name: schema-walker
description: Walk Source 2 SchemaSystem_001 to dump every class, field, and enum with offsets. Agent-callable; emits JSON.
type: subagent
---

# Subagent: schema-walker

Walks `CSchemaSystem_001` in Source 2 titles (CS2, Dota2, Deadlock) and dumps everything to JSON.

## Input

- game: cs2 | dota2 | deadlock
- module: client.dll | server.dll (default client)
- fields_only: boolean (skip metadata)

## Output

```json
{
  "class": "C_CSPlayerPawn",
  "parent": "C_CSPlayerPawnBase",
  "size": 0x1050,
  "fields": {
    "m_iHealth": { "offset": 0x334, "type": "int32" },
    "m_hActiveWeapon": { "offset": 0xA80, "type": "CHandle<CBasePlayerWeapon>" }
  }
}
```

## Steps

1. Resolve `SchemaSystem_001` export via `CreateInterface`.
2. Iterate type scopes.
3. Emit fields with offsets, types, and network flags.

## Related

[[source2-schemasystem]], the `cs2-specialist` agent, the `offset-finder` subagent.

<!-- enriched:v2 -->
