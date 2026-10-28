. "$PSScriptRoot\..\lib\ai-memory-hook.ps1"
Invoke-AiMemoryHook -Event "stop" -Agent "antigravity-cli"
[Console]::Out.WriteLine('{"decision":""}')
exit 0
