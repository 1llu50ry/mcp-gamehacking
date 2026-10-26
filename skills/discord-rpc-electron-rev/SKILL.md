---
name: discord-rpc-electron-rev
description: "Discord RPC spoofing + Electron client reversing -- IPC pipes (`\\.\pipe\discord-ipc-0..9`), Discord's Electron internals, RPC presence spoof."
metadata:
  type: tool-reference
  source: curated
  topics: [discord, rpc, electron, ipc, cdp]
---
# Discord RPC + Electron Reversing

Discord ships Electron. RPC lets other apps publish presence via a local pipe.

## Pipes
- Windows: `\\.\pipe\discord-ipc-0..9`.
- Unix: `$XDG_RUNTIME_DIR/discord-ipc-0..9`.
- Protocol: JSON over Opcode-framed messages.

## Spoof
- Register a client_id (your own Discord app).
- Emit `SET_ACTIVITY` with arbitrary text + party size.
- Playtime, game, server name -- all client-asserted.

## Reversing Discord itself
- Attach V8 Inspector via `--remote-debugging-port` (use the `v8-inspector-mcp` backend).
- Patch the asar archive for client mods.

## Related
Pairs with `discord-researcher` agent + [[v8-inspector-mcp]].
