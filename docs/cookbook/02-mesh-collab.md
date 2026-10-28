# Recipe 2 — Multi-model agent mesh

**Goal:** Claude, GPT-4, and a Cursor agent collaborate on reversing one
binary. One channel, one shared KV store, one vote at the end.

## Pieces

- `agent_mesh_join` — register a participant
- `agent_mesh_create_channel` / `agent_mesh_post` — DM-style threads
- `agent_mesh_kv_set` / `agent_mesh_kv_get` — shared scratch state
- `agent_mesh_vote_open` / `agent_mesh_vote_cast` — consensus
- `agent_mesh_handoff` — pass an open task to another model

Everything persists to `.agent-mesh/mesh.json` via zero-dep JSON
with atomic write-rename, so a crashed participant doesn't lose state.

## Flow

```
┌────────┐     join    ┌───────────┐
│ claude │ ──────────► │           │
├────────┤             │   mesh    │
│ gpt-4  │ ──────────► │  channel  │
├────────┤             │ #triage-7 │
│ cursor │ ──────────► │           │
└────────┘             └───────────┘
     ▲                        │
     │  handoff "decompile"   │
     └────────────────────────┘
```

## MCP sequence

```jsonc
// 1 — claude joins
{ "name": "agent_mesh_join", "arguments": { "name": "claude-opus-4.7", "role": "lead" }}

// 2 — open a channel
{ "name": "agent_mesh_create_channel", "arguments": { "name": "triage-7", "members": ["claude-opus-4.7"] }}

// 3 — invite gpt
{ "name": "agent_mesh_channel_invite", "arguments": { "channel": "triage-7", "name": "gpt-4" }}

// 4 — share a finding
{ "name": "agent_mesh_kv_set", "arguments": { "ns": "triage-7", "key": "oep", "val": "0x40A1B2" }}

// 5 — ask for a plan vote
{ "name": "agent_mesh_vote_open", "arguments": {
    "channel": "triage-7",
    "question": "Dump at OEP or trace through VM?",
    "options": ["dump", "trace"]
}}

// 6 — each model casts
{ "name": "agent_mesh_vote_cast", "arguments": { "voteId": "v-123", "voter": "claude-opus-4.7", "option": "dump" }}

// 7 — hand off the actual dump task
{ "name": "agent_mesh_handoff", "arguments": {
    "channel": "triage-7",
    "to": "cursor-agent",
    "task": "Attach x64dbg at 0x40A1B2 and run `dump memory`."
}}
```

## When to use

Long-running RE sessions where no single model has all the context, or
where cost/speed trade-offs favor routing different subtasks to
different models.
