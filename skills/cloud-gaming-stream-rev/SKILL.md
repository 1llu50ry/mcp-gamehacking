---
name: cloud-gaming-stream-rev
description: "Cloud gaming (xCloud, GeForce Now, PS Plus Premium, Luna) client reversing -- stream codec, input encoding, authentication, DRM bind, aim-latency considerations."
metadata:
  type: tool-reference
  source: curated
  topics: [cloud-gaming, xcloud, geforce-now, streaming, codec]
---
# Cloud Gaming Client Reversing

Cloud gaming thin clients ship an NVENC/AMF/H.264 decoder + input encoder + session WebRTC/UDP transport. The game runs on vendor hardware; you don't have the binary.

## Hooks that still work

- **Overlay** on the local decoder output (ESP via image-recognition of the stream frame).
- **Input injection** at the client side -- the server trusts your keyboard/mouse packets.
- **Latency measurement + prediction** -- compensate for round-trip; some aim tooling leans on this.

## What is blocked

- Memory read/write (process is remote).
- Server-side AC tooling runs on-prem; you cannot reach it.

## Related

Pairs with `cheat-developer` agent and the vision-based ESP skills.
