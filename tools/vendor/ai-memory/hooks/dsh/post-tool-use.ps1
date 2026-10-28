. "$PSScriptRoot\..\lib\ai-memory-hook.ps1"
Invoke-AiMemoryHook -Event "post-tool-use" -Agent "dsh"
exit 0
