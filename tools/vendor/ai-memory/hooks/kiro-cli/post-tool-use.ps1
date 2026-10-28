# Kiro CLI v2 post-tool-use hook (postToolUse).
. "$PSScriptRoot\..\lib\ai-memory-hook.ps1"
Invoke-AiMemoryHook -Event "post-tool-use" -Agent "kiro-cli"
exit 0
