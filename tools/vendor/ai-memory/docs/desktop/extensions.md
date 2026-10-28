# Extension and plugin surfaces (research, 2026-10-08)

> Can an ai-memory extension in each app's marketplace do what an installer
> cannot? Sourced from current official docs and, for Codex, its source.
> The resulting design proposal is RFC #1166; the implementation design,
> re-verified on 2026-10-13, is
> [`design-marketplace-plugins.md`](../design-marketplace-plugins.md).

## Claude (one plugin format, three surfaces)

Per <https://claude.com/docs/plugins/platform-support>, the same plugin
folder installs everywhere but each surface loads a different subset:

| Component | Chat | Cowork | Claude Code (CLI, IDE, desktop Code tab) |
| --- | --- | --- | --- |
| Skills, commands | Load (commands as skills) | Load | Load |
| Hooks | **Ignored** | **Load** | Load |
| Remote MCP (fixed `http`/`sse` URL) | Listed under the plugin's Connectors; works once connected | Loads; connect from Connectors | Loads |
| Local MCP (a command, incl. `.mcpb`) | **Ignored** | Loads when the Cowork session runs on your computer | Loads |
| MCP using `${user_config.*}` | Ignored when the URL references it | Ignored without a default; no prompt | Loads; prompts |
| Top-level `bin/` executables | Can't be installed | Can't be installed | Loads |

Chat and Cowork plugins are added from **Customize > Plugins** in claude.ai
or the desktop app (one click, from the directory or an added GitHub/GitLab/
Bitbucket marketplace, or an uploaded zip), are attached to the account, and
reach Claude Code as synced plugins. Claude Code installs per machine
(`/plugin`, `claude plugin install`).

Consequences for ai-memory:

- **Cowork gains a capture path**: a plugin's hooks load there, which
  `~/.claude/settings.json` hooks are not documented to do. Unverified: on
  Linux Cowork runs in a VM, so a hook command or a loopback server URL that
  works on the host may not work inside it.
- **Chat still cannot capture**: hooks and local MCP servers are ignored.
  Only skills and a remote MCP connector load, and a remote connector has to
  be reachable as configured (whether claude.ai brokers it from Anthropic's
  side, which would rule out a loopback server, was not verified here).
- A plugin cannot install the ai-memory binary on Chat/Cowork (`bin/` is
  refused there), so the server still has to be installed separately; hook
  scripts shipped as plugin files (like the POSIX bundle in `hooks/`) are
  not top-level executables.

## Other apps

| App | Extension unit | Can bundle hooks? | Can bundle MCP? | Install path | Source |
| --- | --- | --- | --- | --- | --- |
| Codex (CLI + desktop) | Plugin | Yes, but only for manually installed plugins: a plugin with lifecycle hooks is not eligible for the public plugin directory | Yes (the public directory requires a public HTTPS endpoint) | Repo, personal or Git marketplace (`.agents/plugins/marketplace.json`); public directory only without hooks | <https://developers.openai.com/plugins/build/plugins>; <https://learn.chatgpt.com/docs/hooks>; plugin hook trust in `codex-rs/app-server/src/effective_plugin_change.rs` |
| Cursor | Cursor Plugin (`.cursor-plugin/plugin.json` + `hooks/hooks.json`) or Agent Plugin (root `plugin.json`) | Cursor Plugin format only; an Agent Plugin carries skills and MCP, not hooks | Yes | Cursor Marketplace / Customize page; `cursor://` deeplinks install an MCP config, not hooks | <https://cursor.com/docs/plugins>; <https://cursor.com/docs/reference/plugins> |
| Antigravity | Plugin | Yes, CLI only per docs | Yes (`mcp_config.json` plugin component) | `agy plugin install <name>@antigravity-plugins-official`, a GitHub URL or local directory, or a folder in `~/.gemini/config/plugins/` / `.agents/plugins/` | <https://antigravity.google/docs/plugins.md>; <https://antigravity.google/docs/hooks.md> |
| Zed | Extension | No | Yes, but MCP extensions are being deprecated in favor of the official MCP registry; remote servers belong in the native UI | Extension registry (MCP registry for new servers) | <https://zed.dev/docs/extensions/mcp-extensions> |
| ChatGPT (hosted chat) | Plugin | No | Remote only, needs a reachable server | Published directory with review | <https://developers.openai.com/plugins> |

Codex trusts plugin hooks automatically only for plugins a ChatGPT
workspace lists for the signed-in account (`trust_materialized_plugin_hooks`);
a plugin from any other source goes through the normal per-hook trust, so a
plugin does not remove the silent "untrusted hook" failure. Whether Cursor
plugin hooks need approval is not stated in its docs (the hooks page only
says project hooks run in any trusted workspace). The #721 de-duplication of
Cursor's copy of the Claude Code hooks needs Cursor's own ai-memory hooks, so
only the Cursor Plugin format can provide it.
