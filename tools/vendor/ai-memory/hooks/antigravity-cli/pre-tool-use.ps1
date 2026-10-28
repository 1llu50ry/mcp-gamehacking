. "$PSScriptRoot\..\lib\ai-memory-hook.ps1"
Invoke-AiMemoryHook -Event "pre-tool-use" -Agent "antigravity-cli"
[Console]::Out.WriteLine('{ "decision": "allow" }')
exit 0
