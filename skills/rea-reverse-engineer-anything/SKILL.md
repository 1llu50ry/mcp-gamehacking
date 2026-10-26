---
name: rea-reverse-engineer-anything
description: "REA (Reverse Engineer Anything) -- single MCP that dispatches across binaries, applications, and runtime behavior. Native + JavaScript/Electron + .NET + websites. Agent describes a feature from one app; REA inspects, explains, and helps build a version for the agent's project. Native backends: Hopper, Ghidra, IDA. Agents: Claude Code, Codex, Cursor, Gemini CLI, Grok Build."
metadata:
  type: tool-reference
  source: better-options/rea-main
  topics: [mcp, reverse-engineering, electron, dotnet, javascript, cross-tool, hopper, ida, ghidra]
---

# REA: Reverse Engineer Anything

One MCP for RE across binaries, applications, and runtime behavior. Connects an agent to tools for inspecting native binaries, JavaScript/Electron apps, .NET assemblies, and websites. Analysis runs locally; every conclusion carries its evidence and limitations.

## Setup

```bash
npx rea-agents setup
```

Chooses the agent (Claude Code / Codex / Cursor / Gemini CLI / Grok Build / others), installs REA's MCP server, writes matching workflow instructions, and backs up prior config.

Native analysis uses an existing Hopper, Ghidra, or IDA install; setup can optionally install Hopper. Static JavaScript analysis needs no native engine.

## Terminal Usage

Inspect an extracted JavaScript / Electron app directory or ASAR:

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

Install the `rea` CLI globally for repeated use:

```bash
npm install --global rea-agents
rea --help
rea update          # verified updater
```

## Why

- Cross-tool: one MCP, picks Hopper / Ghidra / IDA per task.
- JavaScript + Electron coverage out of the box -- rare among RE MCPs.
- Agent-facing by design: compact input-schema profile (`REA_MCP_INPUT_SCHEMA_PROFILE=full` for the verbose variant).
- Each tool answer carries evidence (which bytes, which function, which xref) so an agent can cite its reasoning.
- Local analysis only -- nothing leaves the host.

## Linux Prerequisite

Ghidra, JADX, firmware tool launches and static JS/Electron analysis need a procps-compatible `ps` on REA's `PATH` for process-ownership checks. See `docs/installation.md` "Linux owned-process prerequisite" for recovery steps.

## When to Use

- Mixed-stack targets: a Windows app with an Electron shell + native DLL + .NET service.
- You want one MCP configuration instead of three (one per analysis engine).
- You want the agent to inspect a reference app and emit a feature spec plus implementation for your project.

## Related

Pairs with [[ida-pro-mcp]], [[superghidra-mcp]], and [[vibe-reverse-engineering]] as backends; [[x64dbg-mcp-server]] for Windows dynamic. Preferred by the `reverse-engineer` agent for cross-tool work.
