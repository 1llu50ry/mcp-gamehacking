# Client configurations

Ready-to-paste snippets for the clients people actually use. Replace
the absolute paths with wherever you have `mcp-gamehacking` installed.

## Claude Desktop (`claude_desktop_config.json`)

Windows: `%APPDATA%\Claude\claude_desktop_config.json`
macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

See [`claude-desktop.json`](claude-desktop.json).

## Cursor (`.cursor/mcp.json` in your workspace)

See [`cursor.json`](cursor.json).

## Cline (`cline_mcp_settings.json`)

See [`cline.json`](cline.json).

## LM Studio

Settings → Developer → MCP Servers → + Add → paste the stdio command
from [`lm-studio.json`](lm-studio.json).

## Zed (`settings.json`)

See [`zed.json`](zed.json).

## Continue.dev (`~/.continue/config.yaml`)

See [`continue.yaml`](continue.yaml).

## OpenAI's Agent SDK (python)

See [`openai-agent.py`](openai-agent.py).

## Running over HTTP instead of stdio

For every client that supports `url` instead of `command`:

```
MCP_TRANSPORT=http MCP_HTTP_PORT=7777 MCP_AUTH_TOKEN=<secret> node dist/index.js
```

Then point the client at `http://127.0.0.1:7777/mcp` with the bearer
token in `Authorization: Bearer <secret>`.
