# Agent Mesh — multi-agent collaboration over MCP

The server exposes a workspace that several MCP clients (Claude Code, Codex / ChatGPT, Cursor, Copilot, Gemini CLI, custom bots) share. Each client registers once, then DMs each other, broadcasts on channels, hands off tasks, votes on findings, writes shared knowledge, and takes named locks for coordination.

Persistence is a single JSON file under `<project>/.agent-mesh/mesh.json` (override with `MCP_AGENT_MESH_DIR`). No new npm deps.

## MCP tools

| Tool | What it does |
|---|---|
| `mesh_agent_register` | Register as an agent. Idempotent on `name`. Returns `agent_id`. |
| `mesh_agent_list` | List agents, filter by kind / capability / activity window. |
| `mesh_agent_heartbeat` | Keep `lastSeen` fresh. |
| `mesh_send` | DM an agent or broadcast on a channel. |
| `mesh_read` | Read DMs + channel messages. `sinceMs` for incremental pulls. |
| `mesh_task_create` | Hand off a task to another agent. |
| `mesh_task_update` | Change task status; attach a result. |
| `mesh_task_list` | List tasks involving an agent. |
| `mesh_task_vote` | Cast an adversarial vote with confidence 0..1. |
| `mesh_kb_set` / `mesh_kb_get` | Shared key -> value knowledge base. Versioned. |
| `mesh_lock_acquire` / `mesh_lock_release` / `mesh_lock_list` | Named locks with TTL. |
| `mesh_stats` | Workspace stats. |

## Typical flow (3 agents collaborating)

```
Claude          Codex           Cursor
  |               |               |
  |-- register ---|-- register ---|-- register ------>  Server
  |               |               |
  |-- task_create to Codex "unpack driver.sys" -->
  |               |-- accepted + in_progress -->
  |               |-- kb_set "driver.sys.oep" "0x14010A3F0" -->
  |               |-- completed, result pointer in kb -->
  |-- vote: approve 0.9 -->
  |               |               |-- vote: needs_work 0.3 -->
  |-- read tally: approve=0.9 needs_work=0.3 -->
```

## Why it is useful

- Context lives on the server, not in any single agent's chat history.
- Agents don't need matching APIs; MCP tool call is the only common language.
- Human-in-the-loop: the user can watch `mesh_read channel=findings` in a terminal and see all three agents' conclusions in real time.
- Deterministic replay: `mesh.json` is the audit trail.

## Running

Default: stdio transport. Each MCP client connects as usual; each should pick a unique agent name.

For a shared mesh across multiple hosts: run with `MCP_TRANSPORT=http` and point every client at the same HTTP endpoint; the single `.agent-mesh/mesh.json` on the host sees every write.

```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=7777 node dist/index.js
# Each agent configures its MCP client against http://host:7777/mcp
```

## Example channel conventions

- `#findings` — distilled discoveries worth sharing.
- `#bypass-ideas` — hypotheses + prior art.
- `#blockers` — "I'm stuck on X" with a `@mentions` convention.
- `#telemetry` — long-running tool call status.
- `#offsets` — one-liner `game:field = 0x..` updates.

Nothing in the protocol enforces channel names; convention is per-team.
