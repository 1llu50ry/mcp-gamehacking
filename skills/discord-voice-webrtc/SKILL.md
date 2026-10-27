---
name: discord-voice-webrtc
description: "Discord voice WebRTC pipeline — Opus 48 kHz, VAD, DTX, Discord's custom DTLS-SRTP server, Opus parameter fingerprint for voice-chat analysis."
metadata:
  type: reference
  source: curated
  topics: [discord, webrtc, opus, voice, dtls-srtp]
---
# Discord voice WebRTC

Discord's voice stack is WebRTC-based but with custom servers and heavy modifications.

## Pipeline

- Codec: Opus @ 48 kHz, 20 ms frames, variable bitrate (default 64 kbps, up to 384 kbps Boost).
- VAD: WebRTC AEC/ANS/VAD block, tuned to Discord's bias toward low-false-positive at the cost of chop.
- DTX (discontinuous transmission) sends silence frames at ~ 2.5 kbps.
- Transport: DTLS-SRTP to a Discord-run voice edge.
- Signalling: Discord Gateway (WebSocket) + Voice Gateway (also WS).

## Fingerprint

- Opus parameter set and framing is nearly unique to Discord vs. standard WebRTC (zoom, teams, meet).
- A packet-trace of the first 10 s is usually enough to identify Discord traffic vs. others on the wire.

## Related

[[discord-rpc-electron-rev]], [[mitmproxy-mcp]], [[discord-researcher]].
