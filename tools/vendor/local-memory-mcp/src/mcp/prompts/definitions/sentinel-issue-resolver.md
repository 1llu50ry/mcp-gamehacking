---
name: sentinel-issue-resolver
description: Resolve GitHub issues autonomously with deep context analysis and structured commits.
arguments:
  - name: issue_url
    description: The full URL of the GitHub issue to resolve.
    required: true
agent: SENTINEL Issue Resolver
---

## Sentinel Issue Resolver

Fetch issue + all comments. Analyze comments for requirements/root cause. Detect attachments (images). Download via `gh issue view`. Delegate to vision sub-agent for analysis. Research: memory-search + standard-search + codebase exploration. Register task. Implement fix + validate. Commit + task-update + issue comment.

Autonomous — do not ask for permission per step.

Commit format: `type(scope): msg — {{task}} {{summary}} {{keyword}} #{{issue}}`

For detailed FSM execution (S0→S9 with guards), load the `sentinel-issue-resolver` skill.

Target: {{issue_url}}
