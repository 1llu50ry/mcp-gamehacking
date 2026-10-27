#!/bin/sh
# decomp.anything's own Linux: prepares a fresh Debian system for it, as root. Used for both
#   - Windows: the "decomp-wtf" WSL 2 distribution install.ps1 makes   (sh linux-base.sh wsl)
#   - servers: the Docker image                                        (sh linux-base.sh docker, see Dockerfile)
# so decomp.anything runs on the same Linux everywhere. Running it again updates the system and changes nothing else.
#
# What it does: installs the few system programs decomp.anything and the agent CLIs use (git, Node.js for npm-installed
# agents, the 32-bit C library for old compilers), makes the user "decomp" (uid 1000), and puts a `decomp` command
# in /usr/local/bin that starts decomp.anything from that user's install (install.sh puts it in ~/.local).
set -eu

MODE="${1:-docker}"
case "$MODE" in wsl|docker) ;; *) echo "usage: linux-base.sh wsl|docker" >&2; exit 2 ;; esac
[ "$(id -u)" = 0 ] || { echo "linux-base.sh runs as root" >&2; exit 1; }
[ -f /etc/debian_version ] || { echo "linux-base.sh is for Debian" >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
echo "> system packages"
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  ca-certificates curl git xz-utils zstd unzip bzip2 file procps less nano bash python3 \
  nodejs npm libc6-i386 lib32stdc++6 lib32z1 locales >/dev/null
apt-get clean
rm -rf /var/lib/apt/lists/*

# UTF-8 everywhere (old tools print what they print; Python and the agents expect UTF-8)
grep -q '^C.UTF-8' /etc/default/locale 2>/dev/null || echo 'LANG=C.UTF-8' > /etc/default/locale

if ! id decomp >/dev/null 2>&1; then
  echo "> user decomp"
  if getent passwd 1000 >/dev/null; then useradd -m -s /bin/bash decomp; else useradd -m -u 1000 -s /bin/bash decomp; fi
fi
HOME_DIR="$(getent passwd decomp | cut -d: -f6)"

# npm-installed agents (Codex, ...) go to ~/.local, no root needed; and ~/.local/bin comes first everywhere
su decomp -c 'npm config set prefix "$HOME/.local" >/dev/null 2>&1' || true
cat > /etc/profile.d/decomp-wtf.sh <<'EOF'
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) PATH="$HOME/.local/bin:$PATH" ;; esac
export PATH LANG=C.UTF-8
EOF
grep -q 'decomp-wtf.sh' "$HOME_DIR/.bashrc" 2>/dev/null || echo '. /etc/profile.d/decomp-wtf.sh' >> "$HOME_DIR/.bashrc"

echo "$MODE" > /etc/decomp-wtf-runtime

# `decomp` for everything that starts decomp.anything from outside a login shell: wsl.exe --exec, docker exec
cat > /usr/local/bin/decomp <<'EOF'
#!/bin/sh
# decomp.anything, installed for this user by install.sh (uv tool install, in ~/.local)
. /etc/profile.d/decomp-wtf.sh
if [ ! -x "$HOME/.local/bin/decomp" ]; then
  echo "decomp.anything isn't installed for $(id -un) yet: run the installer again" >&2
  exit 1
fi
exec "$HOME/.local/bin/decomp" "$@"
EOF
chmod 755 /usr/local/bin/decomp

if [ "$MODE" = wsl ]; then
  # decomp is the default user; Windows' PATH stays out (its npm shims would shadow the Linux agents, and every
  # command lookup would crawl through /mnt/c); Windows programs can still be started (opening the browser).
  # systemd as Debian's WSL image has it (decomp.anything then caps heavy tools' memory with systemd-run).
  cat > /etc/wsl.conf <<'EOF'
[user]
default = decomp

[interop]
enabled = true
appendWindowsPath = false

[boot]
systemd = true
EOF
fi

if [ "$MODE" = docker ]; then
  # The container's first start installs decomp.anything into the decomp user's home (a volume, so updates the app
  # installs itself survive new containers); later starts just run it. DECOMP_INSTALL_ID changes when the
  # installer on the computer runs again: then this installs again (that's how a reinstall reaches the volume).
  mkdir -p /usr/local/share/decomp-anything
  cat > /usr/local/bin/decomp-entrypoint <<'EOF'
#!/bin/sh
set -eu
. /etc/profile.d/decomp-wtf.sh
cd "$HOME"
# temporary files on the volume, not in the container's overlay file system, whose inode numbers can be too large
# for the old 32-bit compilers ("Value too large for defined data type")
export TMPDIR="$HOME/.tmp"
rm -rf "$TMPDIR" && mkdir -p "$TMPDIR"
marker="$HOME/.local/share/decompnet/container-install-id"
if [ ! -x "$HOME/.local/bin/decomp" ] || [ "$(cat "$marker" 2>/dev/null)" != "${DECOMP_INSTALL_ID:-}" ]; then
  echo "decomp.anything: installing (the first start takes a few minutes)"
  bash /usr/local/share/decomp-anything/install.sh --no-start
  mkdir -p "$(dirname "$marker")"
  printf '%s' "${DECOMP_INSTALL_ID:-}" > "$marker"
fi
exec "$HOME/.local/bin/decomp" --no-browser
EOF
  chmod 755 /usr/local/bin/decomp-entrypoint
fi

echo "> decomp.anything's Linux is ready ($MODE)"
