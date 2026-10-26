---
name: minecraft-forge-fabric-rev
description: "Minecraft (Java) modding -- Forge / Fabric / Quilt mod loaders, mixins, ASM transformers, ClassLoader hooks, Baritone / Meteor cheat clients."
metadata:
  type: tool-reference
  source: curated
  topics: [minecraft, forge, fabric, quilt, mixins, baritone, meteor]
---
# Minecraft Java Modding + Cheats

Minecraft Java is Java 17/21 obfuscated via Mojang's SRG mappings. Mod ecosystems:

- **Forge**: oldest, ASM transformers.
- **Fabric**: lightweight, mixin-based.
- **Quilt**: Fabric fork, better API.

## Reversing
- Decompile `minecraft-$ver.jar` via `fernflower` or `CFR`.
- Apply MCP/Yarn mappings for human names.
- Mod code lives in `src/main/java/<pkg>`.

## Known cheat clients
- Meteor Client (Fabric)
- Future Client (Forge)
- Baritone (automation/path-finding)

## Anti-cheat (server-side)
- Grim Anticheat, Vulcan, Matrix, NoCheatPlus; all server-side packet-based.
- Server-side rate limits + movement validation defeat most pvp cheats.

## Related
Pairs with the `cheat-developer` agent + the `minecraft-modder` agent.
