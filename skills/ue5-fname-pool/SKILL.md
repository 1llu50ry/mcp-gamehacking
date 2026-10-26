---
name: ue5-fname-pool
description: "Unreal Engine 5 FNamePool -- block / chunk layout, hash function, how to walk the pool from an external process, and how it differs from UE4 FName."
metadata:
  type: tool-reference
  source: curated
  topics: [ue5, fname, fnamepool, offsets, reflection]
---
# UE5 FNamePool

UE5 replaced UE4's `FNameEntry*` array with a block/chunk `FNamePool`. The old `ComparisonIndex` (uint32) now indexes into a bank of memory banks.

## Layout

```
FNamePool
  Blocks[FNameMaxBlocks]      // 8192 blocks of 65536 bytes each
  CurrentBlock, CurrentByteCursor
```

An `FName` holds `(BlockIndex : 16, Offset : 16)` in a 32-bit `FNameEntryId`. The pool is append-only.

## External walker

```cpp
auto block = pool->Blocks[entryId >> 16];
auto bytes = reinterpret_cast<FNameEntry*>(block + (entryId & 0xFFFF));
FString s = bytes->ToString();
```

## Dumpers

- `Dumper-7` (recent): auto-detects pool layout per build.
- `UniversalDumper` + custom plug-in.

## Related

[[ue4-sdk-reference]], [[ue5-sdk-reference]], the `unreal-engine-specialist` agent.
