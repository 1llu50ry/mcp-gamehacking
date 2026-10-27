#!/bin/bash

# Ghidra Server connectivity test script
# Bash equivalent of test-connectivity.ps1

set -e  # Exit on any error

# Load environment variables from .env file if it exists
load_env_file() {
    if [ -f ".env" ]; then
        echo "Loading environment variables from .env file..."
        while IFS='=' read -r key value; do
            # Skip comments and empty lines
            [[ $key =~ ^[[:space:]]*# ]] && continue
            [[ -z "$key" ]] && continue

            # Remove inline comments and trim whitespace
            value=$(echo "$value" | sed 's/[[:space:]]*#.*$//' | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')
            key=$(echo "$key" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')

            if [ -n "$key" ] && [ -n "$value" ]; then
                export "$key=$value"
            fi
        done < ".env"
    fi
}

# Load environment variables
load_env_file

# Get configuration values (with defaults)
GHIDRA_PORT=${GHIDRA_PORT:-"13100"}
GHIDRA_USERS=${GHIDRA_USERS:-"admin"}
GHIDRA_PASSWORD="changeme"  # Ghidra server always uses this default password
CONTAINER_NAME="ghidra-server"

echo "Testing Ghidra Server connectivity..."
echo "Port: $GHIDRA_PORT | Container: $CONTAINER_NAME"

# Test 1: Container status
echo ""
echo "Test 1: Checking Docker container status..."
if command -v docker >/dev/null 2>&1 && docker ps --format "table {{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
    echo "OK - Ghidra Server container is running"
else
    container_status=$(docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "not found")
    echo "ERROR - Ghidra Server container is not running"
    echo "Container status: $container_status"
    exit 1
fi

# Test 2: Port connectivity
echo ""
echo "Test 2: Testing port $GHIDRA_PORT connectivity..."

# Try different methods for port testing
port_test_success=false

# Method 1: Use nc (netcat) if available
if command -v nc >/dev/null 2>&1; then
    if nc -z localhost "$GHIDRA_PORT" 2>/dev/null; then
        port_test_success=true
    fi
# Method 2: Use nmap if available
elif command -v nmap >/dev/null 2>&1; then
    if nmap -p "$GHIDRA_PORT" localhost 2>/dev/null | grep -q "open"; then
        port_test_success=true
    fi
# Method 3: Use timeout with bash
elif command -v timeout >/dev/null 2>&1; then
    if timeout 5 bash -c "</dev/tcp/localhost/$GHIDRA_PORT" 2>/dev/null; then
        port_test_success=true
    fi
# Method 4: Fallback - try to connect using curl or similar
else
    if command -v curl >/dev/null 2>&1; then
        if curl -f "http://localhost:$GHIDRA_PORT/" >/dev/null 2>&1; then
            port_test_success=true
        fi
    fi
fi

if [ "$port_test_success" = true ]; then
    echo "OK - Port $GHIDRA_PORT is accessible"
else
    echo "ERROR - Cannot connect to port $GHIDRA_PORT"
    exit 1
fi

# Test 3: Server health
echo ""
echo "Test 3: Checking server logs..."
if command -v docker >/dev/null 2>&1; then
    logs=$(docker logs "$CONTAINER_NAME" --tail 5 2>&1 || echo "")

    if echo "$logs" | grep -q "Registered Ghidra Server"; then
        echo "OK - Ghidra Server is registered and ready"
    else
        echo "WARNING - Server may still be initializing"
        echo "Recent logs:"
        echo "$logs" | head -3
    fi
else
    echo "WARNING - Docker command not available, skipping log check"
fi

echo ""
echo "=== Connection Details ==="
echo "Server: localhost:$GHIDRA_PORT"
echo "Username: $GHIDRA_USERS"
echo "Password: $GHIDRA_PASSWORD"

echo ""
echo "=== Next Steps ==="
echo "1. Open Ghidra"
echo "2. File -> New Project -> Shared Project"
echo "3. Server: localhost:$GHIDRA_PORT"
echo "4. Use $GHIDRA_USERS/$GHIDRA_PASSWORD credentials"
echo "5. Create test project"

echo ""
echo "All tests completed!"
