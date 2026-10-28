. "$PSScriptRoot\..\lib\ai-memory-hook.ps1"
Invoke-AiMemoryHook -Event "pre-compact" -Agent "gemini-cli"
exit 0
