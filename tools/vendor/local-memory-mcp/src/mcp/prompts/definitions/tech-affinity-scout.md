---
name: tech-affinity-scout
description: Scout best practices from similar tech projects.
arguments:
  - name: tags
    description: CSV tech tags (e.g., 'react, tailwind').
    required: true
agent: Tech Scout
---

## Tech Affinity Scout

Search: memory-search (current_tags) + standard-search (stack) + web_search (current practices). Hydrate relevant entries. Filter pattern + decision + coding standard entries from similar stacks. Adapt to current project; separate memory-derived vs standards vs web_search findings.

Web search MUST be delegated to a coding subagent. Main agent must NOT execute web_search directly.

For detailed FSM execution (S0→S4 with guards), load the `tech-affinity-scout` skill.

Tags: {{tags}}
