---
name: capstone-mcp
description: "Capstone MCP -- lightweight disassembler bridge for shellcode / small snippets. Agent-callable disassembly across x86 / x86_64 / ARM / AArch64 / MIPS / PPC / SPARC / RISC-V / BPF."
metadata:
  type: tool-reference
  source: external/capstone
  topics: [capstone, mcp, disassembler, shellcode, static]
---

# Capstone MCP

MCP bridge for [Capstone](https://www.capstone-engine.org/). No full project / BNDB / IDB needed -- give it a byte sequence and an architecture.

## Core Tools (through this project)

- `launch_re_backend id=capstone-mcp`
- `re_http_call id=capstone-mcp path=/tool/disasm`

## When to Use

- Disassemble a shellcode blob without loading IDA / Ghidra.
- Lift a captured network payload containing code.
- Quick triage of a crash dump address.

## Related

Pairs with `shellcode-reference`, `shellcode-encoder` subagent, and the `exploit-developer` agent.
