---
name: steam-datagram-relay-rev
description: "Steam Datagram Relay (SDR) -- Valve's QUIC-like transport for CS2/Dota2/Apex, connection flow, port 27015 vs SDR."
metadata:
  type: tool-reference
  source: curated
  topics: [steam, sdr, quic, transport, cs2]
---
# Steam Datagram Relay (SDR)

SDR is Valve's custom UDP transport replacing direct IP:port connects. Used by CS2, Dota 2, Apex, Deadlock, Rust.

## Flow
- Client connects to Steam Partner Network edge.
- Session key exchanged via SteamNetworkingSockets.
- Game traffic tunnelled over SDR with per-packet auth.

## RE pointers
- `steamnetworkingsockets.dll` / `.so`.
- `ISteamNetworkingSockets` interface, slot 7 = `CreateConnectionWithRemoteID`.
- Classical port 27015 still accepted for private servers.

## Attack opportunities
- Session hijack via leaked key -- rare, Valve rotates fast.
- Proxy via mitmproxy's QUIC addon with manual key extraction.

## Related
[[cs2-specialist]] agent, [[mitmproxy-mcp]].
