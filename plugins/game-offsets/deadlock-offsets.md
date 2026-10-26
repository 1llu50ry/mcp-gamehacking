---
name: deadlock-offsets
description: "Valve Deadlock (Source 2) offset database -- player entity, hero data, items, view matrix, SchemaSystem resolution."
type: tool-plugin
---

# Plugin: deadlock-offsets

Valve Deadlock (Source 2) offset database. Updated per-patch.

## Key Offsets

- `dwEntityList`, `dwLocalPlayerController`, `dwLocalPlayerPawn`
- `pawn.m_iHealth`, `m_hActiveWeapon`, `m_hController`
- `pawn.m_pGameSceneNode -> m_modelState -> m_hModel.m_bones`
- `dwViewMatrix` (CB stride 0x400)
- Deadlock-specific: ability data, hero stat block, item inventory

## Schema

Source 2 SchemaSystem_001 ([[source2-schemasystem]]).

## Update Cadence

Alpha / early-access; patches weekly during active test period.

## Related

[[source-sdk-reference]], [[source2-schemasystem]], the `source-engine-specialist` agent.

<!-- enriched:v2 -->
