. "$PSScriptRoot\..\lib\ai-memory-hook.ps1"
# Capture only: DSH's `@deepseek-ai/dsh-hooks-claude-code` bridge runs
# SessionStart detached, so the handoff is never fetched here — it stays
# available via the MCP `memory_handoff_accept` tool.
Invoke-AiMemoryHook -Event "session-start" -Agent "dsh"
exit 0
