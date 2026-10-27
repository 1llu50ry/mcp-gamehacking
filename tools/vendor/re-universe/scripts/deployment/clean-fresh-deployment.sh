#!/bin/bash

# Clean Fresh BSim Deployment Script
# Author: Claude Code Assistant
# Date: 2026-01-16
# Purpose: Complete clean deployment with data quality enforcement

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] ✅ $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] ⚠️  $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ❌ $1${NC}"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."

    # Check if Docker is running
    if ! docker ps >/dev/null 2>&1; then
        error "Docker is not running or not accessible"
        exit 1
    fi

    # Check required scripts exist
    local required_scripts=(
        "deploy-enhanced-bsim.sh"
        "data-quality-validator.sh"
        "updated-single-version-schema.sql"
    )

    for script in "${required_scripts[@]}"; do
        if [[ ! -f "$SCRIPT_DIR/$script" ]]; then
            error "Required script not found: $script"
            exit 1
        fi
    done

    success "Prerequisites check passed"
}

# Clean existing data
clean_existing_data() {
    log "Cleaning existing data..."

    echo "⚠️  This will destroy all existing BSim data!"
    echo "⚠️  Make sure you have backups if needed!"
    echo ""
    read -p "Continue with clean deployment? (y/N): " -n 1 -r
    echo

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Deployment cancelled by user"
        exit 0
    fi

    # Stop containers
    log "Stopping containers..."
    docker-compose down 2>/dev/null || true

    # Optional: Remove data volume for completely fresh start
    read -p "Remove database volume for completely fresh start? (y/N): " -n 1 -r
    echo

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log "Removing database volume..."
        docker volume rm re-universe_bsim-data 2>/dev/null || true
        success "Database volume removed"
    fi

    success "Existing data cleaned"
}

# Deploy infrastructure
deploy_infrastructure() {
    log "Deploying infrastructure..."

    # Start containers
    log "Starting containers..."
    docker-compose up -d

    # Wait for database to be ready
    log "Waiting for database to be ready..."
    local retries=30
    while [[ $retries -gt 0 ]]; do
        if docker exec bsim-postgres pg_isready -U ben >/dev/null 2>&1; then
            break
        fi
        sleep 2
        ((retries--))
    done

    if [[ $retries -eq 0 ]]; then
        error "Database failed to start within timeout"
        exit 1
    fi

    success "Infrastructure deployed"
}

# Deploy enhanced schema
deploy_enhanced_schema() {
    log "Deploying enhanced BSim schema..."

    # Deploy base and enhanced schema
    if "$SCRIPT_DIR/deploy-enhanced-bsim.sh" schema; then
        success "Enhanced schema deployed"
    else
        error "Failed to deploy enhanced schema"
        exit 1
    fi

    # Add strict data quality constraints
    log "Adding data quality constraints..."
    docker exec -i bsim-postgres psql -U ben -d bsim -c "
    -- Add version validation constraints for unified system
    ALTER TABLE exetable ADD CONSTRAINT IF NOT EXISTS require_game_version
    CHECK (game_version ~ '^1\.[0-9]+[a-z]?\$');

    -- Note: Filename constraint enforced by schema (unified naming convention)
    -- Most files: 1.03_D2Game.dll
    -- Exceptions: Classic_1.03_Game.exe, LoD_1.13c_Game.exe
    "

    success "Data quality constraints added"
}

# Validation and instructions
post_deployment_validation() {
    log "Running post-deployment validation..."

    if "$SCRIPT_DIR/data-quality-validator.sh" pre-ingestion; then
        success "Schema validation passed"
    else
        error "Schema validation failed"
        exit 1
    fi
}

# Display next steps
show_next_steps() {
    log "Clean deployment completed successfully!"

    echo ""
    echo "🎯 NEXT STEPS FOR DATA INGESTION:"
    echo ""
    echo "1. PREPARE YOUR DATA:"
    echo "   ⚠️  CRITICAL: Ensure all executables follow UNIFIED naming convention:"
    echo "   ✅ 1.03_D2Game.dll (Standard unified binary)"
    echo "   ✅ 1.13c_D2Common.dll (Standard unified binary)"
    echo "   ✅ Classic_1.03_Game.exe (Exception binary)"
    echo "   ✅ LoD_1.13c_Game.exe (Exception binary)"
    echo "   ❌ Classic_1.03_D2Game.dll (OLD FORMAT - WILL BE REJECTED)"
    echo "   ❌ D2Game.dll (NO VERSION - WILL BE REJECTED)"
    echo ""
    echo "2. RUN DATA INGESTION:"
    echo "   ./automate-ghidra-bsim-population.sh"
    echo ""
    echo "3. VALIDATE DATA AFTER INGESTION:"
    echo "   ./data-quality-validator.sh post-ingestion"
    echo ""
    echo "4. GENERATE BSim SIGNATURES (in Ghidra):"
    echo "   - Run GenerateBSimSignatures.java on all programs"
    echo "   - Run BSim_SimilarityWorkflow.java"
    echo "   - Run GenerateFunctionSimilarityMatrix.java"
    echo ""
    echo "5. REFRESH CROSS-VERSION DATA:"
    echo "   ./manage-unified-versions.sh full"
    echo ""
    echo "6. FINAL VALIDATION:"
    echo "   ./data-quality-validator.sh full"
    echo ""
    echo "📋 IMPORTANT NOTES:"
    echo "   - Database now uses UNIFIED version system (no family separation)"
    echo "   - Most binaries use unified naming: 1.03_D2Game.dll"
    echo "   - Only Game.exe and Diablo_II.exe use family prefixes"
    echo "   - Unversioned files will be rejected during ingestion"
    echo "   - All cross-version analysis uses unified version display"
    echo "   - API serves unified version data"
    echo ""
    echo "🔍 MONITORING:"
    echo "   - Check logs during ingestion for rejected files"
    echo "   - Use ./data-quality-validator.sh at any time"
    echo "   - Test API: curl \"http://localhost:8081/api/health\""
}

# Main deployment function
main() {
    case "${1:-full}" in
        "full")
            log "Starting complete clean BSim deployment..."

            check_prerequisites
            clean_existing_data
            deploy_infrastructure
            deploy_enhanced_schema
            post_deployment_validation
            show_next_steps

            success "🚀 Clean deployment completed successfully!"
            ;;
        "infrastructure")
            check_prerequisites
            deploy_infrastructure
            success "Infrastructure deployment completed"
            ;;
        "schema")
            deploy_enhanced_schema
            post_deployment_validation
            success "Schema deployment completed"
            ;;
        "validate")
            post_deployment_validation
            ;;
        "help"|"-h"|"--help")
            echo "Clean Fresh BSim Deployment Script"
            echo ""
            echo "Usage: $0 [command]"
            echo ""
            echo "Commands:"
            echo "  full           - Complete clean deployment [default]"
            echo "  infrastructure - Deploy infrastructure only"
            echo "  schema         - Deploy schema only"
            echo "  validate       - Run validation only"
            echo "  help           - Show this help message"
            echo ""
            echo "⚠️  WARNING: 'full' will destroy existing data!"
            ;;
        *)
            error "Unknown command: $1"
            echo "Use '$0 help' for usage information"
            exit 1
            ;;
    esac
}

# Script entry point
main "$@"