# Design Decisions — Unified

This folder is the **single source of truth for ADRs** — it holds both draft-stage and canonical adopted decisions. Drafts use lowercase `adr-*`; adopted decisions use uppercase `ADR-*`/`SPEC-*` in the same directory.

## Ownership model (single-folder since Opsi A)

Canonical ADRs previously lived in `_archive/decisions/` (now merged here) and the top-level `decisions/` folder. All 12 canonical docs (`ADR-001`–`ADR-011` + `SPEC-001`) now live alongside the 2 design drafts in this folder.

| Subset                     | Purpose                                                                                                  | Lifecycle                       | Numbering                                     |
| :------------------------- | :------------------------------------------------------------------------------------------------------- | :------------------------------ | :-------------------------------------------- |
| `adr-00N-*` (lowercase)    | Draft ADRs tied to a design iteration. Allowed to be superseded or withdrawn without a migration record. | Draft → adopted or withdrawn    | `adr-00N-*` (lowercase, hyphenated)           |
| `ADR-00N-*` / `SPEC-00N-*` | Canonical, adopted ADRs and cross-cutting specs. Source of truth for implemented constraints.            | Proposed → Adopted → Superseded | `ADR-00N-*` / `SPEC-00N-*` (uppercase prefix) |

`design/decisions/` (this folder) now fulfils both roles. The split is by **naming convention**, not by directory — this avoids cross-tree `_archive` references.

## Numbering note — overlap

`adr-002-codebase-index.md` (lowercase, draft design) and `ADR-005-codebase-index-simplification.md` (uppercase, canonical tool-consolidation) both touch the codebase-index area but are distinct: `adr-002` is the original architecture design, `ADR-005` is the later tool-consolidation decision that supersedes the legacy 6-tool surface. Numbering is independent per subset, so `adr-002` vs `ADR-005` overlap is expected.

## When to put an ADR where

- **Use lowercase `adr-` in this folder** when the decision is scoped to a design deliverable that has not shipped (e.g. a new index pipeline, a storage migration design). Promote to uppercase `ADR-` on adoption (rename in place).
- **Use uppercase `ADR-`/`SPEC-` in this folder** when the decision constrains shipped code or cross-cutting behaviour (domain simplification, ownership model, KG infrastructure, unified query spec). Every entry there must have an implementation note or verification stamp.

## Current inventory

Drafts:

- `adr-001-use-sqlite.md` — SQLite + ONNX foundation. Canonical counterpart: none (foundation pre-dates the adopted series; see `ADR-001`–`ADR-003` for domain simplifications that build on it).
- `adr-002-codebase-index.md` — Codebase index architecture. Canonical counterpart: `ADR-005-codebase-index-simplification.md` (tool consolidation) and `SPEC-001-unified-nl-query.md` (inline `key:value` tag syntax shared with the index query path).

Canonical (adopted, previously `_archive/decisions/`):

- `ADR-001-memory-domain-simplification.md` — Memory domain simplification
- `ADR-002-task-domain-simplification.md` — Task domain simplification
- `ADR-003-standard-domain-simplification.md` — Standard domain simplification
- `ADR-004-handoff-claim-simplification.md` — Handoff/claim simplification
- `ADR-005-codebase-index-simplification.md` — Codebase index tool consolidation (Zero oneOf — auto-infer)
- `ADR-006-knowledge-graph-infrastructure.md` — Knowledge graph infrastructure
- `ADR-007-agent-context-simplification.md` — Agent context simplification
- `ADR-008-global-vs-scoped-ownership-and-dashboard-repo-view.md` — Global vs scoped ownership & dashboard repo view
- `ADR-009-optional-multi-database-support.md` — SQLite default with optional future multi-database adapters
- `ADR-010-streamable-http-transport.md` — Opt-in Streamable HTTP transport for one daemon and many clients
- `ADR-011-split-memory-db-per-domain.md` — Split `memory.db` per domain (evaluated; keep single file)
- `SPEC-001-unified-nl-query.md` — Unified NL query (`key:value` inline tags)

## Links

- Canonical ADRs: `.` (this folder; `ADR-*`/`SPEC-*`)
- Codebase index architecture: [`../../application/modules/codebase-index/specs/design-architecture.md`](../../application/modules/codebase-index/specs/design-architecture.md)
- Operations runbook: [`../../application/modules/codebase-index/runbook.md`](../../application/modules/codebase-index/runbook.md)
