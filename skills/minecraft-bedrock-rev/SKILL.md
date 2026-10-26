---
name: minecraft-bedrock-rev
description: "Minecraft Bedrock Edition (Windows / Mobile) reversing -- native C++ binary, UWP sandbox, Scripting API, popular inner-core mods."
metadata:
  type: tool-reference
  source: curated
  topics: [minecraft, bedrock, uwp, inner-core, scripting-api]
---
# Minecraft Bedrock Reverse Engineering

Bedrock is C++ (not Java), ships as a UWP appx on Windows and native .so on Android/iOS.

## Attack surface
- Scripting API (JS) in modern builds -- replaces the behavior packs API.
- Inner Core (Android) -- CoreEngine mod loader.
- NetHandler packet dispatch for server-side mods.

## Known tooling
- BDS (Bedrock Dedicated Server) + mods via LLSE / LeviLamina.
- MCPE+ series.

## Related
[[minecraft-forge-fabric-rev]], [[android-researcher]].
