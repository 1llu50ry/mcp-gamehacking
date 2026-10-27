---
name: blizzard-battlenet-protocol
description: "Battle.net desktop client ↔ server protocol — Warden (Blizzard AC), BGS (Battle Game Server) auth flow, module request streaming."
metadata:
  type: reference
  source: curated
  topics: [blizzard, battlenet, warden, bgs]
---
# Battle.net (Warden) protocol

Blizzard's launcher + anti-cheat (Warden) protocol lives on top of a proprietary binary RPC called BGS.

## BGS auth flow

1. TLS to `*.battle.net` edge.
2. Protobuf service registration (Auth, Challenge, Account, Presence, Social).
3. SRP6a challenge with Blizzard's modified salt.
4. Session token bound to HWID (CPUID + disk + MAC).

## Warden streaming

- Warden modules streamed from `warden.battle.net` on login + randomly during play.
- Each module is a signed PE-ish blob with its own tiny VM.
- Module asks the client to hash a region, check a signature, enumerate drivers, etc. Result returned via Protobuf.
- Modules are short-lived (expire within hours), so static dumps go stale fast.

## RE pointers

- `Battle.net.exe` is Electron; UI side is JS, auth side native.
- Native handler lives in `Agent.exe` (per-game helper).

## Related

[[anti-cheat-timeline]], [[anti-cheat-analyst]], [[overwatch-offsets]].
