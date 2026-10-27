# Diablo II Cheat Engine Address Table

| ID | Description | Variable Type | Address | Offset | Signed | Hex |
|----|-------------|---------------|---------|--------|--------|-----|
| 1 | update_counter | 4 Bytes | D2GAME.dll+1107B8 | 48C | No | No |
| 34 | Life | 2 Bytes | D2GAME.dll+1107B8 | 490 | No | No |
| 2 | Mana | 2 Bytes | D2GAME.dll+1107B8 | 492 | No | No |
| 29 | Stamina | 2 Bytes | D2GAME.dll+1107B8 | 494 | No | No |
| 30 | Class | Byte | D2GAME.dll+1107B8 | 496 | No | No |
| 31 | Level | Byte | D2GAME.dll+1107B8 | 497 | No | No |
| 32 | y_coord | 2 Bytes | D2GAME.dll+1107B8 | 498 | No | No |
| 33 | x_coord | 2 Bytes | D2GAME.dll+1107B8 | 49A | No | No |
| 35 | Coordinate flags | 2 Bytes | D2GAME.dll+1107B8 | 49C | No | No |
| 36 | Unknown word | 2 Bytes | D2GAME.dll+1107B8 | 49E | No | No |
| 37 | Cached mana for sync | 2 Bytes | D2GAME.dll+1107B8 | 4A0 | No | No |
| 38 | Last experience points | 2 Bytes | D2GAME.dll+1107B8 | 4A2 | No | No |
| 3 | PlayerUnit | 4 Bytes | D2CLIENT.dll+0x11BBFC | 0 | No | No |
| 4 | GameInfo | 4 Bytes | D2CLIENT.dll+11B980 | 0 | No | No |
| 5 | MouseOffsetY | 4 Bytes | D2CLIENT.dll+11995C | - | Yes | No |
| 6 | MouseOffsetX | 4 Bytes | D2CLIENT.dll+119960 | - | Yes | No |
| 7 | Divisor | 4 Bytes | D2CLIENT.dll+F16B0 | - | Yes | No |
| 8 | yShake | 4 Bytes | D2CLIENT.dll+10B9DC | - | Yes | No |
| 9 | Ping | 4 Bytes | D2CLIENT.dll+119804 | - | No | No |
| 10 | Skip | 4 Bytes | D2CLIENT.dll+119810 | - | No | No |
| 11 | FPS | 4 Bytes | D2CLIENT.dll+11C2AC | - | No | No |
| 12 | WaypointTab | 4 Bytes | D2CLIENT.dll+FCDD6 | - | No | No |
| 13 | xShake | 4 Bytes | D2CLIENT.dll+11BF00 | - | Yes | No |
| 14 | SelectedInvItem | 4 Bytes | D2CLIENT.dll+11BC38 | 0 | No | No |
| 15 | AutomapMode | 4 Bytes | D2CLIENT.dll+F16B0 | - | Yes | No |
| 16 | OffsetY | 4 Bytes | D2CLIENT.dll+11C1F8 | - | Yes | No |
| 28 | OffsetX | 4 Bytes | D2CLIENT.dll+11C1FC | - | Yes | No |
| 17 | FirstAutomapLayer | 4 Bytes | D2CLIENT.dll+11C1C0 | 0 | No | No |
| 18 | AutomapLayer | 4 Bytes | D2CLIENT.dll+11C1C4 | 0 | No | No |
| 19 | AutomapYPosition | 4 Bytes | D2CLIENT.dll+11C21C | - | Yes | No |
| 20 | PlayerUnit | 4 Bytes | D2CLIENT.dll+11BBFC | 0 | No | No |
| 21 | PlayerUnitList | 4 Bytes | D2CLIENT.dll+11BC14 | 0 | No | No |
| 22 | QuestTab | 4 Bytes | D2CLIENT.dll+123395 | - | No | No |
| 23 | MouseX | 4 Bytes | D2CLIENT.dll+11B828 | - | No | No |
| 24 | MouseY | 4 Bytes | D2CLIENT.dll+11B824 | - | No | No |
| 25 | MapId | 4 Bytes | D2CLIENT.dll+11C3BC | - | No | No |
| 26 | AutomapOn | 4 Bytes | D2CLIENT.dll+FADA8 | - | No | No |
| 27 | bWeapSwitch | 4 Bytes | D2CLIENT.dll+11BC94 | - | No | No |
| 39 | SendAttributeChangePacket | 4 Bytes | D2GAME.dll+8AE10 | - | No | Yes |

## Summary
- **Total Entries**: 35 addresses
- **D2GAME.dll addresses**: 13 entries (mostly player stats and coordinates)
- **D2CLIENT.dll addresses**: 22 entries (UI, mouse, automap, and game state)
- **Variable Types**: Byte (2), 2 Bytes (10), 4 Bytes (23)
- **Pointer Addresses** (with offsets): 8 entries