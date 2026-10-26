---
name: marvel-rivals-rev
description: "Marvel Rivals (NetEase, UE5) reverse engineering -- MR anti-cheat (NetEase AC), hero data, ability projectiles, matchmaking."
metadata:
  type: tool-reference
  source: curated
  topics: [marvel-rivals, netease, ue5, ac]
---
# Marvel Rivals

NetEase UE5-based hero shooter. Anti-cheat: NetEase AC (same family as Naraka).

## RE pointers
- UE5 GObjects/GNames with chunked FNamePool
- Standard UE5 hooks apply ([[ue5-fname-pool]])
- NetEase AC: kernel driver + userland EAC-like checks

## Related
[[fortnite-eac-ec-rev]], [[ue5-fname-pool]].
