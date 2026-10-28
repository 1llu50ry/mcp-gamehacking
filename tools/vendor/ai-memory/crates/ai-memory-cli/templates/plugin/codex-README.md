# ai-memory for Codex

Long-term memory across sessions and coding agents, backed by your own
[ai-memory](https://github.com/akitaonrails/ai-memory) server.

This plugin is generated from the ai-memory repository
(`ai-memory render-plugins`); do not edit it by hand.

## Requirements

The plugin does not contain ai-memory. Install the binary once, separately,
and run `ai-memory setup` (see the
[install guide](https://github.com/akitaonrails/ai-memory#install)). Without
the binary the plugin captures nothing and never blocks Codex.

The plugin needs ai-memory 3.0 or later. With an older binary the hooks
fall back to `http://127.0.0.1:49374` and print an upgrade hint, and the
memory tools do not start.

## Install

```sh
codex plugin marketplace add akitaonrails/ai-memory
codex plugin add ai-memory@ai-memory
```

Then open Codex, run `/hooks`, and trust the ai-memory hooks. Codex runs a
plugin's hooks only after you trust them; until then it skips them without a
message and the session is not captured. `ai-memory doctor` and the
`status` skill report hooks Codex skips.

Trust survives a plugin upgrade: Codex keys it on the hook command, and the
commands stay identical across releases. A release that has to change a
command says so in its changelog, and you trust the new command once.

## What it runs and what it sends

- Hooks: each lifecycle event runs `scripts/ai-memory-hook`, a short POSIX
  shell script, which hands the event to the installed binary
  (`ai-memory hook`). The binary applies your capture exclusions, spools the
  event, and delivers it only to your ai-memory server. On Windows the hooks
  call `ai-memory hook` directly, so `ai-memory` must be on `PATH`; without
  it Codex reports a failed hook, and folderless sessions are captured.
- MCP: the ai-memory memory tools, through `ai-memory mcp-bridge
  --no-session-id`.
- Skills: the ai-memory routing skills and a `status` skill.

No telemetry. The plugin has no settings; the server URL and credentials
come from your ai-memory config.

## Already using `ai-memory install-hooks --agent codex`?

Then both copies would capture each event. Keep one: `ai-memory doctor`
reports the double install, and `ai-memory setup` does not add settings
hooks while the plugin is installed.

## License

MIT, see `LICENSE`.
