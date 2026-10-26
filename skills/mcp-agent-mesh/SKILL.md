---
name: mcp-agent-mesh
description: "Multi-agent collaboration layer built into mcp-gamehacking. Lets Claude Code, Codex/ChatGPT, Cursor, Copilot, Gemini CLI, and custom agents share a workspace via MCP: register, DM + channel broadcast, task handoff, adversarial voting, shared KV knowledge-base, named locks. Persistence to JSON (zero-dep). See docs/agent-mesh.md."
metadata:
  type: tool-reference
  source: built-in
  topics: [multi-agent, mcp, collaboration, voting, knowledge-base, handoff]
---

# Agent Mesh (built in)

Multi-agent collaboration over MCP. Any MCP-capable client registers once and participates. See [docs/agent-mesh.md](../../docs/agent-mesh.md) for the full tool list and flow diagrams.

## Why

- One shared workspace across heterogeneous agents (Claude + Codex + Cursor + Gemini + Copilot).
- Adversarial validation: three agents vote on each other's findings.
- Persistent audit trail (`.agent-mesh/mesh.json`) for replay / review.
- No new npm deps; just file persistence.

## Related

Pairs with [[mcp-hub]] for aggregating backends and with the per-agent specialists (e.g. `cs2-specialist`, `exploit-developer`, `reverse-engineer`).
