#!/usr/bin/env bash
# Onboarding acceptance: commands and time from nothing to the first memory.
#
# In a clean temporary HOME, with nothing from the real one:
#   1. `curl -fsSL <release>/install.sh | sh` against a release tarball built
#      from a local binary and served over local HTTP;
#   2. `ai-memory setup --yes`, with a stand-in service manager first on PATH
#      (`systemctl` on Linux, `launchctl` on macOS) that runs the rendered
#      unit's command in the background and never reaches a real session; its
#      output must end on the question to ask the restarted agent;
#   3. one synthetic hook event, as the installed Claude Code hook sends it;
#   4. `memory_query` over `ai-memory mcp-bridge` until it returns the event.
#
# Reports the user-facing command count (target 2) and the time from the first
# command to the memory being returned (target <= 60 s). Local embeddings are
# off so the optional model download is not in the measurement.
#
# Usage: scripts/onboarding-acceptance.sh [path/to/ai-memory]
#   default binary: target/release/ai-memory, else target/debug/ai-memory
#   KEEP=1 keeps the temp dir for inspection.
# Needs: curl, tar, python3, and sha256sum or shasum.

set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
bin="${1:-}"
if [ -z "$bin" ]; then
    for candidate in "$repo/target/release/ai-memory" "$repo/target/debug/ai-memory"; do
        if [ -x "$candidate" ]; then bin="$candidate"; break; fi
    done
fi
[ -n "$bin" ] && [ -x "$bin" ] || { echo "no ai-memory binary; build one or pass its path" >&2; exit 2; }
bin="$(cd "$(dirname "$bin")" && pwd)/$(basename "$bin")"

# The commands the tarball path in docs/install.md and docs/macos.md asks for
# before the first captured observation, for comparison.
baseline=(
    "curl -fsSL -O <release>/ai-memory-<os>-<arch>.tar.gz"
    "tar -xzf ai-memory-<os>-<arch>.tar.gz"
    "ai-memory init"
    "write a systemd user unit or LaunchAgent by hand"
    "systemctl --user daemon-reload (or launchctl bootstrap)"
    "systemctl --user enable --now ai-memory.service"
    "ai-memory install-mcp --client claude-code --apply"
    "ai-memory install-hooks --agent claude-code --apply"
    "ai-memory install-skills --scope global"
)

case "$(uname -s)-$(uname -m)" in
    Linux-x86_64 | Linux-amd64) target=linux-x86_64 ;;
    Linux-aarch64 | Linux-arm64) target=linux-aarch64 ;;
    Darwin-arm64 | Darwin-aarch64) target=macos-aarch64 ;;
    Darwin-x86_64) target=macos-x86_64 ;;
    *) echo "unsupported host $(uname -s)-$(uname -m)" >&2; exit 2 ;;
esac
asset="ai-memory-$target.tar.gz"

work="$(mktemp -d "${TMPDIR:-/tmp}/ai-memory-onboarding.XXXXXX")"
server_pid=""
cleanup() {
    if [ -f "$work/service/pid" ]; then kill "$(cat "$work/service/pid")" 2>/dev/null || true; fi
    if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; fi
    if [ "${KEEP:-0}" = 1 ]; then echo "kept $work"; else rm -rf "$work"; fi
}
trap cleanup EXIT

sha256() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
    else shasum -a 256 "$1" | awk '{print $1}'; fi
}

# A release laid out the way release.yml publishes one.
release="$work/release/latest/download"
mkdir -p "$release" "$work/stage/packaging"
cp "$bin" "$work/stage/ai-memory"
cp -R "$repo/hooks" "$work/stage/hooks"
cp -R "$repo/packaging/systemd" "$repo/packaging/launchd" "$work/stage/packaging/"
(cd "$work/stage" && COPYFILE_DISABLE=1 tar -czf "$release/$asset" .)
printf '%s  %s\n' "$(sha256 "$release/$asset")" "$asset" > "$release/$asset.sha256"
cp "$repo/install.sh" "$release/install.sh"

free_port() {
    python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'
}
http_port="$(free_port)"
python3 -m http.server "$http_port" --bind 127.0.0.1 --directory "$work" >"$work/http.log" 2>&1 &
server_pid=$!
for _ in $(seq 1 50); do
    curl -fs "http://127.0.0.1:$http_port/release/latest/download/install.sh" >/dev/null 2>&1 && break
    sleep 0.1
done
base="http://127.0.0.1:$http_port/release"

# The stand-in service managers. Each records its calls and runs the
# rendered service's command in the background.
mkdir -p "$work/fakebin" "$work/service"
cat > "$work/fakebin/systemctl" <<'EOF'
#!/bin/sh
state="$FAKE_SERVICE_STATE"
printf '%s\n' "$*" >> "$state/calls"
[ "$1" = "--user" ] || exit 2
shift
unit="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/ai-memory.service"
alive() { [ -f "$state/pid" ] && kill -0 "$(cat "$state/pid")" 2>/dev/null; }
case "$1" in
  daemon-reload) ;;
  enable) touch "$state/enabled" ;;
  is-enabled) [ -f "$state/enabled" ] ;;
  is-active) alive ;;
  restart)
    if alive; then kill "$(cat "$state/pid")"; sleep 0.2; fi
    line="$(sed -n 's/^ExecStart=//p' "$unit")"
    eval "set -- $line"
    "$@" >"$state/server.log" 2>&1 &
    echo $! > "$state/pid" ;;
  *) exit 3 ;;
esac
EOF
cat > "$work/fakebin/launchctl" <<'EOF'
#!/bin/sh
state="$FAKE_SERVICE_STATE"
printf '%s\n' "$*" >> "$state/calls"
alive() { [ -f "$state/pid" ] && kill -0 "$(cat "$state/pid")" 2>/dev/null; }
case "$1" in
  print) alive ;;
  bootout) if alive; then kill "$(cat "$state/pid")"; fi; rm -f "$state/pid" ;;
  bootstrap)
    python3 -c 'import plistlib, subprocess, sys
args = plistlib.load(open(sys.argv[1], "rb"))["ProgramArguments"]
log = open(sys.argv[2], "w")
print(subprocess.Popen(args, stdout=log, stderr=log, start_new_session=True).pid)' \
      "$3" "$state/server.log" > "$state/pid" ;;
  *) exit 3 ;;
esac
EOF
chmod +x "$work/fakebin/systemctl" "$work/fakebin/launchctl"

home="$work/home"
mkdir -p "$home/.claude/projects" "$home/work/repo"
printf 'workspace = "onboarding"\nproject = "acceptance"\n' > "$home/work/repo/.ai-memory.toml"
port="$(free_port)"

# A clean login: nothing from the caller's environment but a basic PATH.
clean() {
    env -i \
        HOME="$home" \
        TMPDIR="$work" \
        LANG=C.UTF-8 \
        PATH="$work/fakebin:$home/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        FAKE_SERVICE_STATE="$work/service" \
        AI_MEMORY_RELEASE_BASE_URL="$base" \
        AI_MEMORY_BIND="127.0.0.1:$port" \
        AI_MEMORY_SERVER_URL="http://127.0.0.1:$port" \
        AI_MEMORY_EMBEDDING_PROVIDER=none \
        RUST_LOG=off \
        "$@"
}

now() { python3 -c 'import time; print(time.time())'; }

commands=0
start="$(now)"

echo "== 1. curl -fsSL $base/latest/download/install.sh | sh"
commands=$((commands + 1))
clean sh -c "curl -fsSL '$base/latest/download/install.sh' | sh"

echo "== 2. ai-memory setup --yes"
commands=$((commands + 1))
setup_log="$work/setup.log"
(cd "$home" && clean ai-memory setup --yes) | tee "$setup_log"
installed="$(now)"
# setup ends on the question to ask the restarted agent, not a health check.
grep -Fq "What do you remember about this project?" "$setup_log" ||
    { echo "setup did not end with the question for the restarted agent" >&2; exit 1; }

echo "== hook event + memory_query"
marker="onboarding-acceptance-$(date +%s)-$$"
payload="{\"session_id\":\"$marker-session\",\"cwd\":\"$home/work/repo\",\"prompt\":\"please remember $marker\"}"
printf '%s' "$payload" | clean ai-memory hook --event user-prompt-submit --agent claude-code \
    --server-url "http://127.0.0.1:$port" >/dev/null
clean ai-memory hook-drain >/dev/null

found=""
for _ in $(seq 1 100); do
    if clean python3 - "$marker" <<'EOF'
import json, subprocess, sys
marker = sys.argv[1]
bridge = subprocess.Popen(
    ["ai-memory", "mcp-bridge", "--no-session-id"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
)
def send(message):
    bridge.stdin.write(json.dumps(message) + "\n")
    bridge.stdin.flush()
def reply(wanted):
    for line in bridge.stdout:
        message = json.loads(line)
        if message.get("id") == wanted:
            return message
send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2025-06-18", "capabilities": {},
    "clientInfo": {"name": "onboarding-acceptance", "version": "0"}}})
reply(1)
send({"jsonrpc": "2.0", "method": "notifications/initialized"})
send({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
    "name": "memory_query",
    "arguments": {"query": marker, "workspace": "onboarding", "project": "acceptance"}}})
answer = reply(2)
bridge.stdin.close()
bridge.wait(timeout=10)
sys.exit(0 if marker in json.dumps(answer) else 1)
EOF
    then
        found="$(now)"
        break
    fi
    sleep 0.2
done
[ -n "$found" ] || { echo "memory_query never returned the hook event" >&2; exit 1; }

python3 - "$start" "$installed" "$found" "$commands" "${#baseline[@]}" <<'EOF'
import sys
start, installed, found = map(float, sys.argv[1:4])
commands, baseline = int(sys.argv[4]), int(sys.argv[5])
total = found - start
print()
print(f"commands from zero to first memory: {commands} (target 2; manual tarball path: {baseline})")
print(f"install + setup: {installed - start:.1f}s")
print(f"time to first memory: {total:.1f}s (target <= 60s, model download excluded)")
sys.exit(0 if commands <= 2 and total <= 60 else 1)
EOF
