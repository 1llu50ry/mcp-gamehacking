# tools/

Local tool scaffolding for the mcp-reverse server's RE/debug integrations.

## Layout

```
tools/
├── README.md                this file
├── launchers/               shell/powershell launch scripts (optional)
└── vendor/                  vendored upstream RE tool trees
    ├── vibe-re/             Vibe-Reverse-Engineering (retools, livetools, tools, ...)
    └── ida-pro-mcp/         ida-pro-mcp (mrexodia) companion
```

## MCP tools that use this tree

Registered by `src/retools.ts`:

- `list_re_backends`, `describe_re_backend`, `pick_re_backend`, `re_mcp_config`
- `launch_re_backend`, `stop_re_backend`, `re_backend_status`, `re_backend_health`
- `re_http_call`
- `x64dbg_cmd`, `ghidra_decompile`, `cheat_engine_aob`, `frida_eval`
- `vibe_re_run` (runs vibe-re modules from `tools/vendor/vibe-re`)
- `ida_run_script` (headless `idat64 -S<script>`)
- `ghidra_run_script` (`analyzeHeadless`)

## External backends (not vendored)

Install locally and let the server launch them on demand:

| Backend | Install |
|---|---|
| SuperghidraMCP (pyghidra-mcp) | `pip install pyghidra-mcp` + `GHIDRA_INSTALL_DIR` env var |
| ida-pro-mcp | `pip install ida-pro-mcp && ida-pro-mcp --install` |
| Hex-Rays IDA MCP | https://github.com/HexRaysSA/ida-mcp |
| Binary Ninja MCP | `pip install binaryninja-mcp` + Binja plugin |
| radare2 MCP | `npm install -g r2mcp` **or** `pip install r2pipe-mcp` |
| x64dbg MCP Server | drop `.dp64` into `<x64dbg>/x64/plugins` |
| WinDbg MCP | `pip install windbg-mcp` + Microsoft dbgeng Python bridge |
| Cheat Engine MCP | CE 7.5+ with `ceserver-lua` plugin |
| Frida MCP | `pip install frida-tools frida-mcp` |
| Hopper MCP | Hopper v4/v5 + `pip install hopper-mcp` |
| REA | `npx rea-agents setup` **or** `npm install -g rea-agents` |
| JADX MCP | JADX + `pip install jadx-mcp` |
| angr MCP | `pip install angr angr-mcp` |
| Capstone MCP | `pip install capstone capstone-mcp` |

Full step-by-step install for each backend: ask the server for `describe_re_backend id=<id>`.

## Vendored vibe-re

The vendored `tools/vendor/vibe-re` tree ships Python modules under `retools/` (static) and `livetools/` (dynamic). Call them through the server:

```
vibe_re_run module="retools.disasm" args=["path/to/game.exe", "--func=main"]
vibe_re_run module="retools.callgraph" args=["path/to/game.exe"]
vibe_re_run module="livetools.analyze" args=["game.exe"]
```

Python prerequisites once per machine:

```bash
cd tools/vendor/vibe-re
python -m venv .venv
.\.venv\Scripts\activate   # Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
```

## Design note

Backends run as separate processes (their native format). The server tracks pid, cwd, stdout tail, and declared HTTP endpoint. HTTP-exposing backends (x64dbg-mcp, pyghidra-mcp streamable-http, cheat-engine ceserver, binja HTTP) can be reached directly via `re_http_call` without re-wrapping their protocol.
