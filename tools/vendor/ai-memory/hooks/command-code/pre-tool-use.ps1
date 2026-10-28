. "$PSScriptRoot\..\lib\ai-memory-hook.ps1"
Invoke-AiMemoryHook -Event "pre-tool-use" -Agent "command-code"
exit 0
