---
name: angr-mcp
description: "angr MCP -- symbolic execution bridge over angr. Agent-callable path exploration, constraint solving, VEX IR analysis. For custom-cipher recovery, control-flow deobfuscation, exploit primitive discovery."
metadata:
  type: tool-reference
  source: external/angr
  topics: [angr, mcp, symbolic-execution, deobfuscation, static, z3]
---

# angr MCP

MCP bridge for [angr](https://angr.io/). Exposes symbolic execution, VEX IR lifting, path exploration, and Z3-backed constraint solving.

## Core Tools (through this project)

- `launch_re_backend id=angr-mcp`
- `re_http_call id=angr-mcp path=/tool/explore`

## When to Use

- Custom cipher recovery (symbolic diff of encrypt vs decrypt).
- Deobfuscation of OLLVM / VMProtect / Themida handlers.
- Finding input that reaches a target basic block (CTF-style, used for proof-of-concept exploit).

## Related

Pairs with the crypto plugins (`custom-cipher-analyzer`, `control-flow-deobfuscator`) and the `obfuscation-analyst` agent.
