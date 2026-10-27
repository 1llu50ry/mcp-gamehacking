# Design — Index

> **Scope:** Authoritative design docs for `local-memory-mcp`. For canonical
> adopted ADRs/specs see [`decisions`](decisions) (`ADR-001`–`ADR-008`,
> `SPEC-001`). For operations runbooks see [`../application/modules/codebase-index`](../application/modules/codebase-index).

## Blueprint contract

The project blueprint requires `design/{architecture,domain,database,flows,decisions}/`.
This repository fulfills that contract; two additional buckets extend it without
breaking it (see § Extended buckets).

| Contract dir   | Path                                                           | Content                                                                                                                                                          | Status                              |
| :------------- | :------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------- |
| `architecture` | [`architecture/architecture.md`](architecture/architecture.md) | Physical & process architecture, component logic, data flows (MCP stdio + Dashboard :3456), tech rationale, soul maintenance, KG architecture                    | ✓ exists                            |
| `domain`       | [`domain/domain.md`](domain/domain.md)                         | 10 core entities (Memory/Task/TaskComment/Standard/ActionLog/Handoff/Claim/Entity/Relation/Observation) + 6 business-rule invariants                             | ✓ exists                            |
| `database`     | [`database/schema.md`](database/schema.md)                     | SQLite schema v24: 16+ tables, vectors, FTS5, queue outbox, codebase index, KG `confidence` (v24)                                                                | ✓ exists                            |
| `flows`        | [`flows/README.md`](flows/README.md)                           | **Bridge/index** — canonical flows live in `ui/flows/` + `flows/codebase-index.md`; this dir satisfies the blueprint top-level contract and inventories flows per domain | ✓ bridge (new)                      |
| `decisions`    | [`decisions/`](decisions/)                                     | Draft-stage ADRs for design iterations; canonical adopted ADRs live in `decisions`                                                                  | ✓ exists (2 drafts + bridge README) |

## Extended buckets (beyond contract)

These are intentional extensions — not a contract violation. The blueprint's
five dirs remain the contract; the two below are additive.

| Dir              | Path                                 | Purpose                                                                                                                                                                                                    |
| :--------------- | :----------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codebase-index` | [`../application/modules/codebase-index/specs/`](../application/modules/codebase-index/specs/) + [`flows/codebase-index.md`](flows/codebase-index.md) + [`ui/{components,navigation,wireframes}/codebase-index.md`](ui/components/codebase-index.md) | Specialized design bundle for the codebase index feature — relocated per Opsi A (specs: architecture/domain/schema/edge; flows: `flows/codebase-index.md`; ui: `ui/{components,navigation,wireframes}/codebase-index.md`)                            |
| `ui`             | [`ui/`](ui/)                         | Dashboard Svelte 5 UI design (10 docs: `components/inventory.md`, `flows/user-flows.md` (7 flows), `navigation/site-map.md`, `tokens/design-system.md`, `wireframes/{main-wireframe,dashboard-layout}.md`) |

> **Why not merged?** `codebase-index` was a cross-cutting index subsystem
> (tree-sitter WASM, FTS5 `codebase_*`, reference edges) — per Opsi A its 8 docs
> are now split across `application/modules/codebase-index/specs/`, `design/flows/codebase-index.md`,
> and `design/ui/{components,navigation,wireframes}/codebase-index.md` to avoid overloading the 5 contract dirs. `ui/` is the
> human-facing dashboard surface (glass shell, Kanban, KG canvas). Merging
> either into the 5 contract dirs would overload them.

## Canonical flow locations

Flows are authored where they are consumed; `design/flows/` is the
blueprint-level bridge:

- **Dashboard flows** → [`ui/flows/user-flows.md`](ui/flows/user-flows.md) (7 flows: audit, bulk import, reference, Kanban promotion, KG, standards, handoffs)
- **Codebase Index flows** → [`flows/codebase-index.md`](flows/codebase-index.md) (5 flows: file tree, symbol search, call graph, re-index, index status)
- **Top-level inventory** → [`flows/README.md`](flows/README.md) (per-domain table + guidance)

See `flows/README.md` for the full per-domain mapping.

## Decisions — ownership split

| Location                 | Purpose                               | Lifecycle                       | Numbering                              |
| :----------------------- | :------------------------------------ | :------------------------------ | :------------------------------------- |
| `design/decisions/`      | Draft ADRs tied to a design iteration | Draft → adopted or withdrawn    | `adr-00N-*` (lowercase)                |
| `decisions` | Canonical adopted ADRs/specs          | Proposed → Adopted → Superseded | `ADR-00N-*` / `SPEC-00N-*` (uppercase) |

Current `design/decisions/` inventory is bridged in
[`decisions/README.md`](decisions/README.md); canonical ADRs are in
[`decisions`](decisions).

## Reading order

1. [`architecture/architecture.md`](architecture/architecture.md) — system shape
2. [`domain/domain.md`](domain/domain.md) — entities & invariants
3. [`database/schema.md`](database/schema.md) — storage contract
4. [`flows/README.md`](flows/README.md) → `ui/flows/` / `flows/codebase-index.md` — behaviour
5. [`decisions/README.md`](decisions/README.md) → `decisions` — rationale
6. Feature deep-dives: [`application/modules/codebase-index/specs/`](../application/modules/codebase-index/specs/) + [`design/flows/codebase-index.md`](flows/codebase-index.md) + [`ui/`](ui/) as needed
