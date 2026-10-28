#!/bin/sh
# Tests for the marketplace plugin launcher (plugins/*/scripts/ai-memory-hook,
# rendered from crates/ai-memory-cli/templates/plugin/ai-memory-hook.sh).
# Run from the repo root:
#
#   sh tests/hooks/test_plugin_launcher.sh
#
# A stub `ai-memory` records the argv, the origin variable and stdin it is
# handed, so these tests cover only the launcher: binary discovery, option
# precedence, the missing-binary path, the foreign-harness guard and the
# argument order the Docker wrapper relies on. What the real binary does
# with the event is covered by the CLI suite (tests/suite/plugins.rs).
# POSIX shell only; nothing leaves the temp directory.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
LAUNCHER="$ROOT/plugins/claude-code/scripts/ai-memory-hook"
PASS=0
FAIL=0
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

assert_eq() {
    desc="$1"; want="$2"; got="$3"
    if [ "$want" = "$got" ]; then
        PASS=$((PASS+1))
        printf '  ok  %s\n' "$desc"
    else
        FAIL=$((FAIL+1))
        printf '  FAIL %s\n    want=%s\n    got =%s\n' "$desc" "$want" "$got"
    fi
}

# The stub binary: one argv element per line, then the origin and stdin.
STUB_DIR="$TMP/stub-bin"
mkdir -p "$STUB_DIR"
cat >"$STUB_DIR/ai-memory" <<EOF
#!/bin/sh
for arg in "\$@"; do printf '%s\n' "\$arg"; done >"$TMP/argv"
printf '%s' "\${AI_MEMORY_HOOK_ORIGIN:-}" >"$TMP/origin"
cat >"$TMP/stdin"
printf '{}\n'
EOF
chmod +x "$STUB_DIR/ai-memory"

# A sandboxed environment: no inherited plugin variables, a HOME with no
# ai-memory, and a PATH holding only the system tools unless a test adds one.
run_launcher() {
    rm -f "$TMP/argv" "$TMP/origin" "$TMP/stdin"
    env -i HOME="$TMP/home" PATH="${TEST_PATH:-/usr/bin:/bin}" "$@"
}

mkdir -p "$TMP/home"
PLUGIN_ROOT_DIR="$ROOT/plugins/claude-code"

# --- missing binary ---------------------------------------------------
# The launcher also looks in the system install locations, so a machine with
# ai-memory installed there cannot run the missing-binary cases.
SYSTEM_BIN=""
for candidate in /opt/homebrew/bin/ai-memory /usr/local/bin/ai-memory /usr/bin/ai-memory; do
    if [ -x "$candidate" ]; then SYSTEM_BIN="$candidate"; fi
done
if [ -n "$SYSTEM_BIN" ]; then
    printf '  skip missing-binary cases: %s exists\n' "$SYSTEM_BIN"
else
    out=$(printf '{"cwd":"/x"}' | run_launcher CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT_DIR" \
        CLAUDE_PLUGIN_OPTION_AI_MEMORY_BIN="$TMP/missing" sh "$LAUNCHER" claude-code session-start)
    case "$out" in
        *'"systemMessage"'*'binary was not found'*) PASS=$((PASS+1)); printf '  ok  %s\n' "session-start without a binary prints guidance" ;;
        *) FAIL=$((FAIL+1)); printf '  FAIL session-start guidance: %s\n' "$out" ;;
    esac
    out=$(printf '{}' | run_launcher CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT_DIR" sh "$LAUNCHER" claude-code pre-tool-use)
    assert_eq "other events without a binary print {}" "{}" "$out"
    printf '{}' | run_launcher CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT_DIR" sh "$LAUNCHER" claude-code stop >/dev/null
    assert_eq "exit status is 0 without a binary" "0" "$?"
    # More than a pipe buffer: a launcher that exits without reading would kill
    # the writer with SIGPIPE, and an agent writing the payload sees an error.
    rm -f "$TMP/writer-done"
    { head -c 300000 /dev/zero && : >"$TMP/writer-done"; } |
        run_launcher CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT_DIR" sh "$LAUNCHER" claude-code post-tool-use >/dev/null
    assert_eq "stdin is drained without a binary" "yes" "$([ -f "$TMP/writer-done" ] && echo yes || echo no)"
fi

# --- binary discovery and option precedence ---------------------------
printf '{"prompt":"p"}' | run_launcher CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT_DIR" \
    CLAUDE_PLUGIN_OPTION_AI_MEMORY_BIN="$STUB_DIR/ai-memory" \
    CLAUDE_PLUGIN_OPTION_SERVER_URL="http://memory.example:1" \
    CLAUDE_PLUGIN_OPTION_DATA_DIR="/data dir" \
    sh "$LAUNCHER" claude-code user-prompt-submit >/dev/null
assert_eq "the subcommand comes first (Docker wrapper routing)" "hook" "$(head -n 1 "$TMP/argv")"
assert_eq "argv carries event, agent, data dir and server" \
    "hook|--event|user-prompt-submit|--agent|claude-code|--data-dir|/data dir|--server-url|http://memory.example:1" \
    "$(paste -sd '|' "$TMP/argv")"
assert_eq "the origin marks a plugin event" "claude-code-plugin" "$(cat "$TMP/origin")"
assert_eq "stdin reaches the binary unchanged" '{"prompt":"p"}' "$(cat "$TMP/stdin")"

printf '{}' | run_launcher CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT_DIR" \
    CLAUDE_PLUGIN_OPTION_AI_MEMORY_BIN="$STUB_DIR/ai-memory" \
    sh "$LAUNCHER" claude-code stop >/dev/null
assert_eq "an unset server option omits --server-url (the config decides)" \
    "hook|--event|stop|--agent|claude-code" "$(paste -sd '|' "$TMP/argv")"

# A pre-3.0 binary requires --server-url and exits 2 on a usage error before
# reading stdin. The launcher retries it once against the default local
# server with the payload intact, says why on stderr, and exits 0.
OLD_DIR="$TMP/old-bin"
mkdir -p "$OLD_DIR"
cat >"$OLD_DIR/ai-memory" <<EOF
#!/bin/sh
case " \$* " in
    *" --server-url "*) ;;
    *) echo "error: the following required arguments were not provided: --server-url" >&2; exit 2 ;;
esac
for arg in "\$@"; do printf '%s\n' "\$arg"; done >"$TMP/argv"
cat >"$TMP/stdin"
printf '{}\n'
EOF
chmod +x "$OLD_DIR/ai-memory"
status=0
out=$(printf '{"prompt":"old"}' | run_launcher CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT_DIR" \
    CLAUDE_PLUGIN_OPTION_AI_MEMORY_BIN="$OLD_DIR/ai-memory" \
    sh "$LAUNCHER" claude-code user-prompt-submit 2>"$TMP/stderr") || status=$?
assert_eq "an old binary is retried with the default server" \
    "hook|--event|user-prompt-submit|--agent|claude-code|--server-url|http://127.0.0.1:49374" \
    "$(paste -sd '|' "$TMP/argv")"
assert_eq "the retry still gets the whole payload" '{"prompt":"old"}' "$(cat "$TMP/stdin")"
assert_eq "the retry replies and exits 0" "{}|0" "$out|$status"
case "$(cat "$TMP/stderr")" in
    *"needs 3.0 or later"*) PASS=$((PASS+1)); printf '  ok  %s\n' "an old binary gets a version-skew hint" ;;
    *) FAIL=$((FAIL+1)); printf '  FAIL version-skew hint: %s\n' "$(cat "$TMP/stderr")" ;;
esac
# The retry honours AI_MEMORY_SERVER_URL, so an old binary pointed at a
# remote server never sends to whatever listens on local loopback.
printf '{"prompt":"remote"}' | run_launcher CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT_DIR" \
    CLAUDE_PLUGIN_OPTION_AI_MEMORY_BIN="$OLD_DIR/ai-memory" \
    AI_MEMORY_SERVER_URL="https://memory.example:8443" \
    sh "$LAUNCHER" claude-code user-prompt-submit 2>/dev/null >/dev/null || true
assert_eq "an old binary's retry uses AI_MEMORY_SERVER_URL" \
    "hook|--event|user-prompt-submit|--agent|claude-code|--server-url|https://memory.example:8443" \
    "$(paste -sd '|' "$TMP/argv")"

printf '{}' | TEST_PATH="$STUB_DIR:/usr/bin:/bin" run_launcher CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT_DIR" \
    CLAUDE_PLUGIN_OPTION_AI_MEMORY_BIN="ai-memory" sh "$LAUNCHER" claude-code stop >/dev/null
assert_eq "the default bin option resolves through PATH" "hook" "$(head -n 1 "$TMP/argv" 2>/dev/null || true)"

# A relative bin option would resolve against the hook's cwd, the checkout,
# so a repository could plant the binary. It is ignored (adversarial), and
# discovery finds the real one on PATH (control).
EVIL="$TMP/checkout"
mkdir -p "$EVIL/bin"
cat >"$EVIL/bin/ai-memory" <<EOF
#!/bin/sh
: >"$TMP/planted-ran"
cat >/dev/null
printf '{}\n'
EOF
chmod +x "$EVIL/bin/ai-memory"
for relative in bin/ai-memory ./bin/ai-memory; do
    rm -f "$TMP/planted-ran"
    printf '{}' | (cd "$EVIL" && TEST_PATH="$STUB_DIR:/usr/bin:/bin" run_launcher \
        CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT_DIR" CLAUDE_PLUGIN_OPTION_AI_MEMORY_BIN="$relative" \
        sh "$LAUNCHER" claude-code stop >/dev/null)
    assert_eq "a relative bin option ($relative) is never run" "no" \
        "$([ -f "$TMP/planted-ran" ] && echo yes || echo no)"
    assert_eq "a relative bin option ($relative) falls back to PATH" "hook" \
        "$(head -n 1 "$TMP/argv" 2>/dev/null || true)"
done

mkdir -p "$TMP/home/.local/bin"
cp "$STUB_DIR/ai-memory" "$TMP/home/.local/bin/ai-memory"
printf '{}' | run_launcher CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT_DIR" sh "$LAUNCHER" claude-code stop >/dev/null
assert_eq "off PATH, ~/.local/bin/ai-memory is found (GUI-launched apps)" "hook" "$(head -n 1 "$TMP/argv" 2>/dev/null || true)"
rm -f "$TMP/home/.local/bin/ai-memory"

# --- foreign harnesses reading the Claude plugin ------------------------
printf '{}' | run_launcher DROID_PLUGIN_ROOT="$TMP" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT_DIR" \
    CLAUDE_PLUGIN_OPTION_AI_MEMORY_BIN="$STUB_DIR/ai-memory" sh "$LAUNCHER" claude-code stop >/dev/null
assert_eq "Droid is attributed to droid" "droid" "$(sed -n 5p "$TMP/argv")"
# Muse Code loads the Claude plugin with CLAUDE_PLUGIN_ROOT set and adds
# MUSE_PLUGIN_ID beside the MUSE_SESSION_ID every Muse hook gets.
printf '{}' | run_launcher MUSE_PLUGIN_ID="ai-memory" MUSE_SESSION_ID="01a13669-dc61-7a72-b5ec-ad2f300ffd26" \
    CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT_DIR" \
    CLAUDE_PLUGIN_OPTION_AI_MEMORY_BIN="$STUB_DIR/ai-memory" sh "$LAUNCHER" claude-code stop >/dev/null
assert_eq "Muse is attributed to muse" "muse" "$(sed -n 5p "$TMP/argv")"
assert_eq "the Muse copy marks its origin" "muse-plugin" "$(cat "$TMP/origin")"
# A Claude Code started from a Muse shell may inherit MUSE_SESSION_ID; without
# MUSE_PLUGIN_ID its events stay Claude Code's.
printf '{}' | run_launcher MUSE_SESSION_ID="01a13669-dc61-7a72-b5ec-ad2f300ffd26" \
    CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT_DIR" \
    CLAUDE_PLUGIN_OPTION_AI_MEMORY_BIN="$STUB_DIR/ai-memory" sh "$LAUNCHER" claude-code stop >/dev/null
assert_eq "an inherited MUSE_SESSION_ID alone stays claude-code" "claude-code" "$(sed -n 5p "$TMP/argv")"
printf '{}' | run_launcher PLUGIN_ROOT="$TMP" \
    CLAUDE_PLUGIN_OPTION_AI_MEMORY_BIN="$STUB_DIR/ai-memory" sh "$LAUNCHER" claude-code stop >/dev/null
assert_eq "Codex reading the Claude plugin is attributed to codex" "codex" "$(sed -n 5p "$TMP/argv")"
out=$(printf '{}' | run_launcher CLAUDE_PLUGIN_OPTION_AI_MEMORY_BIN="$STUB_DIR/ai-memory" \
    sh "$LAUNCHER" claude-code stop)
assert_eq "an unknown host gets {}" "{}" "$out"
assert_eq "an unknown host never reaches the binary" "no" "$([ -f "$TMP/argv" ] && echo yes || echo no)"

# The Codex plugin's own launcher call is not second-guessed.
printf '{}' | run_launcher PLUGIN_ROOT="$ROOT/plugins/codex" \
    CLAUDE_PLUGIN_OPTION_AI_MEMORY_BIN="$STUB_DIR/ai-memory" \
    sh "$ROOT/plugins/codex/scripts/ai-memory-hook" codex session-start >/dev/null
assert_eq "the Codex plugin reports agent codex" "codex" "$(sed -n 5p "$TMP/argv")"
assert_eq "the Codex plugin marks its origin" "codex-plugin" "$(cat "$TMP/origin")"

out=$(printf '{}' | run_launcher CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT_DIR" sh "$LAUNCHER" "" "")
assert_eq "missing arguments get {}" "{}" "$out"

# --- cost -------------------------------------------------------------
# Twenty missing-binary runs: the path a machine without ai-memory pays on
# every tool call. Whole seconds only in POSIX sh, so the bound is loose.
# An explicit missing path keeps this off any system install.
start=$(date +%s)
i=0
while [ "$i" -lt 20 ]; do
    printf '{}' | run_launcher CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT_DIR" \
        CLAUDE_PLUGIN_OPTION_AI_MEMORY_BIN="$TMP/missing" sh "$LAUNCHER" claude-code pre-tool-use >/dev/null
    i=$((i+1))
done
elapsed=$(( $(date +%s) - start ))
assert_eq "twenty missing-binary runs take under 3s" "yes" "$([ "$elapsed" -lt 3 ] && echo yes || echo no)"

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
