#!/bin/bash
set -e

# Print diagnostic information
echo "Starting YaraFlux MCP Server Docker container..."
echo "Python version: $(python --version)"
echo "Pip version: $(pip --version)"
echo "Working directory: $(pwd)"

# Check for MCP package
echo "Checking MCP package..."
if pip list | grep -q mcp; then
    echo "MCP package is installed: $(pip list | grep mcp)"
else
    echo "MCP package is not installed. Installing..."
    pip install mcp
fi

# Check environment variables
echo "Checking environment variables..."
if [ -z "$JWT_SECRET_KEY" ]; then
    echo "WARNING: JWT_SECRET_KEY is not set. Using a random value."
    export JWT_SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")
fi

if [ -z "$ADMIN_PASSWORD" ]; then
    echo "WARNING: ADMIN_PASSWORD is not set. Using a random value."
    export ADMIN_PASSWORD=$(python -c "import secrets; print(secrets.token_urlsafe(16))")
fi

# Create data directories
echo "Creating data directories..."
mkdir -p data/rules/community data/rules/custom data/samples data/results

# Enable debug logging if requested
if [ "$DEBUG" = "true" ]; then
    echo "Debug mode enabled."
    export LOGGING_LEVEL=DEBUG
else
    export LOGGING_LEVEL=INFO
fi

# If command starts with an option, prepend yaraflux-mcp-server
if [ "${1:0:1}" = '-' ]; then
    set -- yaraflux-mcp-server "$@"
fi

# If first argument is run, use the run command
if [ "$1" = 'run' ]; then
    echo "Starting YaraFlux MCP Server..."
    exec yaraflux-mcp-server run --host 0.0.0.0 --port 8000 --debug
fi

# Run the command
exec "$@"
