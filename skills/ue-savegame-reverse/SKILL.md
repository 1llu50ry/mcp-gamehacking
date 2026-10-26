---
name: ue-savegame-reverse
description: "UE4/UE5 SaveGame format reverse -- `USaveGame` serialization, headers, class fingerprints, binary vs JSON persistence."
metadata:
  type: tool-reference
  source: curated
  topics: [unreal, savegame, serialization, uassets]
---
# UE SaveGame Format

UE's `USaveGame` class serializes with the standard UE serializer. On disk: binary blob with a short header and a class name.

## Header layout
- 4 bytes: 'GVAS'
- UInt32: FileTypeTag version (usually 2)
- UInt32: PackageFileUE4Version (eg. 522)
- UInt32: SavegameFileVersion (usually 2)
- CustomVersions table.
- UInt32: SaveGameClassName length + UTF-16LE bytes.

## RE workflow
- Parse header -> class name -> load UE SDK dump for class fields -> deserialize via FArchive.
- Common tools: `uesave-rs` (Rust), `UEHelper`, `UAssetGUI`.

## Related
[[ue5-fname-pool]], the `unreal-engine-specialist` agent.
