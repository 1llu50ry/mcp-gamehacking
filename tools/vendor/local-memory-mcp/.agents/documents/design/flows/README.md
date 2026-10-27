# Flows — Bridge (Blueprint Contract)

> **Bridge note:** This `design/flows/` directory satisfies the blueprint contract
> `design/{architecture,domain,database,flows,decisions}/`. Canonical flow
> definitions live in domain-specific locations — this file is the top-level
> index that ties them together per the contract. Do not duplicate flow content
> here; link to the source of truth.

## Blueprint contract vs actual

| Blueprint expects | Actual location                       | Status                                        |
| :---------------- | :------------------------------------ | :-------------------------------------------- |
| `design/flows/`   | `design/flows/README.md` (this file)  | Contract fulfilled — bridge/index             |
| —                 | `design/ui/flows/user-flows.md`       | Canonical: Svelte dashboard flows (7 flows)   |
| —                 | `design/flows/codebase-index.md` | Canonical: Codebase Index tab flows (5 flows) |

`design/flows/` was previously missing because flows were authored where they
are consumed (UI and codebase-index). Per the blueprint this directory must
exist as the top-level contract entry; it now acts as a pointer and
per-domain inventory.

## Canonical sources

- **Dashboard flows:** [`../ui/flows/user-flows.md`](../ui/flows/user-flows.md)
- **Codebase Index flows:** [`./codebase-index.md`](./codebase-index.md)
- **Wireframes (supporting):** [`../ui/wireframes/main-wireframe.md`](../ui/wireframes/main-wireframe.md),
  [`../ui/wireframes/dashboard-layout.md`](../ui/wireframes/dashboard-layout.md)
- **Navigation:** [`../ui/navigation/site-map.md`](../ui/navigation/site-map.md)
- **Architecture context:** [`../architecture/architecture.md`](../architecture/architecture.md)

## Flows per domain

### Memory domain

| #   | Flow                            | Canonical                | Summary                                                                      |
| :-- | :------------------------------ | :----------------------- | :--------------------------------------------------------------------------- |
| 2   | Knowledge Seeding (Bulk Import) | `design/ui/flows` Flow 2 | Memories tab → Bulk Import modal (JSON/Markdown) → validation → list refresh |
| 1   | Contextual Information Audit    | `design/ui/flows` Flow 1 | Dashboard → repo select → widgets + Activity tab audit                       |

### Task domain

| #   | Flow                      | Canonical                | Summary                                                                                                |
| :-- | :------------------------ | :----------------------- | :----------------------------------------------------------------------------------------------------- |
| 4   | Task Recovery & Promotion | `design/ui/flows` Flow 4 | Kanban stalled task → detail + comments → status update via gradual promotion (`in_progress` required) |

### Standards domain

| #   | Flow                    | Canonical                | Summary                                                                 |
| :-- | :---------------------- | :----------------------- | :---------------------------------------------------------------------- |
| 6   | Coding Standards Review | `design/ui/flows` Flow 6 | Standards tab → browse/filter by language/stack → detail/edit/deprecate |

### Knowledge Graph domain

| #   | Flow                        | Canonical                | Summary                                                                           |
| :-- | :-------------------------- | :----------------------- | :-------------------------------------------------------------------------------- |
| 5   | Knowledge Graph Exploration | `design/ui/flows` Flow 5 | KG tab → repo select → force-directed graph → drag/zoom/hover → entity drill-down |
| 7   | Multi-Agent Coordination    | `design/ui/flows` Flow 7 | Handoffs tab → pending/accepted/expired → context inspect → claim release         |

### Codebase Index domain

| #   | Flow                                  | Canonical                      | Summary                                                                                      |
| :-- | :------------------------------------ | :----------------------------- | :------------------------------------------------------------------------------------------- |
| 1   | Browsing Project File Tree            | `design/flows/codebase-index` Flow 1 | Codebase tab → lazy file tree → expand → file viewer (syntax-highlighted)                    |
| 2   | Searching for Symbols by Name         | `design/flows/codebase-index` Flow 2 | Search bar → autocomplete (debounced 200ms) → SymbolList → kind filter → detail panel        |
| 3   | Viewing Symbol Details and Call Graph | `design/flows/codebase-index` Flow 3 | Symbol detail → Callers/Callees/References tabs → canvas call-DAG + CodebaseGraphPanel       |
| 4   | Triggering a Re-index                 | `design/flows/codebase-index` Flow 4 | Re-index button → confirm → Indexing/Progress → Complete/Error with retry                    |
| 5   | Viewing Index Status                  | `design/flows/codebase-index` Flow 5 | Top-bar status indicator (Idle/Indexing/Complete/Partial/Stale/Error) → stats dropdown/toast |

### Cross-cutting

| #   | Flow                          | Canonical                | Summary                                            |
| :-- | :---------------------------- | :----------------------- | :------------------------------------------------- |
| 3   | Inspecting Agent Capabilities | `design/ui/flows` Flow 3 | Reference tab → filter → tool drawer (JSON Schema) |

## Guidance for authors

- Add new **dashboard** flows to `design/ui/flows/user-flows.md`.
- Add new **codebase-index** flows to `design/flows/codebase-index.md`.
- Update this index table when a new cross-domain flow is added so the
  blueprint-level inventory stays complete.
- Keep Mermaid diagrams in the canonical files; this bridge stays diagram-free
  to avoid drift.
