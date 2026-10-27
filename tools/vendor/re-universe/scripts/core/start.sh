#!/bin/bash
# RE Analysis Platform - Start Script

echo -e "\033[36mStarting Ghidra Server...\033[0m"
# Check if docker-compose command exists, otherwise use docker compose
if command -v docker-compose &> /dev/null; then
    docker-compose up -d
else
    docker compose up -d
fi

echo -e "\033[33mWaiting for server initialization...\033[0m"
sleep 60

echo -e "\033[36mRunning connectivity tests...\033[0m"
# Test port connectivity
if nc -z localhost 13100 2>/dev/null; then
    echo -e "\033[32m✓ Port 13100 is accessible\033[0m"
else
    echo -e "\033[31m✗ Cannot connect to port 13100\033[0m"
    exit 1
fi

echo -e "\033[32mGhidra Server is ready!\033[0m"
echo -e "\033[33mConnect to: localhost:13100\033[0m"
echo -e "\033[33mCredentials: admin/changeme\033[0m"
