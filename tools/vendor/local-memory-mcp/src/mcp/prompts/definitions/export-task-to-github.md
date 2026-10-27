---
name: export-task-to-github
description: Export local tasks to GitHub Issues
arguments:
  - name: owner
    description: "GitHub repo owner (hint: run `git remote -v` to extract from origin URL)"
    required: true
  - name: repo
    description: "GitHub repo name (hint: run `git remote -v` to extract from origin URL)"
    required: true
  - name: task_id
    description: Local task ID
    required: true
agent: Integration Architect
---

## Export Task to GitHub

Fetch task via task-detail. Sync check via search_issues for task_code — if exists, update metadata with URL; skip re-creation. Create issue via issue_write (match content). Post comments. Link task-update with GitHub URL. Verify issue exists.

MCP + GitHub tools ONLY.

For detailed FSM execution (S0→S5 with guards), load the `doc-sync` skill → `rules/export`.
