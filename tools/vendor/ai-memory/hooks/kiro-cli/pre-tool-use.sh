#!/bin/sh
# Kiro CLI v2 pre-tool-use hook (preToolUse).
# Forwards the event JSON to the ai-memory server, fire-and-forget.
# Fail-open by contract: exit 0 unconditionally and print nothing.
# Exit code 2 would BLOCK the tool call, so a capture
# hook must never let a server error surface as a non-zero exit.
_lib_dir="$(dirname "$0")"
[ -f "$_lib_dir/_lib.sh" ] || _lib_dir="$_lib_dir/.."
. "$_lib_dir/_lib.sh"

SERVER="${AI_MEMORY_HOOK_URL:-http://127.0.0.1:49374}"
PAYLOAD=$(cat)
CWD=$(ai_memory_extract_cwd "$PAYLOAD")
QS=$(ai_memory_marker_qs "$CWD")

printf '%s' "$PAYLOAD" \
    | ai_memory_post_hook "$SERVER/hook?event=pre-tool-use&agent=kiro-cli${QS}" >/dev/null 2>&1 || true
exit 0
