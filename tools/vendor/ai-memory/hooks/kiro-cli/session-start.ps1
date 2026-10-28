# Kiro CLI v2 session-start hook (agentSpawn).
# Kiro adds this hook's exit-0 stdout to the agent context,
# so the pending handoff is fetched and printed raw here (no envelope —
# Kiro documents none). The compiled project brief rides the same fetch
# once per session.
. "$PSScriptRoot\..\lib\ai-memory-hook.ps1"
Invoke-AiMemoryHook -Event "session-start" -Agent "kiro-cli" -FetchHandoff -BriefingOncePerSession
exit 0
