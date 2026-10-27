# ADR-006 — Knowledge Graph Infrastructure

**Date:** 2026-07-27
**Status:** Proposed
**Deciders:** Muhammad Rheza Alfin

> **IMPLEMENTED (PARTIAL — verified 2026-08-08):** all 7 legacy KG tools were removed — no KG MCP tools exist in the 20 canonical set, matching "Zero KG tools". KG is embedded as an aggregated `kg` context field in `memory-read`, `task-read`, and `standard-read` (src/mcp/tools/kg-archivist/query.ts) and via dashboard KG routes. **Difference from the design:** entity/relation auto-population is NOT inline in write tools — it runs asynchronously through the embedding outbox worker (TASK-013), and there is a dashboard KG tab + API CRUD (not shipped as MCP tools). KG-degree caching ships via migration v22 (`kg_degrees`).

## Context

The Knowledge Graph currently has **7 standalone MCP tools**:

- `create_entity`, `delete_entity`, `create_relation`, `delete_relation`, `delete_observation`
- `query_graph`, `kg-backfill`

After analysis, the KG is actually an **infrastructure neural layer** that should be embedded in memory-read, task-read, and standard-read — not a separate domain tool.

Concept:

```
memory-read({ query: "neural network" })
  ├── result: memories        ← search as usual
  └── kg: { entities, relations }  ← automatically from the KG layer

task-read({ query: "auth" })
  ├── result: tasks
  └── kg: { entities, relations }

standard-read({ query: "laravel controller" })
  ├── result: standards
  └── kg: { entities, relations }
```

## Decision Drivers

- **Zero KG tools**: the KG is infrastructure, not a user-facing domain
- **Embedded in read tools**: memory-read/task-read/standard-read automatically return KG context
- **Auto-populate**: entities/relations are created by the write tools
- **Cascade delete**: KG entities are deleted along with their source

## Decision Outcome

**Chosen option:** 0 KG tools — fully embedded.

All 7 tools are removed. KG entities/relations:

- **Auto-populated** by memory-write (✅ existing), task-write (➕), standard-write (➕)
- **Auto-returned** by memory-read, task-read, standard-read as an additional `kg` field
- **Auto-deleted** by cascade when memory/task/standard are deleted

### Changes in Read Tools

Each read tool adds a `kg` field to the response:

```jsonc
{
  // regular search results
  "results": [...],

  // additional KG neural context
  "kg": {
    "entities": [
      { "name": "JWT", "type": "concept", "source_domain": "memory" },
      { "name": "AuthService", "type": "symbol", "source_domain": "codebase" }
    ],
    "relations": [
      { "from": "JWT", "to": "AuthService", "type": "implemented_by" },
      { "from": "JWT", "to": "TASK-042", "type": "referenced_in" }
    ]
  }
}
```

## Consequences

**Positive:**

- Tool count drops: 7 → 0
- Clean concept: KG is infrastructure, not a tool
- Agents simply call the regular read tools — they get neural context automatically
- No additional tools for weak agents to learn

**Negative:**

- Read tool responses become larger (there is an additional `kg` field)
- Query performance: needs joins with KG tables on every read

## Related ADRs

- ADR-001 through ADR-005

## Implementation Plan

1. **REFACTOR-KG-001:** Add auto-populate KG logic to task-write handler
2. **REFACTOR-KG-002:** Add auto-populate KG logic to standard-write handler
3. **REFACTOR-KG-003:** Embed KG entities/relations in memory-read response
4. **REFACTOR-KG-004:** Embed KG entities/relations in task-read response
5. **REFACTOR-KG-005:** Embed KG entities/relations in standard-read response
6. **REFACTOR-KG-006:** Add cascade delete KG entities on memory/task/standard delete
7. **REFACTOR-KG-007:** Remove all 7 old KG tool definitions + cleanup
8. **REFACTOR-KG-008:** Update integration tests
