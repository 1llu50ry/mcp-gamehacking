# MCP Hub — aggregating other MCP servers

Our server acts as a **CLIENT** to other MCP servers (`ghidra-mcp`, `ida-pro-mcp`, `superghidra-mcp`, `x64dbg-mcp`, `cheat-engine-mcp`, `frida-mcp`, etc.) and re-exposes their tools via proxy tools. One connection point for every downstream agent.

## Tools

| Tool | What it does |
|---|---|
| `hub_connect` | Connect to a backend MCP (stdio or streamable HTTP). |
| `hub_list` | List connected backends and the tools each exposes. |
| `hub_call` | Invoke any tool on a connected backend. |
| `hub_disconnect` | Close a backend connection. |
| `smart_decompile` | Dispatch to whichever connected backend offers a `decompile`-like tool. Returns first success and lists alternatives. |
| `hub_consensus_call` | Fan a tool call out across every backend whose tool name matches a regex. Each result returned as its own block so your agent (or `mesh_task_vote`) decides consensus. |

## Why

- Downstream agents (Claude, Codex, Cursor) only need to configure **one** MCP: ours.
- Backend swap is a config change, not a client change.
- Composable: `smart_decompile` picks IDA when available, falls back to Ghidra, falls back to Binja, falls back to RetDec.
- Adversarial validation: fan a `decompile` out to IDA + Ghidra + Binja and compare — disagreement surfaces bugs.

## Example

```jsonc
// agent A connects us to IDA + Ghidra
{"method":"tools/call","params":{"name":"hub_connect","arguments":{
  "id":"ida",   "transport":"stdio","cmd":"ida-pro-mcp" } } }
{"method":"tools/call","params":{"name":"hub_connect","arguments":{
  "id":"ghidra","transport":"http","url":"http://127.0.0.1:8765/mcp" } } }

// now any agent can call either
{"method":"tools/call","params":{"name":"hub_call","arguments":{
  "id":"ida","tool":"decompile","args":{"address":"0x401000"} } } }

// or fan it out
{"method":"tools/call","params":{"name":"hub_consensus_call","arguments":{
  "matcher":"decompile","args":{"address":"0x401000"} } } }
```

## Shutdown

Child-process backends are torn down on `process.exit`. HTTP backends are closed explicitly via `hub_disconnect`.
