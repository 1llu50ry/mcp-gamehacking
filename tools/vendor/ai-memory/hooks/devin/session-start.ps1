. "$PSScriptRoot\..\lib\ai-memory-hook.ps1"
Invoke-AiMemoryHook -Event "session-start" -Agent "devin" -FetchHandoff -SessionStartEnvelope
exit 0
