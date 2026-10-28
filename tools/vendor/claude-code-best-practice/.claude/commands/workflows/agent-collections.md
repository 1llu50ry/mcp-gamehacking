---
description: Update the AGENT COLLECTIONS table by researching all agent-collection repos in parallel
---

# Workflow — Agent Collections

Update the AGENT COLLECTIONS table in `README.md` by researching the listed repos in parallel. Launch a research agent, merge results, present changes, update table if approved.

---

## The Repos

| # | Repo | Owner |
|---|------|-------|
| 1 | `msitarzewski/agency-agents` | msitarzewski |
| 2 | `VoltAgent/awesome-claude-code-subagents` | VoltAgent (curated awesome-list) |

> When new agent-collection repos are discovered, add them here AND to the research prompt in Phase 1.

---

## Table Format

The README table has these columns:

```markdown
| Name | ★ | <img src="!/tags/a.svg" height="14"> |
```

- **Name**: `[Short Name](github-url)` — use the repo's recognizable short name (e.g., `msitarzewski/agency-agents`, `awesome-claude-code-subagents`). Use full `owner/repo` only if the bare name is ambiguous.
- **★**: Star count rounded to `k` (e.g., 92k, 19k, 1.2k). Under 1000 show exact number.
- **Agent count**: Just the number. For awesome-lists where agents are *links* not files, use `N+ (curated list)` form.

**Sort order**: Sorted by stars descending (highest first).

---

## Phase 0: Read Current State

Read these files:

1. `README.md` — the `## 🤖 AGENT COLLECTIONS` table (note current stars and agent counts)
2. `changelog/agent-collections/changelog.md` — previous changelog entries (may not exist yet — create it on first run)

---

## Phase 1: Launch Research Agent

**Immediately** spawn one `development-workflows-research-agent` covering all repos. (The existing research agent is generic — it counts agents/skills/commands/stars for any repo.)

> Research these Claude Code **agent-collection** repositories. Each is primarily a library of subagent definition files (`.md` files defining agents), NOT a full workflow methodology.
>
> **Repo 1: msitarzewski/agency-agents** (https://github.com/msitarzewski/agency-agents) — agency-style subagent collection
> **Repo 2: VoltAgent/awesome-claude-code-subagents** (https://github.com/VoltAgent/awesome-claude-code-subagents) — curated awesome-list (links to external subagents, not all agents are stored as files in the repo)
>
> For EACH repo, return:
>
> 1. **Stars** — use GitHub API `https://api.github.com/repos/{owner}/{repo}`, read `stargazers_count`. Round to `k`.
> 2. **Agent count** — count subagent definition `.md` files via the GitHub git tree API:
>    `https://api.github.com/repos/{owner}/{repo}/git/trees/HEAD?recursive=1` and grep paths under conventional agent directories.
>    - For `msitarzewski/agency-agents`: agents typically live under `agents/`, `.claude/agents/`, or category subdirectories. Count `.md` files that look like subagent definitions (frontmatter with `name:` and `description:`). Exclude README/CHANGELOG/LICENSE/docs.
>    - For `VoltAgent/awesome-claude-code-subagents`: count the *listed* agents in README.md (e.g., bullets / table rows linking to external repos). Mark explicitly as "curated list, not files in repo".
>    - If a repo has both a curated index AND its own agent files, report both numbers and explain.
> 3. **Notable changes** — any significant additions or removals in the last 30 days?
>
> Return structured report per repo:
> ```
> REPO: msitarzewski/agency-agents
> STARS: <number>k (<exact>)
> AGENTS: <count> (<file pattern used, e.g., ".md files under agents/ via git tree">)
> NOTES: <anything unusual — flat layout vs categorized, README-only catalog, deprecated agents, curated-list disclaimer>
> CHANGES: <changes or "No significant changes">
> CONFIDENCE: <0-1>
> ```

---

## Phase 2: Compare & Report

**Wait for the agent.** Then compare findings against the current table and present:

```
Agent Collections — Update Report
══════════════════════════════════

Changes Found:
  <repo>: ★ <old>k → <new>k | agents <old>→<new>
  ...

No Changes:
  <repo>: ✓ (all values match)
  ...

Action Items:
#  | Type   | Action                              | Status
1  | Star   | Update <repo> ★ from Xk to Yk       | NEW/RECURRING
2  | Count  | Update <repo> agents from X to Y    | NEW/RECURRING
3  | Sort   | Move <repo> (rank changed)          | NEW/RECURRING
4  | Add    | New collection candidate: <repo>     | NEW
```

Compare with previous changelog entries and mark items as `NEW`, `RECURRING`, or `RESOLVED`.

---

## Phase 2.5: Append to Changelog

**MANDATORY** — always execute before presenting to user.

Read `changelog/agent-collections/changelog.md`, then **append** a new entry. If the file doesn't exist, create it with a Status Legend then the first entry.

```markdown
---

## [<YYYY-MM-DD HH:MM AM/PM PKT>] Agent Collections Update

| # | Priority | Type | Action | Status |
|---|----------|------|--------|--------|
| 1 | HIGH/MED/LOW | <type> | <action> | <status> |
```

Get time via `TZ=Asia/Karachi date "+%Y-%m-%d %I:%M %p PKT"`. Status must be one of:
- `COMPLETE (reason)` | `INVALID (reason)` | `ON HOLD (reason)`

Always append, never overwrite.

---

## Phase 2.6: Update Last Updated Badge

**MANDATORY** — execute after Phase 2.5.

Update the badge on line 4 of `README.md`. Get time via `TZ=Asia/Karachi date "+%b %d, %Y %-I:%M %p PKT"`, URL-encode it, replace the date in the badge. Do NOT log this as an action item.

---

## Phase 3: Execute

Ask user: **(1) Execute all** | **(2) Execute specific** | **(3) Skip**

When executing, edit the `## 🤖 AGENT COLLECTIONS` table in `README.md`:
- Update stars and agent counts per row
- Maintain sort order: stars descending (highest first)
- Match existing format exactly (link style, k-suffix on stars)

---

## Rules

1. **One research agent, all repos** — single message, parallel sub-fetches inside
2. **Never guess** — use data from the agent only
3. **Don't auto-execute** — present report first, wait for approval
4. **ALWAYS append changelog** and **ALWAYS update badge** — mandatory
5. **Sort by stars descending** — highest stars first
6. **Round stars consistently** — `k` suffix (92k, 19k, 1.2k). Under 1000 show exact
7. **Awesome-lists are different** — for repos that link to external agents (VoltAgent), the count is "items listed in README", not files in repo; always annotate `(curated list)`
8. **Compare with previous changelog** — mark items NEW, RECURRING, or RESOLVED
9. **Reuse `development-workflows-research-agent`** — do NOT create a new agent
