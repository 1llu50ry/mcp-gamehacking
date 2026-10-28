#!/bin/sh
# antigravity-cli PreInvocation hook. Invocation zero starts a user turn; on
# an Antigravity build that fires no SessionStart, the first one starts the
# conversation the way session-start.sh does, and its per-conversation marker
# keeps every later turn a no-op. The native hook also records the turn's
# prompt from the transcript; this shell fallback does not parse it.
_lib_dir="$(dirname "$0")"
[ -f "$_lib_dir/_lib.sh" ] || _lib_dir="$_lib_dir/.."
. "$_lib_dir/_lib.sh"

SERVER="${AI_MEMORY_HOOK_URL:-http://127.0.0.1:49374}"
PAYLOAD=$(cat)
# A later invocation, or a missing or malformed counter, fails closed so it
# can never consume a handoff.
if ! ai_memory_antigravity_is_initial_invocation "$PAYLOAD"; then
    printf '{}\n'
    exit 0
fi
CWD=$(ai_memory_extract_cwd "$PAYLOAD")
QS=$(ai_memory_marker_qs "$CWD")
# The `[briefing]` opt-in rides the handoff GET, as in the native hook.
BRIEF_QS=$(ai_memory_briefing_qs "$CWD")
SESSION_ID=$(ai_memory_extract_session_id "$PAYLOAD")
# Shared with session-start.sh: whichever start boundary comes first posts
# session-start and claims the handoff.
if [ -n "$SESSION_ID" ]; then
    START_MARKER=$(ai_memory_briefed_file "agy-start-$SESSION_ID")
    if [ -e "$START_MARKER" ]; then
        printf '{}\n'
        exit 0
    fi
    ai_memory_mark_briefed "$START_MARKER"
fi
SESSION_QS=""
if [ -n "$SESSION_ID" ]; then
    SESSION_QS="&session_id=$(ai_memory_url_encode "$SESSION_ID")"
fi

printf '%s' "$PAYLOAD" \
    | ai_memory_post_hook "$SERVER/hook?event=session-start&agent=antigravity-cli${QS}" >/dev/null 2>&1 || true
HANDOFF=$(ai_memory_get_handoff "$SERVER/handoff?agent=antigravity-cli${QS}${SESSION_QS}${BRIEF_QS}" 2>/dev/null || true)
if [ -n "$HANDOFF" ]; then
    printf '{"injectSteps":[{"systemMessage":{"systemMessage":'
    printf '%s' "$HANDOFF" | ai_memory_json_string
    printf '}}]}\n'
else
    printf '{}\n'
fi
exit 0
