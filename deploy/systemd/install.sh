#!/usr/bin/env bash
# Install mcp-reverse as a systemd service.
#
# Usage (as root):
#   sudo ./deploy/systemd/install.sh [--prefix /opt/mcp-reverse] [--user mcp]
set -euo pipefail

PREFIX="/opt/mcp-reverse"
SVC_USER="mcp"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix) PREFIX="$2"; shift 2 ;;
    --user)   SVC_USER="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [[ "$EUID" -ne 0 ]]; then echo "run as root" >&2; exit 1; fi
command -v node >/dev/null || { echo "node not installed" >&2; exit 1; }

echo "[+] creating user $SVC_USER"
id -u "$SVC_USER" >/dev/null 2>&1 || useradd --system --home "$PREFIX" --shell /usr/sbin/nologin "$SVC_USER"

echo "[+] syncing $PREFIX"
mkdir -p "$PREFIX"
rsync -a --exclude=.git --exclude=node_modules . "$PREFIX/"
chown -R "$SVC_USER":"$SVC_USER" "$PREFIX"

echo "[+] installing deps + building"
sudo -u "$SVC_USER" sh -c "cd '$PREFIX' && npm ci --production && npm run build"

echo "[+] installing unit"
sed "s#/opt/mcp-reverse#$PREFIX#g" "$(dirname "$0")/mcp-reverse.service" >/etc/systemd/system/mcp-reverse.service
sed -i "s#User=mcp#User=$SVC_USER#; s#Group=mcp#Group=$SVC_USER#" /etc/systemd/system/mcp-reverse.service

systemctl daemon-reload
systemctl enable --now mcp-reverse
echo "[+] done. systemctl status mcp-reverse"
