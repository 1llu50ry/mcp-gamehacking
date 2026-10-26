---
name: x64dbg-mcp-server
description: "x64dbg-MCP Server -- native MCP plugin for x64dbg exposing the debugger over HTTP. Agents set breakpoints, step, read memory, dump registers, patch bytes, trace, and more. SSE for push notifications on debug events; HTTP with `WaitForEvent` long-poll for polling clients. Every tool response ends with `[state]` and optional `[event:*]` lines so the agent always knows PAUSED / RUNNING / NO_TARGET."
metadata:
  type: tool-reference
  source: better-options/x64dbg-mcp-server-main
  topics: [mcp, x64dbg, debugger, dynamic-analysis, red-team, agents, breakpoints]
---

# x64dbg-MCP Server

Native x64dbg plugin that exposes the debugger over HTTP via MCP. Any MCP-capable AI assistant can drive x64dbg programmatically.

## State Discipline (Rules From the Shipping SKILL.md)

### Rule 1: Always Know Your State

Call `GetDebugState` before every action.

- `NO_TARGET` -- nothing loaded. Use `LoadBinary` or `AttachProcess`.
- `PAUSED` -- stopped. Can read memory, disasm, inspect regs.
- `RUNNING` -- executing. CANNOT read memory, disasm, or inspect. `WaitForPause` or `PauseDebug` first.

Every tool response ends with a `[state]` line (PAUSED with address/module/instruction, RUNNING, or NO_TARGET) and may carry `[event:*]` queued events (breakpoint hit, exception, DLL load) that fired since the last call. Read both.

If the user says "paused", "hit breakpoint", "stopped" -- call `GetDebugState` immediately. No guessing.

### Rule 2: Never Assume State Between Calls

MCP is request/response. Anything can happen between calls -- user interaction, breakpoint hit, exception. Verify first.

Bad: `SetBreakpoint -> run -> Disassemble`.
Good: `GetDebugState -> SetBreakpoint -> run -> GetDebugState -> Disassemble`.

### Rule 3: Core Workflows

**Load and analyze**: `GetDebugState -> LoadBinary(path) -> wait + check state -> BasicInfo -> ListExports -> ListImports`.

**Trace a function**: `SetBreakpoint(func) -> run -> WaitForPause -> ReadRegs -> StepOver / StepInto / StepOut`.

**Dump memory**: `GetDebugState (verify PAUSED) -> ReadMemory(va, size)`.

**Patch bytes**: `GetDebugState -> PatchMemory(va, bytes) -> verify via ReadMemory`.

## Transport

- **SSE** -- push notifications for debugger events in real time.
- **HTTP** -- poll with `WaitForEvent` or read `[state]` / `[event:*]` lines on every response.

## Why

- Interactive debugging workflows -- not possible with static-only MCPs ([[ida-pro-mcp]], [[superghidra-mcp]]).
- x64dbg's scripting + plugin ecosystem (Scylla, Snowman, SharpOD-X) available alongside.
- Red-team-friendly: packer unpacking, dump recovery, OEP finding.
- Fits game-hacking workflow: break on a Present hook, inspect state, patch returned pointer.

## When to Use

- Unpack / dump a protected binary (Themida / VMP / Enigma).
- Trace Riot Vanguard / BattlEye / EAC usermode hooks live.
- Find OEP, dump, rebuild IAT.
- Inspect a running game process without a kernel driver.

## Related

Pairs with [[ida-pro-mcp]] / [[superghidra-mcp]] (take the dumped binary into static analysis) and [[rea-reverse-engineer-anything]] (cross-tool). Preferred by the `reverse-engineer`, `malware-analyst`, and `obfuscation-analyst` agents.
