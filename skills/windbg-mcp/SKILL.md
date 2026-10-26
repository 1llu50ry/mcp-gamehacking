---
name: windbg-mcp
description: "WinDbg MCP -- bridge over dbgeng.dll for kernel-mode debugging, crash-dump postmortem, usermode live debug. Agent-callable !process, !handle, !analyze, dt, lm, k. Pair with Microsoft public symbol server."
metadata:
  type: tool-reference
  source: external/windbg
  topics: [windbg, mcp, kernel-debug, crash-dump, dynamic, dbgeng]
---

# WinDbg MCP

MCP bridge over `dbgeng.dll` (Microsoft Debugger Engine). Lets an agent run WinDbg commands over MCP for kernel debugging, usermode debugging, and crash-dump analysis.

## Operating Model

- Backend: `windbg-mcp` (community) or the Microsoft dbgeng Python bridge.
- Attaches to a target (process, kernel over com/USB/net, dump file).
- Agent calls MCP tools wrapping `.cmd`, `g`, `k`, `dt`, `lm`, `!process`, `!handle`, `!analyze`, `~`, `bp`, extensions (`!wdfkd`, `!swishdbg`).

## Core Tools (through this project)

- `launch_re_backend id=windbg-mcp`
- `re_http_call id=windbg-mcp path=/cmd` with `{ "cmd": "!process 0 7" }`

## When to Use

- Kernel debugging of anti-cheat drivers (BEDaisy.sys, EasyAC.sys, vgk.sys) over the Microsoft kd protocol.
- Crash-dump analysis after a BYOVD or driver patch gone wrong.
- Public-symbol-server driven analysis of ntoskrnl structures.

## Related

Preferred by `windows-internals-agent`, `driver-developer`, `ac-driver-analyzer` subagent. Pairs with [[x64dbg-mcp-server]] for usermode-only Windows targets.
