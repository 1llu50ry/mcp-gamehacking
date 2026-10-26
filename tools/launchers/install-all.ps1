# install-all.ps1 -- bootstrap every optional RE/debug backend on Windows.
# Run interactively; some steps need admin or a Python venv already active.

$ErrorActionPreference = "Continue"

function Say($msg) { Write-Host "[install-all] $msg" -ForegroundColor Cyan }

Say "pip-based backends"
pip install `
  pyghidra-mcp `
  ida-pro-mcp `
  binaryninja-mcp `
  r2pipe-mcp `
  windbg-mcp `
  frida-tools frida-mcp `
  hopper-mcp `
  jadx-mcp `
  angr angr-mcp `
  capstone capstone-mcp `
  volatility3 volatility3-mcp `
  mitmproxy mitmproxy-mcp `
  memprocfs-mcp `
  tshark-mcp `
  unicorn unicorn-mcp `
  retsync-mcp `
  scylla-mcp

Say "npm-based backends"
npm install -g r2mcp rea-agents

Say "External downloads (manual):"
Write-Host " - GhidraMCP:      https://github.com/LaurieWired/GhidraMCP"
Write-Host " - Hex-Rays IDA:   https://github.com/HexRaysSA/ida-mcp"
Write-Host " - x64dbg plugin:  https://github.com/duty1g/x64dbg-mcp-server/releases"
Write-Host " - dnSpyEx:        https://github.com/dnSpyEx/dnSpy/releases"
Write-Host " - ReClass.NET:    https://github.com/ReClassNET/ReClass.NET/releases"
Write-Host " - Scylla:         https://github.com/NtQuery/Scylla/releases"
Write-Host " - PCILeech FPGA:  https://github.com/ufrisk/pcileech"
Write-Host " - MemProcFS:      https://github.com/ufrisk/MemProcFS/releases"

Say "Done. Verify with: node dist/index.js and call list_re_backends."
