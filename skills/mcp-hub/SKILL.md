---
name: mcp-hub
description: "Built-in MCP Hub -- our server connects to other MCP backends (ghidra-mcp, ida-pro-mcp, superghidra-mcp, x64dbg-mcp, cheat-engine-mcp, frida-mcp, ...) as a CLIENT and re-exposes their tools via `hub_call`. Composable: `smart_decompile` picks the first available decompiler; `hub_consensus_call` fans out across backends for adversarial comparison."
metadata:
  type: tool-reference
  source: built-in
  topics: [mcp, aggregator, hub, consensus, fanout, decompile]
---

# MCP Hub (built in)

Aggregator layer that lets downstream agents only configure **one** MCP (ours) and reach every backend through it. See [docs/mcp-hub.md](../../docs/mcp-hub.md).

## Why

- One MCP config in your agent, N backends behind it.
- `smart_decompile` -- transparent failover (IDA -> Ghidra -> Binja -> RetDec).
- `hub_consensus_call` -- adversarial fan-out, surface disagreement.
- Compose with [[mcp-agent-mesh]] for cross-agent voting on the fanned-out results.

## Related

Pairs with [[mcp-agent-mesh]] and every per-backend skill: [[superghidra-mcp]], [[ida-pro-mcp]], [[x64dbg-mcp-server]], [[cheat-engine-mcp]], [[frida-mcp]], [[binary-ninja-mcp]], etc.
