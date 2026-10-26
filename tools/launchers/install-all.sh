#!/usr/bin/env bash
# install-all.sh -- bootstrap every optional RE/debug backend on Linux/macOS.
set +e

say() { printf '\033[1;36m[install-all]\033[0m %s\n' "$*"; }

say "pip-based backends"
pip install \
  pyghidra-mcp \
  ida-pro-mcp \
  binaryninja-mcp \
  r2pipe-mcp \
  frida-tools frida-mcp \
  hopper-mcp \
  jadx-mcp \
  angr angr-mcp \
  capstone capstone-mcp \
  volatility3 volatility3-mcp \
  mitmproxy mitmproxy-mcp \
  tshark-mcp \
  unicorn unicorn-mcp \
  retsync-mcp

say "npm-based backends"
npm install -g r2mcp rea-agents

say "External downloads (manual):"
cat <<'EOF'
 - GhidraMCP:      https://github.com/LaurieWired/GhidraMCP
 - Hex-Rays IDA:   https://github.com/HexRaysSA/ida-mcp
 - dnSpyEx:        https://github.com/dnSpyEx/dnSpy/releases   (Windows only)
 - ReClass.NET:    https://github.com/ReClassNET/ReClass.NET   (Windows only)
 - Scylla:         https://github.com/NtQuery/Scylla           (Windows only)
 - x64dbg plugin:  https://github.com/duty1g/x64dbg-mcp-server (Windows only)
 - PCILeech FPGA:  https://github.com/ufrisk/pcileech
 - MemProcFS:      https://github.com/ufrisk/MemProcFS/releases
EOF

say "Done. Verify with: node dist/index.js and call list_re_backends."
