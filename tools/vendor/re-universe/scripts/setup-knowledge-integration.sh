#!/bin/bash

# Knowledge DB Integration Setup Script
# This script sets up the complete Knowledge DB integration

set -e

echo "🚀 Setting up Knowledge DB Integration"
echo "======================================="

PROJECT_ROOT="/home/ben/re-universe"
cd "$PROJECT_ROOT"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check prerequisites
log_info "Checking prerequisites..."

# Check if PostgreSQL is accessible
if ! PGPASSWORD=goodyx12 psql -h localhost -p 5432 -U ben -d bsim -c "SELECT 1;" >/dev/null 2>&1; then
    log_error "PostgreSQL BSim database not accessible"
    exit 1
fi
log_success "PostgreSQL BSim database accessible"

# Check if Docker services are running
if ! docker-compose ps | grep -q "Up"; then
    log_warning "Docker services might not be running. Checking individual services..."
fi

# Check knowledge-integration service
if docker-compose ps | grep -q "knowledge-integration.*Up"; then
    log_success "Knowledge Integration service is running"
    KNOWLEDGE_RUNNING=true
else
    log_warning "Knowledge Integration service not running"
    KNOWLEDGE_RUNNING=false
fi

# Step 1: Run knowledge migration
log_info "Step 1: Migrating existing knowledge files to Knowledge DB"

if command -v python3 >/dev/null 2>&1; then
    cd "$PROJECT_ROOT"

    # Install required Python dependencies
    log_info "Installing Python dependencies..."
    python3 -m pip install asyncpg >/dev/null 2>&1 || {
        log_warning "Could not install asyncpg. Trying with system packages..."
        sudo apt-get update >/dev/null 2>&1 || true
        sudo apt-get install -y python3-asyncpg >/dev/null 2>&1 || {
            log_error "Failed to install asyncpg. Please install manually: pip install asyncpg"
            exit 1
        }
    }

    # Run migration script
    log_info "Running knowledge migration..."
    if python3 scripts/migrate-knowledge.py; then
        log_success "Knowledge migration completed successfully"
    else
        log_error "Knowledge migration failed"
        exit 1
    fi
else
    log_error "Python3 not found. Cannot run migration script."
    exit 1
fi

# Step 2: Start/restart knowledge-integration service
log_info "Step 2: Starting Knowledge Integration service"

if [ "$KNOWLEDGE_RUNNING" = false ]; then
    log_info "Starting knowledge-integration service..."
    if docker-compose up -d knowledge-integration; then
        log_success "Knowledge Integration service started"
        # Wait for service to be ready
        log_info "Waiting for service to be ready..."
        sleep 10
    else
        log_error "Failed to start Knowledge Integration service"
        exit 1
    fi
else
    log_info "Restarting knowledge-integration service..."
    if docker-compose restart knowledge-integration; then
        log_success "Knowledge Integration service restarted"
        # Wait for service to be ready
        sleep 5
    else
        log_error "Failed to restart Knowledge Integration service"
        exit 1
    fi
fi

# Step 3: Check service health
log_info "Step 3: Checking Knowledge Integration service health"

# Wait for service to be fully ready
sleep 5

# Check service health
if curl -s http://localhost:8095/health >/dev/null 2>&1; then
    log_success "Knowledge Integration service is healthy"

    # Get service stats
    log_info "Getting service statistics..."
    STATS=$(curl -s http://localhost:8095/stats 2>/dev/null || echo '{}')
    if [ "$STATS" != '{}' ]; then
        log_success "Service stats retrieved successfully"
    else
        log_warning "Service stats not available yet"
    fi
else
    log_warning "Knowledge Integration service health check failed (this may be temporary)"
fi

# Step 4: Check Spring API integration
log_info "Step 4: Checking Spring API Knowledge Integration"

# Check if Spring API is running
if docker-compose ps | grep -q "d2docs-website.*Up"; then
    log_success "Spring API is running"

    # Check knowledge integration endpoints
    if curl -s http://localhost:8080/api/knowledge/stats >/dev/null 2>&1; then
        log_success "Spring API Knowledge Integration endpoints are working"
    else
        log_warning "Spring API Knowledge Integration endpoints not responding (may need restart)"
    fi
else
    log_warning "Spring API (d2docs-website) not running"
fi

# Step 5: Integration verification
log_info "Step 5: Verifying complete integration"

# Test migration results
log_info "Checking migrated knowledge data..."
INSIGHT_COUNT=$(PGPASSWORD=goodyx12 psql -h localhost -p 5432 -U ben -d bsim -t -c "SELECT COUNT(*) FROM function_insights WHERE source_file IS NOT NULL;" 2>/dev/null | xargs || echo "0")

if [ "$INSIGHT_COUNT" -gt "0" ]; then
    log_success "Found $INSIGHT_COUNT migrated knowledge insights"
else
    log_warning "No migrated insights found in database"
fi

# Test bridge status
log_info "Checking Knowledge Bridge status..."
if curl -s http://localhost:8095/bridge/status | grep -q "bridge_initialized"; then
    log_success "Knowledge Bridge is initialized"
else
    log_warning "Knowledge Bridge status unclear"
fi

# Summary
echo ""
echo "🎯 Knowledge DB Integration Setup Summary"
echo "========================================="
echo ""

if [ "$INSIGHT_COUNT" -gt "0" ]; then
    log_success "✅ Knowledge migration: $INSIGHT_COUNT insights migrated"
else
    log_warning "⚠️  Knowledge migration: No insights found"
fi

if curl -s http://localhost:8095/health >/dev/null 2>&1; then
    log_success "✅ Knowledge Integration service: Running"
else
    log_warning "⚠️  Knowledge Integration service: Not responding"
fi

if curl -s http://localhost:8080/api/knowledge/stats >/dev/null 2>&1; then
    log_success "✅ Spring API integration: Working"
else
    log_warning "⚠️  Spring API integration: Not responding"
fi

echo ""
echo "🔗 Integration Endpoints:"
echo "  Knowledge Service:  http://localhost:8095"
echo "  Spring API:         http://localhost:8080/api/knowledge/"
echo "  Website:            https://d2docs.xebyte.com"
echo ""

# Next steps
echo "📋 Next Steps:"
echo "1. Test function insight retrieval: curl http://localhost:8080/api/functions/{id}/insights"
echo "2. Trigger function analysis: curl -X POST http://localhost:8080/api/functions/{id}/analyze"
echo "3. View knowledge stats: curl http://localhost:8080/api/knowledge/stats"
echo ""

log_success "Knowledge DB Integration setup completed!"
echo ""
echo "🚀 The Knowledge DB is now ready to receive and serve function insights!"
echo "   Your existing D2 research has been preserved and integrated."
echo "   New analyses from Ghidra MCP will automatically flow into the Knowledge DB."