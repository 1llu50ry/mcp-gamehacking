#!/bin/bash
# Reset BSim database to force re-initialization
# WARNING: This will DELETE ALL DATA in the BSim database!

set -e

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

# Get the script directory and project name for volume naming
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="$(basename "$SCRIPT_DIR" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')"
VOLUME_NAME="${PROJECT_NAME}_bsim_postgres_data"

# Load environment variables from .env if it exists
if [[ -f "$SCRIPT_DIR/.env" ]]; then
    # shellcheck disable=SC1091
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
fi

# Set defaults if not in .env
BSIM_DB_USER="${BSIM_DB_USER:-ben}"
BSIM_DB_NAME="${BSIM_DB_NAME:-bsim}"

# Parse arguments
FORCE=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --force|-f)
            FORCE=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--force]"
            echo ""
            echo "Reset BSim database to force re-initialization"
            echo ""
            echo "Options:"
            echo "  --force, -f    Skip confirmation prompt"
            echo "  --help, -h     Show this help message"
            echo ""
            echo "WARNING: This will DELETE ALL DATA in the BSim database!"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

echo -e "${CYAN}=========================================${NC}"
echo -e "${CYAN}BSim Database Reset Utility${NC}"
echo -e "${CYAN}=========================================${NC}"
echo ""

# Warning
echo -e "${RED}⚠️  WARNING: This will DELETE ALL DATA in the BSim database!${NC}"
echo ""
echo -e "${YELLOW}This script will:${NC}"
echo -e "${YELLOW}  1. Stop the bsim-postgres container${NC}"
echo -e "${YELLOW}  2. Remove the bsim_postgres_data volume (ALL DATA LOST)${NC}"
echo -e "${YELLOW}  3. Recreate the container (auto-initialization will run)${NC}"
echo ""

# Confirmation
if [[ "$FORCE" != "true" ]]; then
    read -p "Type 'yes' to continue or anything else to cancel: " confirmation
    if [[ "$confirmation" != "yes" ]]; then
        echo -e "${YELLOW}❌ Reset cancelled by user${NC}"
        exit 0
    fi
fi

echo ""
echo -e "${CYAN}🔄 Stopping bsim-postgres container...${NC}"
docker-compose stop bsim-postgres

echo -e "${CYAN}🗑️  Removing bsim-postgres container...${NC}"
docker-compose rm -f bsim-postgres

echo -e "${CYAN}🗑️  Removing bsim_postgres_data volume (${VOLUME_NAME})...${NC}"
docker volume rm "$VOLUME_NAME" 2>/dev/null || echo -e "${YELLOW}⚠️  Volume may not exist or already removed${NC}"

echo -e "${CYAN}🚀 Recreating bsim-postgres container...${NC}"
docker-compose up -d bsim-postgres

echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}✅ BSim database reset successfully!${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""

echo -e "${CYAN}⏳ Waiting for initialization to complete (~30 seconds)...${NC}"
echo -e "${GRAY}   Monitor progress: docker logs bsim-postgres -f${NC}"
echo ""

# Wait for container to be healthy
MAX_WAIT=60
WAITED=0
INTERVAL=5

while [[ $WAITED -lt $MAX_WAIT ]]; do
    sleep $INTERVAL
    WAITED=$((WAITED + INTERVAL))
    
    HEALTH=$(docker inspect bsim-postgres --format='{{.State.Health.Status}}' 2>/dev/null || echo "unknown")
    
    if [[ "$HEALTH" == "healthy" ]]; then
        echo -e "${GREEN}✅ Container is healthy!${NC}"
        break
    fi
    
    echo -e "${YELLOW}⏳ Still initializing... ($WAITED/$MAX_WAIT seconds)${NC}"
done

echo ""
echo -e "${CYAN}Next steps:${NC}"
echo -e "${GRAY}  1. Verify schema: docker exec -it bsim-postgres psql -U ${BSIM_DB_USER} -d ${BSIM_DB_NAME} -c '\\dt'${NC}"
echo -e "${GRAY}  2. Run tests: ./test-bsim-setup.sh${NC}"
echo -e "${GRAY}  3. Check logs: docker logs bsim-postgres${NC}"
echo ""
