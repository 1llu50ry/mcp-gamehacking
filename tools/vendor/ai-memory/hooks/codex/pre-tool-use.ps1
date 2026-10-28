. "$PSScriptRoot\..\lib\ai-memory-hook.ps1"
Invoke-AiMemoryHook -Event "pre-tool-use" -Agent "codex"
exit 0
