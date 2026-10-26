---
name: jadx-mcp
description: "JADX MCP -- bridge over JADX for Android DEX/APK decompilation. Agent-callable class/method listing, decompile, xref, string search."
metadata:
  type: tool-reference
  source: external/jadx
  topics: [jadx, mcp, android, dex, apk, java, static]
---

# JADX MCP

MCP bridge for [JADX](https://github.com/skylot/jadx). Lets an agent decompile APKs to Java sources, enumerate classes/methods, resolve xrefs, and search strings.

## Core Tools (through this project)

- `launch_re_backend id=jadx-mcp`
- `re_http_call id=jadx-mcp path=/tool/decompile`

## When to Use

- Android APK triage before dropping to Frida.
- IL2CPP native blob only -- JADX still gives you the Java shell surrounding it.
- Resource inspection (AndroidManifest, strings, layout XMLs).

## Related

Pairs with [[frida-mcp]] for dynamic hooking and the `android-researcher` agent + `apk-reverse` skill.
