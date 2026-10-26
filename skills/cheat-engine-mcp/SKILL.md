---
name: cheat-engine-mcp
description: "Cheat Engine MCP -- Lua bridge that exposes CE's AoB scan, pointer scan, assembler, memory R/W, Lua eval, process attach, and speedhack through MCP tools. Backed by Cheat Engine 7.5+ with the ceserver-lua plugin."
metadata:
  type: tool-reference
  source: external/cheat-engine
  topics: [cheat-engine, mcp, dynamic, aob, pointer-scan, lua, memory-rw]
---

# Cheat Engine MCP

Lua-based MCP bridge for Cheat Engine. Lets an agent drive AoB scans, pointer scans, the assembler, Lua auto-attach scripts, and speedhack. Backend process is `ceserver --mcp` listening on `127.0.0.1:52736` by default.

## Operating Model

- CE handles the process attach, VirtualQueryEx / ReadProcessMemory / WriteProcessMemory, pattern scanning, and pointer walk.
- The MCP bridge exposes those as tools callable from any MCP client.
- Scripts (CE's own Lua) can be evaluated via `lua_eval` for anything the pre-canned tools don't cover.

## Core Tools (through this project)

- `launch_re_backend id=cheat-engine-mcp` -- spawn `ceserver --mcp`.
- `cheat_engine_aob pattern=... process=...` -- AoB scan.
- `re_http_call id=cheat-engine-mcp path=/tool/<name>` -- any ceserver tool.

## When to Use

- Pattern-driven offset discovery in a running game (preferred for mobile emulators and Linux-ported Windows games via Wine).
- Pointer chain discovery to a known value (health, ammo, position).
- Writing CE auto-attach `.CT` tables that other players can use.
- Fast speedhack / value modification during live gameplay for research.

## Related

Pairs with [[frida-mcp]] for cross-platform scripting, [[x64dbg-mcp-server]] for Windows-only interactive debugging, [[ida-pro-mcp]] / [[superghidra-mcp]] for static context. Preferred by the `cheat-developer`, `offset-finder` subagents.
