. "$PSScriptRoot\..\lib\ai-memory-hook.ps1"
Invoke-AiMemoryHook -Event "session-start" -Agent "cursor" -FetchHandoff
exit 0
