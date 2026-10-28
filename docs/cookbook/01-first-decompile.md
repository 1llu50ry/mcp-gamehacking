# Recipe 1 — First decompile with hub fail-over

**Goal:** decompile a function at `0x401000` in `malware.exe`, trying
Ghidra first, then IDA, then Binary Ninja — whichever one is reachable.

## Pieces

- `smart_decompile` — tool in `src/retools.ts` that tries hub backends in order
- `plugins-side/ghidra/mcp_bridge.py` — port 48760
- `plugins-side/ida-pro/mcp_bridge.py` — port 48761
- `plugins-side/binaryninja/mcp_bridge.py` — port 48766

## Install plugins

```powershell
# windows
cd plugins-side
.\install.ps1 -Apply -Only ghidra,ida,binja
```

```bash
# linux / macos
cd plugins-side
./install.sh --apply --only ghidra ida binja
```

Launch each host, open `malware.exe`, let analysis finish.

## MCP call

```jsonc
// request
{ "method": "tools/call", "params": {
  "name": "smart_decompile",
  "arguments": { "addr": "0x401000", "sample": "malware.exe" }
}}
```

```jsonc
// response (ghidra reachable)
{ "ok": true, "backend": "ghidra", "code": "int main() { … }" }
```

If Ghidra is down, the hub tries IDA, then Binja — the caller sees
whichever succeeded first in `backend`.

## Verify with mocks (no real hosts needed)

```bash
# terminal 1 — mock ghidra on 48760
node -e "import('./tests/mock-bridge-server.mjs').then(m=>m.startMockBridge({host:'ghidra',port:48760}))"

# terminal 2 — call it
curl -s http://127.0.0.1:48760/rpc \
  -H 'content-type: application/json' \
  -d '{"tool":"decompile","args":{"addr":"0x401000"}}'
```

## When to use

Analysts who switch hosts constantly, or AI agents that should degrade
gracefully instead of refusing when one tool is unavailable.
