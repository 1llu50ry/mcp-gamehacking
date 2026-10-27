#!/bin/bash
# Ghidra RE Platform - Initial Setup Script (Bash)

set -e

SKIP_DOCKER_PULL=${1:-false}

echo "=== Ghidra RE Platform Setup ==="

# Check for required tools
echo "Checking prerequisites..."

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "ERROR: Docker is required but not installed"
    exit 1
fi
echo "✓ Docker is available"

# Check Docker Compose
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "ERROR: Docker Compose is required but not installed"
    exit 1
fi
echo "✓ Docker Compose is available"

# Create environment file if it doesn't exist
if [ ! -f ".env" ]; then
    echo "Creating .env file from template..."
    cp ".env.example" ".env"
    echo "✓ Created .env file"
else
    echo "✓ .env file already exists"
fi

# Create necessary directories
echo "Creating directory structure..."
for dir in "repo-data" "sync-logs" "backups"; do
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir"
    fi
done

# Create .gitkeep files to ensure directories are tracked
echo "# Ghidra repository data directory" > "repo-data/.gitkeep"
echo "# ret-sync logs directory" > "sync-logs/.gitkeep"
echo "# Backup storage directory" > "backups/.gitkeep"

echo "✓ Directory structure created"

# Pull Docker images (unless skipped)
if [ "$SKIP_DOCKER_PULL" != "true" ]; then
    echo "Pulling Docker images..."
    if command -v docker-compose &> /dev/null; then
        DOCKER_COMPOSE_CMD="docker-compose"
    else
        DOCKER_COMPOSE_CMD="docker compose"
    fi
    
    if $DOCKER_COMPOSE_CMD pull; then
        echo "✓ Docker images updated"
    else
        echo "WARNING: Could not pull Docker images. You may need to run this manually."
    fi
fi

# Test configuration
echo "Validating configuration..."
if [ -f "./test-connectivity.sh" ]; then
    echo "✓ All scripts are present"
else
    echo "WARNING: Some scripts may be missing"
fi

echo ""
echo "=== Setup Complete ==="
echo "Next steps:"
echo "1. Review .env configuration if needed"
echo "2. Run ./start.sh to start the platform"
echo "3. Run ./test-connectivity.sh to verify setup"
