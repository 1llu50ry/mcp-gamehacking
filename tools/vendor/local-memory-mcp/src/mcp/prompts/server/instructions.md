---
name: server-instructions
description: Main instructions for the MCP server
---

Local Memory MCP — persistent memory, task coordination, and coding standards for AI agents.

## Contract Ownership

This file is the CANONICAL tool contract for `local-memory-mcp` — the SINGLE SOURCE OF TRUTH for data scoping, registered tool names, required/optional fields and auto-infer semantics, the who/when matrix, and micro-flows.

## Data Scoping

All data (memories, tasks, handoffs, claims) is scoped by **owner/repo**:

- **owner** = organization/namespace (e.g., GitHub org, username)
- **repo** = project/repository name

Pass both `owner` and `repo` whenever a tool requires them. The `owner/repo` pair forms the unique data boundary.

### Owner Rule (CRITICAL)

The `owner` field MUST be the GitHub username or organization that OWNS the repository. For example:

- Repo `vheins/local-memory-mcp` → owner=`vheins`
- Repo `my-org/my-project` → owner=`my-org`

NEVER use the agent's name (e.g., the calling agent's own identifier) as the owner.
NEVER guess the owner from the working directory path.

If unsure, run `git remote -v` in the project directory — the remote URL (e.g., `git@github.com:vheins/local-memory-mcp.git`) gives you both `owner` and `repo`.

**Two ways to provide owner/repo:**

1. **Explicit** (preferred — most reliable):

   ```json
   { "owner": "vheins", "repo": "local-memory-mcp" }
   ```

2. **Shorthand** — use `owner/repo` format for `repo`; the server auto-extracts `owner`:

   ```json
   { "repo": "vheins/local-memory-mcp" }
   ```

**Session-wide defaults (can be omitted):** `owner`, `repo`, `agent`, and `model` are auto-populated from the session context and environment when not explicitly provided:

| Field   | Fallback chain                                                                                     |
| :------ | :------------------------------------------------------------------------------------------------- |
| `owner` | tool arg → `owner` segment of `owner/repo` → session context (git remote / MCP roots) → CWD remote |
| `repo`  | tool arg → session context (MCP root basename) → CWD basename                                      |
| `agent` | tool arg → session context (last-seen agent, client name, `MCP_CLIENT_NAME` env)                   |
| `model` | tool arg → session context (last-seen model, `MCP_MODEL` env)                                       |

Setting these explicitly in the tool call always takes priority over session defaults.

Path-basename values are NEVER used as `owner`: a structural path segment such as `home` (from `/home/<user>`) or a dotfile directory (`.config`) is rejected rather than fabricated as an owner, so a scope-less call can never silently mis-file data under a wrong-scope owner. When the scope is genuinely undeterminable for an HTTP/daemon write, the call fails loud instead.

Violation: tasks created with a wrong owner will be invisible to other agents querying with the correct owner.

## Core Workflows

**Memory**: `memory-read` (search/detail/recap) → `memory-write` (create/update/acknowledge/bulk) → `memory-delete`

- Auto-infer: `content` → create; `id`/`code` → update or acknowledge; `memories[]` → bulk
- Durable only (arch, patterns, decisions, fixes)
- `memory-write` with `acknowledge` after code gen from memory
- Global scope = cross-repo only; prefer repo-specific
- `memory-write` with `type=decision` = shortcut for decision memories (auto-sets type=decision, importance=4, agent=current, model=current, scope=current)
- `repo-summarize` = archive session signals as task_archive summary (type=task_archive, importance=3)
- `agent-context` = recall memories + tasks for the current agent
- `synthesize` = composite contextual synthesis via MCP sampling (requires client sampling support)

### memory-write required fields (create)

Every create `memory-write` call MUST include these fields:

| Field        | Type                                                                | Description                                   |
| :----------- | :------------------------------------------------------------------ | :-------------------------------------------- |
| `type`       | enum: `code_fact`, `decision`, `mistake`, `pattern`, `task_archive` | Memory category                               |
| `title`      | string (3-255 chars)                                                | Concise title, no metadata                    |
| `content`    | string (min 10 chars)                                               | Body of the memory                            |
| `importance` | number (1-5)                                                        | 1=low, 5=critical                             |
| `scope`      | object `{ owner, repo }`                                            | `owner`=GitHub org/username, `repo`=repo name |

`agent` and `model` are optional — auto-populated from session context when omitted:

```json
{
	"type": "code_fact",
	"title": "Auth uses JWT",
	"content": "Authentication system uses JWT tokens with 1h expiry.",
	"importance": 3,
	"scope": { "owner": "vheins", "repo": "local-memory-mcp" }
}
```

### memory-write update fields

A `memory-write` update accepts the same fields as create but all are optional (only provide the fields to change). Either `id` (UUID) or `code` (string) is required to identify the target memory.

**Tasks**: `task-read` (list/search/detail) → `claim-manage` (claim → in_progress) → `task-write` (update / status=completed); cleanup via `task-delete`

- Register via `task-write` before execution
- NEVER skip in_progress
- Commit: `type(scope): [task-code] message` + `- [Title]` + `[Summary]`
- Complete auto-releases claims + expires linked handoffs

**Standards**: `standard-read` → `standard-write`; cleanup via `standard-delete`

- MANDATORY pre-implementation gate
- 1 rule/entry, normative contract

**Handoffs/Claims**: `handoff-read` → `handoff-write` | `claim-manage`

- Create ONLY for unfinished work (concrete next owner/steps)
- NO handoff for completion summaries → use task comments (`task-write` with `comment`)

**Codebase Index**: `codebase-index` → `codebase-read` — **MANDATORY FIRST for ALL codebase exploration (STRICT)**

- `codebase-index(repo)` = status (freshness + count); `codebase-index(repoPath + repo)` = index (tree-sitter scan).
- Always check status first. If stale, trigger index before querying.
- **`repoPath` MUST be the repo ROOT** — the exact same absolute path passed to `codebase-index`, never a subdirectory (e.g. `modules/PurchaseDistributor/Lang`). Indexed `file_path`s are relative to the root, so a subdirectory path makes every file miss (`REPO_PATH_NOT_ROOT` / `REPO_FILES_MISSING`).
- `codebase-read`: `query` → search, `name` → symbol trace, `filePath` → file symbols, `content` → grep indexed file contents, none → architecture. `depth` only applies inside architecture mode.
- **STRICT PRIORITY**: ALL agents (orchestrator + sub-agents) MUST start every codebase context search with `codebase-index`/`codebase-read` — symbols, files, architecture, trace, and content grep.
- **FORBIDDEN as first resort**: `rg` / `grep` / `glob` / `seed` / `cat` / `bash cat` / `find` / `ls` / brute-force filesystem search — NEVER use before `codebase-read`. Allowed ONLY as fallback after index returns empty/stale or cannot answer, and ONLY via `explore` sub-agent (which itself tries index first before `glob`/`grep`/`cat`). Direct `rg`/`grep`/`cat` without prior `codebase-read` is a violation. `cat` is for reading a **known** file only — never for blind exploration.

**Prompts (skill-like reads)**: `prompt-read` — read-only alias for the protocol-level `prompts/*` surface (`prompts/list` + `prompts/get`); it mirrors the same catalog and content, so tool-only clients (e.g. OpenCode) can discover and invoke prompts as tools.

- Auto-infer: `name` present → DETAIL (loads the prompt with `{{var}}` substitution; `{{current_repo}}`/`{{current_owner}}` are reserved keys always auto-injected from session, never read from args); none → LIST (catalog of `{name, description, agent, arguments}`).
- Detail on unknown/traversal names → NOT_FOUND-classified error envelope (`schema: "tool-error"`, `code: "NOT_FOUND"`).
- WHEN to call it: before starting a workflow/task, when a task references a skill/prompt by name (e.g. `create-task`, `task-management`, `code-review`, `session-planner`), or whenever you need a checklist/template before acting.

**Exploration Observations**: `observation-write` → `observation-read`

- `observation-write`: create / update / bulk / refresh high-signal exploration observations with source fingerprints. Auto-infer: `subject`+`fact`+`confidence`+`evidence[]` → create; `id` + fields → update; `observations[]` (1–100) → bulk create; `refresh_ids[]` (1–100) → refresh fingerprints. Repeated normalized facts + evidence are idempotent (deduplicated). Evidence items require `file_path` and optionally `symbol_id`, `start_line`/`end_line`, `commit_sha`.
- `observation-read`: list / detail evidence-backed observations by `owner`/`repo` scope with filters `subject`, `task_id`, `file_path`, `symbol_id`, `min_confidence` (0–1). Detail via `id` (UUID). Stale and unverifiable findings are excluded by default (`include_stale:false`); set `include_stale:true` to include them. `hydrate_evidence:false` by default (set true to inline evidence). Paginated via `limit` (1–100, default 20) + `offset`.

**Agent Context (budgeted)**: `agent-context`

- Compiles deterministic, token-budgeted context from 7 sources: `memories`, `decisions`, `tasks`, `handoffs`, `standards`, `observations`, `code`.
- Key params: `objective` (or legacy `query`) ranks candidates from every source; `task_code` pins a task as critical; `current_file_path` retrieves compact code pointers; `sources[]` selects the source set (default all 7); `type_filter` filters memory type.
- Budget: `budget.tokens` (256–20_000, default 2_000) + `budget.max_items` (1–100, default 20) + `budget.code_depth` (0–5, default 1, graph expansion from `current_file_path`). Candidates are ranked by priority + lexical overlap with `objective`, packed until either budget is hit; overflow is reported in `exclusions` with reason `token_budget` or `item_budget`.
- `include_stale:false` by default (fresh observations only); `limit` (1–100, default 5) caps legacy memory/task projections. `context_pack_id` / `session_id` enable cache-hit correlation (opaque, never prompt text).

### Persisting reusable rules with standard-write

`standard-write` is durable with 1 rule per entry. It writes to `coding_standards` for normative, enforceable conventions.

- WHEN to call it: after discovering a reusable normative rule/convention (naming, layering, a11y, testing) that should outlive the session; when the `standard-read` pre-implementation gate surfaced a missing standard; or when explicitly asked to codify a convention. Set `is_global` and `repo` for global vs repo-scoped entries (see Data Scoping).
- Priority framework — `standard-write` vs `memory-write` (classify every finding before persisting):
  - **P1 — Normative & enforceable for future work → `standard-write`**: check `standard-read` first to avoid duplicates; set `is_global`/`repo` per Data Scoping.
  - **P2 — Episodic / contextual → `memory-write`**: why/history, code facts, decision rationale, or task-specific patterns. Mandatory after every task — choose correct `type` + `importance`.
  - **P3 — Both aspects → write BOTH**: the enforceable rule (`standard-write`) plus the context/rationale/history (`memory-write`). Do not collapse into one entry.

## Who / When

| Operation                         | When                                                                                                                           | Who                                                          |
| :-------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------- |
| `memory-read(query)`              | Start of task, during work — find past decisions, patterns, code facts                                                         | All agents (orchestrator + sub-agents)                       |
| `memory-write`                    | After completing work — persist decisions, patterns, code facts                                                                | All agents (orchestrator + sub-agents)                       |
| `memory-read(id/code)`            | When task prompt includes a memory code — retrieve full context                                                                | Sub-agents only                                              |
| `memory-write` (acknowledge)      | After consuming a memory — mark it as used/reviewed                                                                            | Sub-agents only                                              |
| `memory-read` (recap)             | At macro-workflow start — summary of recent memory activity                                                                    | Orchestrator                                                 |
| `memory-write` (`type=decision`)  | Log a structured architectural decision (importance=4)                                                                         | All agents                                                   |
| `task-read`                       | Sync — list/search/detail of pending, backlog, in_progress                                                                     | Orchestrator + sub-agents                                    |
| `claim-manage`                    | Claim task start (`task_code` + `agent`) → `in_progress`                                                                       | Agent executing the task                                     |
| `task-write(status=completed)`    | Mark task done — auto-releases claim, expires linked handoffs                                                                  | Agent executing the task                                     |
| `handoff-read`                    | Check incoming handoffs at workflow start; search/list pending                                                                 | Orchestrator                                                 |
| `handoff-write`                   | Create handoff ONLY for unfinished work (concrete next owner + steps)                                                          | Agent leaving work behind                                    |
| `standard-read(query)`            | Hydrate — load applicable coding standards before implementation                                                               | All agents                                                   |
| `standard-write`                  | After discovering a durable reusable pattern/convention worth persisting (check `standard-read` first)                         | Any agent that produced code/docs and found a normative rule |
| `standard-delete`                 | Delete coding standards (single/bulk, UUID or code)                                                                            | All agents                                                   |
| `memory-delete`                   | Soft-delete memories (single/bulk, UUID or code)                                                                               | All agents                                                   |
| `task-delete`                     | Soft-delete tasks → canceled, release claims, expire handoffs                                                                  | All agents                                                   |
| `repo-summarize`                  | Archive session signals as task_archive summary                                                                                | All agents                                                   |
| `synthesize`                      | Composite synthesis via sampling (requires client sampling)                                                                    | All agents                                                   |
| `agent-context`                   | Compile token-budgeted cross-source context for an objective                                                                   | All agents                                                   |
| `observation-write`               | Create/update/bulk/refresh exploration observations with fingerprints                                                          | All agents                                                   |
| `observation-read`                | Read observations by scope, subject, task, file, symbol, confidence                                                            | All agents                                                   |
| `codebase-index`                  | Check index freshness/status before querying; refresh a stale index; `warmup:true` initializes the engine                      | All agents                                                   |
| `codebase-read`                   | Primary codebase exploration (symbol/NL search, trace, file symbols, architecture, content grep)                               | All agents                                                   |
| `prompt-read(name?)`              | Before executing a skill/workflow — load its definition/template (LIST catalog when no name, DETAIL with {{var}} substitution) | Orchestrator + sub-agents needing guided execution           |

## Rules

- Do NOT invent method names — call ONLY the tools this server exposes in the MCP tool catalog. No legacy dotted aliases exist; the server only normalizes `'.'` → `'-'` in a name.
- `memory-write` is **mandatory** after every task (min 1 entry).
- Sub-agents **MUST** call `memory-read(query)` during work and `memory-write` (acknowledge) after consuming a memory.
- Orchestrator calls `memory-read` (recap) at macro-workflow start.
- **Codebase exploration (STRICT)**: `codebase-index` + `codebase-read` are the MANDATORY first tools for any codebase context discovery — see §Core Workflows → Codebase Index for the full rule and fallback chain.
