#!/usr/bin/env bash
# decomp.anything installer for Linux (Windows: install.ps1, in PowerShell). macOS isn't supported.
#
# From a checkout:
#   bash install/install.sh
# Or from GitHub:
#   curl -fsSL https://raw.githubusercontent.com/giveen/decomp.anything/main/install/install.sh | bash
#
# decomp.anything installs on this computer, with uv:
#   1. installs uv, Astral's Python tool manager, if you don't have it (asks first)
#   2. installs decomp.anything (open source, MIT) with uv, in its own environment
#   3. downloads the free compilers and the m2c draft decompiler (pinned and checksum-verified)
#   4. adds decomp.anything to your apps menu and opens it
#
# Your projects go to ~/Decomp. Nothing is sent to decomp.anything.
# Uninstall: uv tool uninstall decompnet
#
# Options:
#   --no-start          install only
#   --source <what>     where decomp.anything comes from: "branch:<name>" (a branch on GitHub; the default is
#                       branch:main when this script isn't run from a checkout), "release" (needs DECOMP_WHEEL) or a
#                       folder with decomp.anything's source. Run from a git checkout, the checkout is used (and
#                       updates follow its branch).
# The same through the environment: DECOMP_SOURCE=..., DECOMP_BRANCH=<name>.
# On a server, decomp.anything also runs in Docker: docker-compose.yml in the repository.
set -euo pipefail

VERSION="0.11.0"
REPO="giveen/decomp.anything"
START=1
SOURCE="${DECOMP_SOURCE:-}"
[ -z "$SOURCE" ] && [ -n "${DECOMP_BRANCH:-}" ] && SOURCE="branch:${DECOMP_BRANCH}"
while [ $# -gt 0 ]; do
  case "$1" in
    --no-start) START=0 ;;
    --source) shift; SOURCE="${1:-}" ;;
    --source=*) SOURCE="${1#--source=}" ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

has_tty() { (exec </dev/tty) 2>/dev/null; }  # a terminal we can read, even when piped from curl
bold() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { printf '\033[32m▸\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ask() {
  local reply
  has_tty || return 0
  printf '%s [Y/n] ' "$1" > /dev/tty
  read -r reply < /dev/tty || true
  [[ -z "$reply" || "$reply" =~ ^[Yy] ]]
}

# Run from a checkout (install/install.sh in the repository): install that checkout
SCRIPT_DIR=""
CHECKOUT=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [ -f "$SCRIPT_DIR/../pyproject.toml" ] && grep -q '^name = "decompnet"' "$SCRIPT_DIR/../pyproject.toml"; then
    CHECKOUT="$(cd "$SCRIPT_DIR/.." && pwd)"
  fi
fi
[ -n "$SOURCE" ] || SOURCE="${CHECKOUT:-branch:main}"

# decomp.anything's own Linux (WSL on Windows, Docker): made by linux-base.sh; then this installs for its user only
IN_BOX=""
[ -f /etc/decomp-wtf-runtime ] && IN_BOX="$(cat /etc/decomp-wtf-runtime)"

bold "decomp.anything setup"
OS="$(uname -s)"
case "$OS" in
  Linux) ;;
  Darwin) fail "macOS isn't supported: decomp.anything runs on Linux and on Windows (in WSL 2), on x86-64 PCs (the games' compilers are x86 programs). On an Intel Mac, an x86-64 Linux virtual machine works too." ;;
  *) fail "this installer is for Linux; on Windows run in PowerShell: irm https://raw.githubusercontent.com/giveen/decomp.anything/main/install/install.ps1 | iex" ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ;;
  *) fail "decomp.anything needs a 64-bit Intel or AMD PC for now: the games' compilers are x86 programs, and this computer's processor is $(uname -m)" ;;
esac
command -v curl >/dev/null || fail "curl is required"

# ------------------------------------------------------------------------------------------- where it comes from
# CHANNEL/BRANCH/COMMIT are remembered (decomp install-info): the app's updates come from the same place.
CHANNEL=release BRANCH="" COMMIT="" SPEC="" SRC_DIR=""
case "$SOURCE" in
  release)
    [ -n "${DECOMP_WHEEL:-}" ] || fail "release installs need DECOMP_WHEEL (a wheel URL or path); use a checkout or branch:main instead"
    SPEC="decompnet @ ${DECOMP_WHEEL}" ;;
  branch:*)
    CHANNEL=branch BRANCH="${SOURCE#branch:}"
    [ -n "$BRANCH" ] || fail "--source branch:<name> needs a branch name" ;;
  *)
    SRC_DIR="$(cd "$SOURCE" 2>/dev/null && pwd)" || fail "no folder $SOURCE (--source is release, branch:<name> or a folder)"
    [ -f "$SRC_DIR/pyproject.toml" ] && [ -d "$SRC_DIR/src/decompnet" ] || fail "$SRC_DIR isn't decomp.anything's source"
    if command -v git >/dev/null; then  # a checkout: updates follow its branch on GitHub
      BRANCH="$(git -c safe.directory='*' -C "$SRC_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
      COMMIT="$(git -c safe.directory='*' -C "$SRC_DIR" rev-parse HEAD 2>/dev/null || true)"
      [ "$BRANCH" = HEAD ] && BRANCH=""
      [ -n "$BRANCH" ] && CHANNEL=branch
    fi ;;
esac

resolve_branch() {  # the branch's newest commit, installed from GitHub's archive of it
  local api
  api="$(curl -fsSL -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$REPO/commits/$BRANCH" 2>/dev/null || true)"
  COMMIT="$(printf '%s' "$api" | grep -m1 '"sha"' | sed 's/.*"sha": *"\([0-9a-f]*\)".*/\1/' || true)"
  if [ -n "$COMMIT" ]; then
    SPEC="decompnet @ https://github.com/$REPO/archive/$COMMIT.tar.gz"
  else  # GitHub's API said no (rate limit): the branch as it is now
    SPEC="decompnet @ https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz"
  fi
}

# ------------------------------------------------------------------------------------------- on this Linux
for d in "$HOME/.local/bin" "$HOME/.cargo/bin"; do [ -x "$d/uv" ] && export PATH="$d:$PATH"; done
if ! command -v uv >/dev/null; then
  if [ -z "$IN_BOX" ]; then
    ask "decomp.anything is installed with uv (Astral's Python tool manager). Install uv now?" || fail "uv is needed: https://docs.astral.sh/uv/"
  fi
  if [ -n "$IN_BOX" ]; then
    curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh >/dev/null
  else
    curl -LsSf https://astral.sh/uv/install.sh | sh
  fi
  export PATH="$HOME/.local/bin:$PATH"
  command -v uv >/dev/null || fail "uv installed, but it isn't on PATH yet; open a new terminal and run this again"
fi
step "uv $(uv --version | cut -d' ' -f2)"

if [ -n "$SRC_DIR" ]; then
  # a copy of the source (not the checkout itself: building leaves nothing behind in it, and it may be read-only)
  TMP_SRC="$(mktemp -d)"
  cp -R "$SRC_DIR/pyproject.toml" "$SRC_DIR/README.md" "$SRC_DIR/LICENSE" "$SRC_DIR/src" "$TMP_SRC/"
  find "$TMP_SRC" -name __pycache__ -type d -prune -exec rm -rf {} +
  SPEC="$TMP_SRC"
  step "installing decomp.anything from $SRC_DIR${BRANCH:+ ($BRANCH @ ${COMMIT:0:7})}"
elif [ "$CHANNEL" = branch ]; then
  resolve_branch
  step "installing decomp.anything from the $BRANCH branch${COMMIT:+ @ ${COMMIT:0:7}}"
else
  WHEEL="${DECOMP_WHEEL:?release installs need DECOMP_WHEEL}"
  step "installing decomp.anything from $WHEEL"
fi
uv tool install --force --quiet --python 3.12 "$SPEC"
[ -n "${TMP_SRC:-}" ] && rm -rf "$TMP_SRC"
BIN="$(uv tool dir --bin)"
[ -n "$IN_BOX" ] || uv tool update-shell >/dev/null 2>&1 || true
"$BIN/decomp" install-info --channel "$CHANNEL" --branch "$BRANCH" --commit "$COMMIT" --repo "$REPO" >/dev/null

step "downloading the compilers and tools"
"$BIN/decomp" setup

# an older decomp.anything still running from before this upgrade: stop it, so the new version takes over
"$BIN/decomp" stop >/dev/null 2>&1 || true

if [ -n "$IN_BOX" ]; then  # decomp.anything's own Linux: the installer on Windows (or the Docker image) does the rest
  step "decomp.anything is installed"
  exit 0
fi

"$BIN/decomp" shortcut >/dev/null 2>&1 && step "added decomp.anything to your apps" || true

# Your AI agents with decomp.anything's tools: only when someone is there to say yes (it changes their configs)
if has_tty && "$BIN/decomp" connect --list 2>/dev/null | grep -q "not connected"; then
  if ask "Give your AI agents (Claude Code, Codex, Antigravity CLI, opencode) decomp.anything's tools, so you can just ask them to decompile a game?"; then
    "$BIN/decomp" connect | sed 's/^/  /'
  fi
fi

bold "Done."
echo "  Start it any time from your apps menu, or with: decomp"
echo "  From your AI agent: run 'decomp connect' once, then ask it to decompile your game."
if [ "$START" = 1 ]; then
  if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    nohup "$BIN/decomp" >/dev/null 2>&1 &
    echo "  Opening decomp.anything in your browser…"
  else
    echo "  No desktop session found (SSH?). Run 'decomp' on the machine itself."
  fi
fi
