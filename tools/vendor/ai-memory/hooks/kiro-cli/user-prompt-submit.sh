#!/bin/sh
# Kiro CLI v2 user-prompt hook (userPromptSubmit).
# Forwards the event JSON to the ai-memory server, fire-and-forget. The
# handoff is injected by session-start.sh — Kiro v2 adds that
# hook's stdout to the agent context, so this hook only captures. Print
# nothing: exit-0 stdout would be added to the conversation context.
_lib_dir="$(dirname "$0")"
[ -f "$_lib_dir/_lib.sh" ] || _lib_dir="$_lib_dir/.."
. "$_lib_dir/_lib.sh"

SERVER="${AI_MEMORY_HOOK_URL:-http://127.0.0.1:49374}"
PAYLOAD=$(cat)
CWD=$(ai_memory_extract_cwd "$PAYLOAD")
QS=$(ai_memory_marker_qs "$CWD")

printf '%s' "$PAYLOAD" \
    | ai_memory_post_hook "$SERVER/hook?event=user-prompt&agent=kiro-cli${QS}" >/dev/null 2>&1 || true
exit 0
