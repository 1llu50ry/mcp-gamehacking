#!/bin/bash
# RE Analysis Platform - Stop Script

echo -e "\033[36mStopping Ghidra Server...\033[0m"
# Check if docker-compose command exists, otherwise use docker compose
if command -v docker-compose &> /dev/null; then
    docker-compose down
else
    docker compose down
fi

echo -e "\033[33mCleaning up volumes (optional)...\033[0m"
read -p "Do you want to remove volumes? This will delete all analysis data. (y/N): " response
if [[ "$response" =~ ^[Yy]$ ]]; then
    if command -v docker-compose &> /dev/null; then
        docker-compose down -v
    else
        docker compose down -v
    fi
    echo -e "\033[31mVolumes removed\033[0m"
else
    echo -e "\033[32mVolumes preserved\033[0m"
fi
