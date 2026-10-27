#!/bin/bash
set -e

echo "Starting YaraFlux MCP Server"
echo "Python version: $(python3 --version)"
echo "YARA version: $(yara --version)"

# List installed packages for debugging
echo "Checking MCP installation:"
if python3 -c "import mcp" &>/dev/null; then
    echo "MCP is properly installed"
else
    echo "ERROR: MCP module not found"
    exit 1
fi

# Check PYTHONPATH
echo "PYTHONPATH: $PYTHONPATH"

# Run the YaraFlux MCP server with the provided arguments
exec  python3 -m yaraflux_mcp_server.mcp_server --transport stdio

