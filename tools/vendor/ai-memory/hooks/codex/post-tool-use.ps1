. "$PSScriptRoot\..\lib\ai-memory-hook.ps1"
Invoke-AiMemoryHook -Event "post-tool-use" -Agent "codex"
exit 0
