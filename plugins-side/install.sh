#!/usr/bin/env bash
# mcp-gamehacking :: plugins-side installer (Linux / macOS)
# ---------------------------------------------------------
# Auto-detects IDA Pro, Ghidra, Binary Ninja and installs the matching
# Python bridge into each host's conventional plugins directory.
# ReClass.NET / dnSpy / ILSpy / x64dbg / Cheat Engine are Windows-only
# and are skipped here.
#
# Dry run by default; pass --apply to actually copy.
#
#   ./install.sh                   # dry run
#   ./install.sh --apply           # install everything detected
#   ./install.sh --only ida ghidra # restrict to given hosts
#
# Override search roots:
#   IDAUSR=~/.idapro           ./install.sh
#   GHIDRA_USER=~/.ghidra/.ghidra_11.1.2_PUBLIC ./install.sh
#   BINJA_USER=~/.binaryninja  ./install.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLY=0
ONLY=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --only)  shift; while [[ $# -gt 0 && "$1" != --* ]]; do ONLY+=("$1"); shift; done; continue ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

should() { [[ ${#ONLY[@]} -eq 0 ]] && return 0; for n in "${ONLY[@]}"; do [[ "$n" == "$1" ]] && return 0; done; return 1; }

copy_plugin() {
  local src="$1" dst_dir="$2" host="$3"
  if [[ ! -e "$src" ]]; then echo "  SKIP (source missing): $src"; return; fi
  if [[ $APPLY -eq 0 ]]; then echo "  [dry] copy $src -> $dst_dir"; return; fi
  mkdir -p "$dst_dir"
  cp -f "$src" "$dst_dir/"
  echo "  ✓ installed $host plugin to $dst_dir/$(basename "$src")"
}

OS="$(uname -s)"
is_mac() { [[ "$OS" == "Darwin" ]]; }

# -------- IDA Pro --------
if should ida; then
  echo
  echo "[ida] searching..."
  if [[ -z "${IDAUSR:-}" ]]; then
    if is_mac; then IDAUSR="$HOME/Library/Application Support/Hex-Rays/IDA Pro"
    else            IDAUSR="$HOME/.idapro"
    fi
  fi
  if [[ -d "$IDAUSR" ]]; then
    echo "  IDAUSR: $IDAUSR"
    copy_plugin "$HERE/ida-pro/mcp_bridge.py" "$IDAUSR/plugins" "IDA"
  else
    echo "  no IDAUSR at $IDAUSR — launch IDA once to create it, or set IDAUSR"
  fi
fi

# -------- Ghidra --------
if should ghidra; then
  echo
  echo "[ghidra] searching..."
  if [[ -z "${GHIDRA_USER:-}" ]]; then
    GHIDRA_USER="$(ls -1dt "$HOME"/.ghidra/.ghidra_*_PUBLIC 2>/dev/null | head -1 || true)"
  fi
  if [[ -n "${GHIDRA_USER:-}" && -d "$GHIDRA_USER" ]]; then
    echo "  Ghidra user: $GHIDRA_USER"
    copy_plugin "$HERE/ghidra/mcp_bridge.py" "$GHIDRA_USER/scripts" "Ghidra"
  else
    echo "  no Ghidra user dir — set GHIDRA_USER"
  fi
fi

# -------- Binary Ninja --------
if should binja; then
  echo
  echo "[binja] searching..."
  if [[ -z "${BINJA_USER:-}" ]]; then
    if is_mac; then BINJA_USER="$HOME/Library/Application Support/Binary Ninja"
    else            BINJA_USER="$HOME/.binaryninja"
    fi
  fi
  if [[ -d "$BINJA_USER" ]]; then
    echo "  Binja user: $BINJA_USER"
    copy_plugin "$HERE/binaryninja/mcp_bridge.py" "$BINJA_USER/plugins" "Binary Ninja"
  else
    echo "  no Binja user dir at $BINJA_USER — set BINJA_USER"
  fi
fi

# -------- Reminders about Windows-only hosts --------
echo
echo "note: Cheat Engine / ReClass.NET / dnSpy / ILSpy / x64dbg are Windows-only."
echo "      use plugins-side\\install.ps1 from a Windows host for those."

echo
if [[ $APPLY -eq 0 ]]; then
  echo "This was a dry run. Pass --apply to actually copy files."
else
  echo "Done."
fi
