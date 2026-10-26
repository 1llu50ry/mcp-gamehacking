---
name: yara-matcher
description: Run YARA rules against a target binary or memory dump. Returns matches with offsets and rule metadata.
type: subagent
---

# Subagent: yara-matcher

Agent-callable YARA scanning (via the `[[yara-mcp]]` backend or in-process).

## Input

- target: file path or dump path
- rules: list of rule file paths (or inline YARA source)

## Output

- rule_name, matches[{offset, strings}], rule_meta

## Related

[[yara-mcp]], the `malware-analyst` agent, the `detection/yara-generator` plugin.

<!-- enriched:v2 -->
