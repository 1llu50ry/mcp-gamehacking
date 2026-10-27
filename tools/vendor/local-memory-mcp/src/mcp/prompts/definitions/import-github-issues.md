---
name: import-github-issues
description: Import GitHub Issues as local tasks.
arguments: []
agent: Integration Scout
---

## Import GitHub Issues

Fetch open issues (primary: github-mcp-server; fallback: `gh issue list --json`). Dedup via task-list (skip if GH-{number} exists). Create MCP tasks: task_code=GH-{number}, EXACT title/body, tags=labels, phase=backlog|triage, metadata=URL. Import comments. Report created count.

For detailed FSM execution (S0→S5 with guards), load the `import-github-issues` skill.
