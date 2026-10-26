---
name: frida-mcp
description: "Frida MCP -- bridge for dynamic instrumentation. Agent-callable Interceptor.attach / Memory.scan / Objective-C and Java bridges across Windows, Linux, macOS, Android, iOS. Attach by name/pid/USB. Backs scripts that would normally run via `frida -l` or `frida-trace`."
metadata:
  type: tool-reference
  source: external/frida
  topics: [frida, mcp, dynamic, instrumentation, android, ios, javascript]
---

# Frida MCP

MCP bridge over `frida-tools`. Lets an agent run Frida JavaScript snippets inside a target process without typing `frida -U -n app` by hand.

## Operating Model

- Backend process: `frida-mcp` listening on stdio.
- Target: any process `frida-ps` can see (local, remote via `-H`, USB via `-U`).
- Scripts run inside the target with the full Frida API (`Interceptor`, `Memory`, `Module`, `ObjC`, `Java`, `Process`, `Thread`).

## Core Tools (through this project)

- `launch_re_backend id=frida-mcp`
- `frida_eval target=com.example.app script="Interceptor.attach(..., { onEnter(args) { send(args[0]) } })"`
- `re_http_call` for custom bridge endpoints when exposed.

## When to Use

- Android / iOS game inspection (unmatched by native-only tools).
- Hook a function in a running process without rebuilding.
- Dump IL2CPP + Mono metadata live via a Unity Frida script.
- Objective-C method swizzling for macOS/iOS.

## Related

Pairs with [[cheat-engine-mcp]] for value scanning, [[rea-reverse-engineer-anything]] for cross-stack orchestration, [[x64dbg-mcp-server]] for deeper Windows debugging. Preferred by the `android-researcher`, `cheat-developer`, and the per-platform iOS specialist agents.
