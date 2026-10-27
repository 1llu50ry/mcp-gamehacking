# Task Lifecycle — FSM backlog → pending → in_progress → completed

> **Module:** `tasks` · **Feature:** Task FSM + Claims + Handoffs · **Tools:** `task-read/write/delete` + `claim-manage` + `handoff-read/write` · **Storage:** `tasks` + `task_comments` + `claims` + `handoffs`

## 1. Overview

Task Lifecycle is the execution spine of the local-memory MCP. Every unit of work is a `tasks` row that moves through a **6-state FSM** (`backlog` → `pending` → `in_progress` → `completed`, with `blocked` and `canceled` as side states) under strict transition rules. **Gradual promotion** is the core invariant: a task cannot jump from `backlog`/`pending`/`blocked` directly to `completed` — it must pass through `in_progress` via `claim-manage`. Completion auto-generates a `task_archive` memory, auto-releases the claim, and expires linked handoffs. Hierarchy (`parent_id`) and sequencing (`depends_on`) enable decomposition and ordering.

## 2. User Stories

| #   | As a ...           | I want ...                                                                       | So that ...                                                        |
| --- | ------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | Orchestrator       | to create decomposed tasks via `task-write(phase+title+description)`             | Work is tracked atomically with clear acceptance criteria          |
| 2   | Sub-agent          | to claim a task via `claim-manage(task_code+agent)` and move it to `in_progress` | Ownership is exclusive and auditable                               |
| 3   | Sub-agent          | to call `task-write(status=completed, est_tokens, comment)`                      | Completion is recorded, claim released, and archive memory created |
| 4   | Agent leaving work | to create a `handoff-write(summary, context, to_agent)` for unfinished work      | The next agent has concrete next steps without re-discovery        |
| 5   | Orchestrator       | to query `task-read(status, phase, query)` with hybrid search                    | I see board state and can prioritize/schedule                      |
| 6   | Reviewer           | to see `task_comments` audit trail per status transition                         | Every state change has attribution and rationale                   |

## 3. Business Logic (Pseudocode)

```text
enum Status { backlog, pending, in_progress, completed, canceled, blocked }

allowedTransitions = {
  backlog:     [pending, in_progress, blocked, canceled],
  pending:     [in_progress, blocked, canceled],
  blocked:     [pending, in_progress, canceled],
  in_progress: [completed, blocked, canceled],
  completed:   [],           // terminal
  canceled:    []            // terminal (soft-delete)
}

function transition(task, nextStatus, actor, opts):
  if nextStatus not in allowedTransitions[task.status]:
    throw FSMViolation(task.status → nextStatus)
  if nextStatus == in_progress:
    require claim-manage acquired for task.id by actor.agent
    task.in_progress_at = now()
  if nextStatus == completed:
    require opts.est_tokens is present
    require task.status == in_progress          // gradual promotion
    task.finished_at = now()
    createMemory(type=task_archive, title=task.title,
                 content=renderArchive(task, comments), scope=task.scope)
    releaseClaim(task.id)                       // auto-release
    expireHandoffs(task.id)                     // linked handoffs → expired
  if nextStatus == canceled:
    task.canceled_at = now()
    releaseClaim(task.id)
    expireHandoffs(task.id)
  insert task_comments {task_id, comment:opts.comment,
                        previous_status:task.status, next_status:nextStatus,
                        agent:actor.agent, role:actor.role, model:actor.model}
  task.status = nextStatus; task.updated_at = now()
  log action_log {action:"task-write", task_id, statuses}
  return task

// Hierarchy & sequencing:
function canStart(task):
  return parentCompleted(task.parent_id) && dependencyCompleted(task.depends_on)
```

## 4. Sequence Diagram

```mermaid
sequenceDiagram
    participant Orch as Orchestrator
    participant Store as tasks / claims / handoffs
    participant AgentA as Agent A
    participant AgentB as Agent B

    Orch->>Store: task-write CREATE phase+title+description (pending)
    Store-->>Orch: TASK-042 pending
    AgentA->>Store: claim-manage CLAIM TASK-042 agent=A
    Store-->>AgentA: claim acquired; task → in_progress
    AgentA->>Store: task-write comment "progress update"
    Note over AgentA,Store: work in progress
    alt work completes
        AgentA->>Store: task-write status=completed est_tokens comment
        Store->>Store: create task_archive memory
        Store->>Store: release claim + expire handoffs
        Store-->>AgentA: TASK-042 completed
    else needs handoff
        AgentA->>Store: handoff-write CREATE summary+context to_agent=B
        Store-->>AgentA: handoff pending
        AgentB->>Store: handoff-read pending
        Store-->>AgentB: handoff detail
        AgentB->>Store: handoff-write UPDATE accepted
        AgentB->>Store: claim-manage CLAIM TASK-042 agent=B
        Store-->>AgentB: claim acquired (re-claim after partial)
        AgentB->>Store: task-write status=completed est_tokens
        Store-->>AgentB: TASK-042 completed
    end
```

## 5. Data Model

```mermaid
erDiagram
    tasks ||--o{ task_comments : "audit trail"
    tasks ||--o| claims : "1:1 active claim"
    tasks ||--o{ handoffs : "coordination"
    tasks ||--o{ tasks : "parent_id hierarchy"
    tasks ||--o{ tasks : "depends_on sequencing"
    tasks {
        TEXT id PK
        TEXT task_code UNIQUE
        TEXT title
        TEXT description
        TEXT status
        TEXT phase
        INTEGER priority
        TEXT agent
        TEXT role
        TEXT doc_path
        TEXT scope_owner
        TEXT scope_repo
        TEXT tags
        TEXT metadata
        TEXT parent_id FK
        TEXT depends_on FK
        INTEGER est_tokens
        TEXT created_at
        TEXT updated_at
        TEXT in_progress_at
        TEXT finished_at
        TEXT canceled_at
    }
    task_comments {
        TEXT id PK
        TEXT task_id FK
        TEXT comment
        TEXT agent
        TEXT role
        TEXT model
        TEXT previous_status
        TEXT next_status
        TEXT created_at
    }
    claims {
        TEXT id PK
        TEXT task_id FK_UNIQUE
        TEXT agent
        TEXT role
        TEXT metadata
        TEXT claimed_at
        TEXT released_at
    }
    handoffs {
        TEXT id PK
        TEXT task_id FK
        TEXT from_agent
        TEXT to_agent
        TEXT summary
        TEXT context
        TEXT status
        TEXT expires_at
    }
```

Indexes: `idx_tasks_scope_status` on `(scope_owner, scope_repo, status)`; `idx_task_comments_task_id`; `idx_claims_task_id` unique; `idx_handoffs_scope_status`.

## 6. Public Interface

| Tool                 | Mode               | Key Params                                                                                       | Returns                                                 |
| :------------------- | :----------------- | :----------------------------------------------------------------------------------------------- | :------------------------------------------------------ |
| `task-write`         | CREATE             | `phase`+`title`+`description` (+ `code` optional, `priority`, `parent_id`, `depends_on`, `tags`) | Created `Task`                                          |
| `task-write`         | UPDATE             | `id`/`code` + fields to patch                                                                    | Updated `Task`                                          |
| `task-write`         | STATUS             | `id`/`code` + `status` + `comment` (+ `est_tokens` if `completed`)                               | Transitioned `Task` + comment row                       |
| `task-write`         | BULK               | `tasks[]` array (each infers create/update)                                                      | Per-item results                                        |
| `task-read`          | SEARCH             | `query`, `status` (csv or `all`), `phase`, `priority`, `limit`/`offset`                          | Ranked `Task[]` + `total`                               |
| `task-read`          | DETAIL             | `id`/`task_code` or `ids`/`task_codes`                                                           | Full `Task` with comments/children/`depended_by`        |
| `task-read`          | LIST               | `status`/`phase` filters + pagination                                                            | `Task[]` page                                           |
| `task-delete`        | DELETE             | `id`/`code` or `ids`/`codes`                                                                     | Soft-delete (`canceled`) + vector/claim/handoff cleanup |
| `claim-manage`       | CLAIM/RELEASE/LIST | `task_id`/`task_code` + `agent` / `release:true` / `query`                                       | Claim object or listing                                 |
| `handoff-read/write` | HO/CLAIM           | `id`, `query`, `status`, `from_agent`/`to_agent`                                                 | Handoff/claim objects                                   |

Commit convention on completion: `type(scope): [TASK-042] message` + `- [Title]` + `[Summary]`.

## 7. Dependencies

- **Write serialization:** `WriteLock` cooperative lock (`src/mcp/storage/`).
- **Scope isolation:** `owner`/`repo` on all tables; dashboard merges by short `repo` for display (ADR-008).
- **Archive memory:** `memories` table + embedding queue for `task_archive` generation.
- **FS:** task hierarchy requires parent existence; `depends_on` checked via `canStart` before `in_progress`.
- **Phase taxonomy:** free-form string (e.g., `Research`, `Implementation`, `Review`) — no enum constraint.

## 8. Limitations

| Limitation                        | Detail                                              | Mitigation                                                    |
| :-------------------------------- | :-------------------------------------------------- | :------------------------------------------------------------ |
| No parallel claims                | One active claim per `task_id` (unique constraint)  | `claim-manage LIST` to discover owner; coordinate via handoff |
| Terminal states immutable         | `completed`/`canceled` have no outgoing transitions | Reopen via new task with `depends_on` linkage                 |
| `est_tokens` required on complete | Missing value rejects `completed` transition        | Caller must meter tokens during execution                     |
| Dashboard repo merge              | Short `repo` merges owners in dashboard view        | Per-owner isolation via MCP `owner` param                     |
| No built-in priority queue        | `priority` is informational, not scheduling         | Orchestrator orders via `task-read` sorting                   |

## 9. Compliance

- **Gradual promotion:** enforced in `src/mcp/entities/task.ts` — checked before any status write.
- **Attribution:** `agent`/`role`/`model` required on every mutation; comment row captures transition.
- **Soft-delete:** `task-delete` sets `canceled`, not hard delete; vectors and claims cleaned.
- **Token transparency:** `est_tokens` validated on `completed`.
- **Standards gate:** implementation tasks must hydrate `standard-read` before coding.

## 10. UI Layout

Dashboard `Tasks` / `Agent Arena` tabs (`src/dashboard/ui/src/lib/components/Task*.svelte`):

- **Board view:** columns by `status` (`backlog` → `pending` → `in_progress` → `completed`/`canceled`/`blocked`); cards show `task_code`, `title`, `phase` chip, `priority` (1-5), `agent` avatar, `parent_id` indent.
- **Detail drawer:** `description` markdown, `task_comments` timeline (status badges + attribution), `claims` ownership, linked `handoffs`, `depends_on` graph, `est_tokens` meter.
- **Filters:** `status` multi-select, `phase` dropdown, free-text `query`, repo selector (short `repo` merged).
- **Actions:** claim/release, status transition with comment modal, handoff create, delete (soft).
- **States:** optimistic update on claim, conflict toast on double-claim, empty column placeholders.

## 11. Implementation Tasks

| #   | Task                                                                 | Scope                                                     |
| --- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | Task FSM + transition guard + comment audit                          | `src/mcp/entities/task.ts`, `src/mcp/tools/task.write.ts` |
| 2   | `claim-manage` exclusive claim + auto-release on completed/canceled  | `src/mcp/tools/claim*.ts`, `src/mcp/entities/claim.ts`    |
| 3   | `handoff-read/write` pending→accepted/rejected/expired + TTL sweeper | `src/mcp/tools/handoff*.ts`                               |
| 4   | `task_archive` memory generation on completion + queue enqueue       | `src/mcp/tools/task.write.ts`, `src/mcp/services/memory*` |
| 5   | `task-read` hybrid search + hierarchy/dependency expansion           | `src/mcp/tools/task.read.ts`                              |
| 6   | Dashboard board + arena + detail drawer                              | `src/dashboard/ui/src/lib/components/Task*.svelte`        |

## 12. Cross-References

- API contracts: `../../api/tasks/api-tasks.md` · `../api/tasks/api-task-read.md` · `../api/tasks/api-task-write.md` · `../api/handoffs/api-claim-manage.md` · `../api/handoffs/api-handoff-read.md` · `../api/handoffs/api-handoff-write.md`
- Module landings: `../handoffs/overview.md` · `../memory/overview.md` · `../standards/overview.md` · `../dashboard/overview.md`
- Testing: `../../testing.md` · `../../../testing/tasks/task-lifecycle.test.md` · `src/mcp/tests/task*.test.ts` · `src/mcp/tests/claim*.test.ts` · `src/mcp/tests/handoff*.test.ts`
- Design: `../../../design/domain/domain.md` (§2 Task, §3 Task Comment, §7 Handoff, §8 Claim) · `../../../design/database/schema.md` (§ `tasks`, `task_comments`, `claims`, `handoffs`)
- Decisions: `../../../design/decisions/ADR-008-global-vs-scoped-ownership-and-dashboard-repo-view.md`
- Manifest: `../manifest.md` · Tool contract: `../../../../src/mcp/prompts/server/instructions.md`

---

_Feature owner: `documentation` agent · Last verified: 2026-09-07 against `src/mcp/tools/task*.ts`, `src/mcp/tools/claim*.ts`, `src/mcp/tools/handoff*.ts`, and `src/mcp/entities/task.ts`._
