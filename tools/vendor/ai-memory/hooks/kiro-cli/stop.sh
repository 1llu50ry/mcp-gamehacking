#!/bin/sh
# Kiro CLI v2 stop hook (stop).
# Forwards the event JSON to the ai-memory server, fire-and-forget.
# Print nothing: on the v2 engine a stop hook's stdout can carry a
# {"decision":"block"} verdict that would re-prompt the model, so a
# capture-only hook must keep stdout empty and exit 0.
_lib_dir="$(dirname "$0")"
[ -f "$_lib_dir/_lib.sh" ] || _lib_dir="$_lib_dir/.."
. "$_lib_dir/_lib.sh"

SERVER="${AI_MEMORY_HOOK_URL:-http://127.0.0.1:49374}"
PAYLOAD=$(cat)
CWD=$(ai_memory_extract_cwd "$PAYLOAD")
QS=$(ai_memory_marker_qs "$CWD")

printf '%s' "$PAYLOAD" \
    | ai_memory_post_hook "$SERVER/hook?event=stop&agent=kiro-cli${QS}" >/dev/null 2>&1 || true
exit 0
