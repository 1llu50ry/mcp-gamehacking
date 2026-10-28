. "$PSScriptRoot\..\lib\ai-memory-hook.ps1"
Invoke-AiMemoryHook -Event "session-start" -Agent "claude-code" -FetchHandoff -SessionStartEnvelope
exit 0
