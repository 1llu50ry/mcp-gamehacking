. "$PSScriptRoot\..\lib\ai-memory-hook.ps1"
Invoke-AiMemoryHook -Event "session-end" -Agent "claude-code"
exit 0
