#!/bin/bash
# Example script to install YaraFlux MCP Server via Smithery

# Check if Smithery CLI is installed
if ! command -v npx &> /dev/null; then
    echo "Error: npx is not installed. Please install Node.js and npm first."
    exit 1
fi

# Install YaraFlux MCP Server via Smithery
echo "Installing YaraFlux MCP Server via Smithery..."
npx -y @smithery/cli install yaraflux-mcp-server --client claude

# Check installation result
if [ $? -eq 0 ]; then
    echo "Installation successful!"
    echo "YaraFlux MCP Server is now available to Claude Desktop."
    echo "Restart Claude Desktop to use the new MCP server."
else
    echo "Installation failed. Please see error messages above."
fi
