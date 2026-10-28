# plugins-side/

Plugins we ship for the RE tools themselves. Each plugin runs inside its host and exposes a tiny HTTP MCP surface that our native TS clients (`ghidra_*`, `ida_*`, `reclass_*`, `dnspy_*`, `ilspy_*`, `x64dbg_*`, `binja_*`, `ce_*`) call. One connection into our server; everything flows through it.

| Plugin | Host | Port | Install |
|---|---|---:|---|
| `cheat-engine/mcp_bridge.lua` | Cheat Engine 7.5+ | 52736 | drop into `<CE>/autorun/` |
| `ghidra/mcp_bridge.py` | Ghidra 11+ | 48760 | run from Script Manager OR `analyzeHeadless -postScript` |
| `ida-pro/mcp_bridge.py` | IDA Pro 7.5+ | 48761 | drop into `<IDA>/plugins/` |
| `reclass-net/MCPBridgePlugin.cs` | ReClass.NET 1.2+ | 48762 | build + drop DLL into `<ReClass>/Plugins/` |
| `dnspy/MCPBridgePlugin.cs` | dnSpy / dnSpyEx | 48763 | build + drop DLL into `<dnSpy>/Extensions/` |
| `ilspy/MCPBridgeAddin.cs` | ILSpy 8+ | 48764 | build + drop DLL into ILSpy addin dir |
| `x64dbg/mcp_bridge.cpp` | x64dbg (latest) | 48765 | build .dp64 / .dp32, drop into `<x64dbg>/x64/plugins` |
| `binaryninja/mcp_bridge.py` | Binary Ninja | 48766 | drop into `<binja>/plugins/` |

Every plugin exposes two always-on endpoints:

- `GET /healthz` — static readiness (plugin loaded + port bound). `bridge_health_all` from the client side probes them in parallel and tells you which are up.
- `GET /ready` — host readiness (IDA auto-analysis idle, Ghidra autoAnalysis finished, Binja analysis idle, …). Hit this before firing a decompile request on a cold session so you don't trigger a race with the host's own analysis pass.

Every response also carries CORS headers (`access-control-allow-origin: *`, `-methods: GET,POST,OPTIONS`, `-headers: content-type`) so a browser-based MCP client (claude.ai, Cursor web) can call the plugin directly.

### Thread safety

Hosts that are **not** thread-safe on their SDK (IDA, Ghidra, ReClass.NET) wrap every handler in the host's main-thread dispatcher (`ida_kernwin.execute_sync`, Ghidra's `SwingUtilities.invokeAndWait`-equivalent, ReClass.NET's `MainForm.Invoke`). Binary Ninja's SDK is thread-safe so handlers run directly on the HTTP worker thread.

## Build notes

### C# plugins (ReClass / dnSpy / ILSpy)

Each is a single `.cs` file plus a reference to the host SDK:

- **ReClass.NET**: `csc /target:library /reference:ReClassNET.exe MCPBridgePlugin.cs`
- **dnSpy**: build inside a dnSpy extension solution (System.ComponentModel.Composition + dnSpy.Contracts.*).
- **ILSpy**: build inside an ILSpy plugin solution (ICSharpCode.Decompiler + ILSpy's `IPlugin` host).

Target framework must match the host (dnSpyEx: net8-windows; stable ILSpy: net8-windows; ReClass.NET: net481).

### x64dbg C++

Link against x64dbg's `pluginsdk`:

```powershell
cl /std:c++17 /EHsc /LD mcp_bridge.cpp ^
   /I <x64dbg>\plugins\sdk ^
   /link <x64dbg>\plugins\sdk\x64dbg.lib ^
          <x64dbg>\plugins\sdk\x64bridge.lib ^
   /OUT:mcp_bridge.dp64
```

Repeat for 32-bit against the x32 sdk.

### Python plugins (IDA / Binja / Ghidra)

Drop-in, no build. Each starts an `HTTPServer` on a dedicated port in a daemon thread so you can still use the host tool normally.

### Lua (Cheat Engine)

Uses CE's bundled LuaSocket. The server runs via a CE timer so the host remains responsive.

## Env overrides

Each client honours a host + port env var:

```
MCP_GHIDRA_HOST / MCP_GHIDRA_PORT       (default 127.0.0.1:48760)
MCP_IDA_HOST / MCP_IDA_PORT             (default 127.0.0.1:48761)
MCP_RECLASS_HOST / MCP_RECLASS_PORT     (default 127.0.0.1:48762)
MCP_DNSPY_HOST / MCP_DNSPY_PORT         (default 127.0.0.1:48763)
MCP_ILSPY_HOST / MCP_ILSPY_PORT         (default 127.0.0.1:48764)
MCP_X64DBG_HOST / MCP_X64DBG_PORT       (default 127.0.0.1:48765)
MCP_BINJA_HOST / MCP_BINJA_PORT         (default 127.0.0.1:48766)
MCP_CESERVER_HOST / MCP_CESERVER_PORT   (default 127.0.0.1:52736)
```

Use these when the host tool runs on a different box (DMA labs, kernel-debug mirror, test VM, etc).

## HTTP surface shape

Every plugin shares the same tiny protocol:

- `GET /healthz` — JSON probe. All clients hit this via `*_health`.
- `POST /tool/<name>` — JSON body in, JSON body out.
- On unknown path: `404 {"error": "unknown path"}`.
- On exception: `500 {"error": "..."}`.

The native TS clients never try to be clever — they `fetch()` the endpoint and forward the response verbatim, which keeps the plugin and the client decoupled.
