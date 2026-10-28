# Kiro CLI v2 user-prompt hook (userPromptSubmit).
# Capture only — the handoff is injected by session-start.ps1. Print
# nothing: exit-0 stdout would be added to the conversation context.
. "$PSScriptRoot\..\lib\ai-memory-hook.ps1"
Invoke-AiMemoryHook -Event "user-prompt" -Agent "kiro-cli"
exit 0
