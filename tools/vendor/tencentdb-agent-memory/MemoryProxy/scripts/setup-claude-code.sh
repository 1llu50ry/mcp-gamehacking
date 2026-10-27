#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# setup-claude-code.sh
#
# 一键将 tdai context-proxy 的接入信息注入到 Claude Code 的 settings.json。
# 写入 env.ANTHROPIC_BASE_URL 与 env.ANTHROPIC_CUSTOM_HEADERS，永久生效。
#
# 用法:
#   bash scripts/setup-claude-code.sh --endpoint <URL> --token <TOKEN>
#   bash scripts/setup-claude-code.sh --config /path/to/tdai-claude-code.json
#   bash scripts/setup-claude-code.sh --uninstall
#   bash scripts/setup-claude-code.sh --help
#
# 也支持环境变量：TDAI_ENDPOINT / TDAI_TOKEN / TDAI_HEADER_NAME
#
# 配置文件格式（面板下载）:
#   {
#     "endpoint":   "https://proxy.xxx/claude-code",
#     "token":      "tdai_xxxxxxxxxxxxxxxxxxxxxxxx",
#     "headerName": "X-Tdai-User-Token"
#   }
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ENDPOINT="${TDAI_ENDPOINT:-}"
TOKEN="${TDAI_TOKEN:-}"
HEADER_NAME="${TDAI_HEADER_NAME:-X-Tdai-User-Token}"
CONFIG=""
SCOPE="user"
ACTION="install"
DRY_RUN=""

usage() {
  cat <<'EOF'
Usage:
  setup-claude-code.sh --endpoint <URL> --token <TOKEN>
                       [--header-name <NAME>] [--scope user|project] [--dry-run]
  setup-claude-code.sh --config <FILE>
  setup-claude-code.sh --uninstall [--scope user|project]

Options:
  --endpoint     Proxy endpoint URL,  e.g. https://proxy.xxx/claude-code
  --token        User token from dashboard, e.g. tdai_xxxxxxxx
  --header-name  Custom header name (default: X-Tdai-User-Token)
  --config       Read endpoint/token/headerName from a JSON file
  --scope        user (~/.claude/settings.json) | project (./.claude/settings.json)
                 default: user
  --dry-run      Show the resulting JSON without writing
  --uninstall    Remove tdai-related env keys from settings.json
  -h, --help     Show this help

Examples:
  setup-claude-code.sh --endpoint https://proxy.xxx/claude-code --token tdai_abc
  setup-claude-code.sh --config ~/Downloads/tdai-claude-code.json
  setup-claude-code.sh --uninstall
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --endpoint)    ENDPOINT="$2"; shift 2 ;;
    --token)       TOKEN="$2"; shift 2 ;;
    --header-name) HEADER_NAME="$2"; shift 2 ;;
    --config)      CONFIG="$2"; shift 2 ;;
    --scope)       SCOPE="$2"; shift 2 ;;
    --dry-run)     DRY_RUN="1"; shift ;;
    --uninstall)   ACTION="uninstall"; shift ;;
    -h|--help)     usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage >&2; exit 1 ;;
  esac
done

# Resolve settings file by scope
case "$SCOPE" in
  user)    SETTINGS="$HOME/.claude/settings.json" ;;
  project) SETTINGS="./.claude/settings.json" ;;
  *) echo "✗ Invalid scope: $SCOPE (must be 'user' or 'project')" >&2; exit 1 ;;
esac

# Pull values from --config if provided
if [[ -n "$CONFIG" ]]; then
  if [[ ! -f "$CONFIG" ]]; then
    echo "✗ Config file not found: $CONFIG" >&2
    exit 1
  fi
  CFG_JSON=$(cat "$CONFIG")
  ENDPOINT=$(CFG="$CFG_JSON" python3 -c 'import json,os; print(json.loads(os.environ["CFG"]).get("endpoint",""))')
  TOKEN=$(CFG="$CFG_JSON" python3 -c 'import json,os; print(json.loads(os.environ["CFG"]).get("token",""))')
  HN=$(CFG="$CFG_JSON" python3 -c 'import json,os; print(json.loads(os.environ["CFG"]).get("headerName",""))')
  [[ -n "$HN" ]] && HEADER_NAME="$HN"
fi

# Validate (install only)
if [[ "$ACTION" == "install" ]]; then
  if [[ -z "$ENDPOINT" || -z "$TOKEN" ]]; then
    echo "✗ --endpoint and --token are required (or use --config)." >&2
    usage >&2
    exit 1
  fi
fi

# Ensure parent dir exists
mkdir -p "$(dirname "$SETTINGS")"

# Backup existing settings (skip in dry-run)
if [[ -f "$SETTINGS" && -z "${DRY_RUN:-}" ]]; then
  BACKUP="$SETTINGS.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$SETTINGS" "$BACKUP"
  echo "→ Backed up existing settings: $BACKUP"
fi

# Apply via Python (safe JSON merge)
ENDPOINT="$ENDPOINT" TOKEN="$TOKEN" HEADER_NAME="$HEADER_NAME" \
SETTINGS="$SETTINGS" ACTION="$ACTION" DRY_RUN="${DRY_RUN:-}" \
python3 <<'PYEOF'
import json
import os
import sys

path     = os.environ["SETTINGS"]
action   = os.environ["ACTION"]
endpoint = os.environ.get("ENDPOINT", "")
token    = os.environ.get("TOKEN", "")
header   = os.environ.get("HEADER_NAME", "X-Tdai-User-Token")
dry_run  = os.environ.get("DRY_RUN") == "1"

data = {}
if os.path.exists(path) and os.path.getsize(path) > 0:
    try:
        with open(path) as f:
            data = json.load(f)
    except json.JSONDecodeError as exc:
        print(f"✗ Existing settings file is not valid JSON: {exc}", file=sys.stderr)
        print(f"  Fix or remove {path} and retry.", file=sys.stderr)
        sys.exit(1)

env = data.setdefault("env", {})

if action == "install":
    env["ANTHROPIC_BASE_URL"] = endpoint
    env["ANTHROPIC_CUSTOM_HEADERS"] = f"{header}: {token}"
    summary = (
        f"  ANTHROPIC_BASE_URL       = {endpoint}\n"
        f"  ANTHROPIC_CUSTOM_HEADERS = {header}: "
        f"{token[:8] + '***' if len(token) > 8 else '***'}"
    )
    msg = f"✓ Installed tdai proxy config into {path}"
elif action == "uninstall":
    removed = []
    for key in ("ANTHROPIC_BASE_URL", "ANTHROPIC_CUSTOM_HEADERS"):
        if key in env:
            removed.append(key)
            env.pop(key, None)
    if not env:
        data.pop("env", None)
    summary = "  Removed: " + (", ".join(removed) if removed else "(nothing to remove)")
    msg = f"✓ Uninstalled tdai proxy config from {path}"
else:
    print(f"✗ Unknown action: {action}", file=sys.stderr)
    sys.exit(1)

out = json.dumps(data, indent=2, ensure_ascii=False)

if dry_run:
    print("=== DRY RUN: would write the following ===")
    print(out)
    print()
    print(summary)
else:
    with open(path, "w") as f:
        f.write(out + "\n")
    print(msg)
    print(summary)
PYEOF

if [[ -n "${DRY_RUN:-}" ]]; then
  echo
  echo "→ Dry-run only; nothing was written."
else
  cat <<EOF

→ Done. If a Claude Code session is running, restart it (or wait for auto-reload).
  Verify:  cat "$SETTINGS"
EOF
fi
