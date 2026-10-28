# Installing ai-memory for your user (instructions for AI agents)

You are an AI coding agent and your user asked you to install ai-memory. It
takes two commands, and neither needs root or administrator rights.

1. Install the release binary. The script checks the download against the
   release's published SHA-256 checksum, puts the binary under
   `~/.local/lib/ai-memory` and links `~/.local/bin/ai-memory` to it:

   ```bash
   curl -fsSL https://github.com/akitaonrails/ai-memory/releases/latest/download/install.sh | sh
   ```

   If `~/.local/bin` is not on `PATH`, call `~/.local/bin/ai-memory` directly
   in the next step, and tell your user to add the directory to `PATH`.

   On native Windows, in PowerShell, the equivalent script unpacks the release
   under `%LOCALAPPDATA%\Programs\ai-memory` and adds it to the user `PATH`:

   ```powershell
   irm https://github.com/akitaonrails/ai-memory/releases/latest/download/install.ps1 | iex
   ```

   A shell started before the install does not see the new `PATH`; call
   `& "$env:LOCALAPPDATA\Programs\ai-memory\ai-memory.exe"` directly there.

2. Set it up for yourself, naming your own harness:

   ```bash
   ai-memory setup --yes --agent <self>
   ```

   `<self>` is one of `claude-code`, `codex`, `opencode`, `opencode2`,
   `gemini-cli`, `cursor`, `kimi-code`, `kiro-cli`, `grok`, `copilot-cli`,
   `antigravity-cli`, `command-code`, `devin`, `droid`, `muse`, `omp`, `pi`,
   `openclaw`, `qwen-code`
   (`ai-memory setup --help` lists every value). Repeat `--agent` to wire
   several harnesses. Without `--agent`, `setup` wires every harness it finds
   under the home directory.

`setup` creates the data directory with a root bearer token in an owner-only
file, starts a per-user service (systemd `--user` on Linux, a LaunchAgent on
macOS, a logon entry on Windows that runs the server with no console window),
registers the MCP server and installs the lifecycle hooks and Agent
Skills for each harness, then checks that the server answers. The token is
never printed and never written into a harness config. Running `setup` again
changes nothing.

Afterwards:

- Tell your user to restart the harness so it loads the new MCP entry and
  hooks.
- If `setup` exits non-zero, show your user the `problem:` lines it printed.
  Do not work around them by editing harness configs by hand.
- If the server already runs another way (Docker, a packaged system unit), add
  `--no-service`.
- Inside WSL2, use the Linux commands; native Windows details are in
  [`docs/windows.md`](docs/windows.md).

Full reference: [`docs/install.md`](docs/install.md#one-step-native-install-installsh--ai-memory-setup).
