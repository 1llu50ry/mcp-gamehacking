# ai-memory for Claude Code

Long-term memory across sessions and coding agents, backed by your own
[ai-memory](https://github.com/akitaonrails/ai-memory) server. Quit Claude
Code mid-task, open another agent in the same directory, and continue without
re-explaining the context.

This plugin is generated from the ai-memory repository
(`ai-memory render-plugins`); do not edit it by hand.

## Requirements

The plugin does not contain ai-memory. Install the binary once, separately,
and run `ai-memory setup` (install script, Homebrew, AUR, RPM, the Docker
wrapper or the macOS app; see the
[install guide](https://github.com/akitaonrails/ai-memory#install)). Without
the binary the plugin captures nothing: it says so once at session start and
never blocks Claude.

The plugin needs ai-memory 3.0 or later. With an older binary the hooks
fall back to `http://127.0.0.1:49374` and print an upgrade hint, and the
memory tools do not connect while `server_url` is empty.

## Install

```text
/plugin marketplace add akitaonrails/ai-memory
/plugin install ai-memory@ai-memory
```

or from a shell:

```sh
claude plugin marketplace add akitaonrails/ai-memory
claude plugin install ai-memory@ai-memory
```

Claude Code does not auto-update third-party marketplaces unless you turn
that on. `ai-memory upgrade` updates the plugin along with a release-tarball
binary; after a Homebrew, AUR or RPM upgrade, run `claude plugin marketplace
update ai-memory` and `claude plugin update ai-memory@ai-memory`.

## What it runs and what it sends

- Hooks: every lifecycle event (session start and end, prompts, tool
  calls, compaction, stop, subagents) runs `scripts/ai-memory-hook`, a short
  POSIX shell script you can read in full. It finds the installed `ai-memory`
  binary and hands it the event with `ai-memory hook`. The binary applies
  your capture exclusions (`ignore_paths`, allowlist mode, server profiles)
  before anything is written or sent, spools the event locally, and delivers
  it only to your ai-memory server, which sanitizes it before storage.
- MCP: the ai-memory memory tools, through `ai-memory mcp-bridge`.
- Skills: the ai-memory routing skills, plus `/ai-memory:status`, which
  runs `ai-memory doctor` and summarizes it.

No telemetry. Nothing goes anywhere except the ai-memory server you
configure. Hooks from a plugin run with your user permissions, outside
Claude's sandbox, like any Claude Code hook.

Sessions with no project folder (a desktop scratch workspace) are not
captured through the plugin.

## Options

All optional; the defaults match a local `ai-memory setup` install. Set them
with `/plugin configure ai-memory@ai-memory`.

| Option | Default | Use |
| --- | --- | --- |
| `server_url` | empty | Empty uses the `server_url` from your ai-memory config. Set it only to point this plugin elsewhere. |
| `ai_memory_bin` | `ai-memory` | Absolute path to the binary when it is not on `PATH`. A relative path is ignored: it would resolve inside the checkout. |
| `data_dir` | empty | Only for an install with a non-default data directory. |

There is no token option. Hooks and the MCP bridge use the credentials the
ai-memory CLI already stores (`ai-memory setup`, `auth login`).

## Already using `ai-memory install-hooks`?

If your Claude settings already carry ai-memory hooks, those win: the plugin
skips every event they deliver, so nothing is captured twice. `ai-memory
doctor` reports the double install and suggests keeping one. `ai-memory
setup` leaves Claude's settings alone while the plugin is enabled.

## Platform notes

- On Windows, Claude Code runs plugin hooks through Git Bash, which it
  already requires; the launcher needs nothing else.
- With the Docker wrapper, plugin hooks need a wrapper that routes `ai-memory
  hook` to its native client; run `ai-memory upgrade` to get it.
- In Cowork, capture runs on your computer and needs ai-memory installed
  there; the memory tools still work.

## Uninstall

```sh
claude plugin uninstall ai-memory@ai-memory
```

`ai-memory uninstall` offers the same step.

## License

MIT, see `LICENSE`.
