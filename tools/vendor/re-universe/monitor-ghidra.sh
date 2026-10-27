#!/bin/bash
echo "=== Ghidra Server Monitor Started at $(date) ==="
echo "Monitoring for container exits, crashes, or disconnections..."
echo

while true; do
    # Check if container is running
    if ! docker ps | grep -q ghidra-server; then
        echo "$(date): ❌ ALERT: Ghidra server container is NOT RUNNING!"
        echo "Last 20 lines of Docker events:"
        docker events --since 2m --until now | grep -i ghidra || echo "No Ghidra events found"
        echo
        echo "Attempting restart..."
        docker-compose up -d ghidra-server
        echo "Restart command issued."
        echo "----------------------------------------"
    else
        # Check connectivity
        if nc -zv ${GHIDRA_SERVER_HOST:-localhost} ${GHIDRA_SERVER_PORT:-13100} 2>/dev/null; then
            # Get resource usage
            STATS=$(docker stats --no-stream ghidra-server --format "CPU: {{.CPUPerc}}, Memory: {{.MemUsage}}")
            echo "$(date): ✅ Server running - $STATS"
        else
            echo "$(date): ⚠️  Server container running but port 13100 not accessible"
        fi
    fi
    sleep 15
done