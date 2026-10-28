# Recipe 3 — Live Cheat Engine session end-to-end

**Goal:** attach to a running game, scan an array-of-bytes for the
player struct, map it in ReClass, and export a C++ header — without
leaving the MCP session.

## Pieces

- `plugins-side/cheat-engine/mcp_bridge.lua` — port 52736
- `plugins-side/reclass-net/MCPBridgePlugin.cs` — port 48762
- `ce_aob_scan` + `ce_read_bytes` + `reclass_export_header` tools

## Steps

### 1. Install both bridges

```powershell
cd plugins-side
.\install.ps1 -Apply -Only ce,reclass
```

Start Cheat Engine (auto-loads `autorun/mcp_bridge.lua`) and ReClass.NET
(auto-loads the DLL from its `Plugins` directory).

### 2. Find the player struct

```jsonc
{ "name": "ce_process_list" }
// → [{ "pid": 4512, "name": "game.exe" }, ...]

{ "name": "ce_attach", "arguments": { "pid": 4512 }}

{ "name": "ce_aob_scan", "arguments": {
    "pattern": "48 8B 05 ?? ?? ?? ?? 48 85 C0 74 ?? F3 0F 10 48"
}}
// → ["0x7FF6ABCD1234"]
```

### 3. Read raw bytes at that address

```jsonc
{ "name": "ce_read_bytes", "arguments": {
    "addr": "0x7FF6ABCD1234",
    "size": 256
}}
```

### 4. Hand off to ReClass for structural mapping

```jsonc
{ "name": "reclass_open_at", "arguments": {
    "addr": "0x7FF6ABCD1234",
    "name": "Player"
}}

{ "name": "reclass_set_field", "arguments": {
    "class": "Player", "offset": "0x18", "type": "float", "name": "health"
}}

{ "name": "reclass_export_header" }
// → "struct Player { char _0x0[0x18]; float health; … };"
```

The emitted header goes straight into your game-hacking project.

## When to use

Any live-process RE where you'd normally alt-tab between CE and
ReClass fifty times. The bridges talk directly to the host SDKs
(CE's `createTimer` on the main thread for ThreadSafe guarantees;
ReClass's `MainForm.Invoke` for UI-thread edits).
