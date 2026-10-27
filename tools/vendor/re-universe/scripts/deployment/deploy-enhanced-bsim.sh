#!/bin/bash

# Enhanced BSim Deployment Script
# Author: Claude Code Assistant
# Date: 2026-01-16
# Purpose: Deploy enhanced BSim schema with separate version fields for clean installations

set -e

# Configuration
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-bsim}"
DB_USER="${DB_USER:-ben}"
DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD must be set}"

# Script directory
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

# Database connection function
run_sql() {
    # Try Docker exec first, fallback to direct psql
    if docker ps | grep -q "bsim-postgres"; then
        docker exec -i bsim-postgres psql -U "$DB_USER" -d "$DB_NAME" -c "$1"
    else
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$1"
    fi
}

run_sql_file() {
    # Try Docker exec first, fallback to direct psql
    if docker ps | grep -q "bsim-postgres"; then
        docker exec -i bsim-postgres psql -U "$DB_USER" -d "$DB_NAME" -f "$1"
    else
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$1"
    fi
}

# Copy SQL file to container if using Docker
copy_to_container() {
    local file="$1"
    local container_name="${2:-bsim-postgres}"

    if docker ps | grep -q "$container_name"; then
        log "Copying $file to container $container_name"
        docker cp "$file" "$container_name:/tmp/$(basename "$file")"
        echo "/tmp/$(basename "$file")"
    else
        echo "$file"
    fi
}

run_sql_in_container() {
    local file="$1"
    local container_name="${2:-bsim-postgres}"

    if docker ps | grep -q "$container_name"; then
        local container_file=$(copy_to_container "$file" "$container_name")
        docker exec -i "$container_name" psql -U "$DB_USER" -d "$DB_NAME" -f "$container_file"
    else
        run_sql_file "$file"
    fi
}

# Check database connectivity
check_database() {
    log "Checking database connectivity..."
    if docker exec bsim-postgres psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" >/dev/null 2>&1; then
        success "Database connection successful"
    else
        error "Cannot connect to database"
        exit 1
    fi
}

# Deploy base BSim schema (if not exists)
deploy_base_schema() {
    log "Checking for base BSim schema..."

    if run_sql "SELECT 1 FROM information_schema.tables WHERE table_name = 'desctable';" | grep -q "1"; then
        success "Base BSim schema already exists"
    else
        warn "Base BSim schema not found"
        if [[ -f "$SCRIPT_DIR/create-bsim-schema.sql" ]]; then
            log "Deploying base BSim schema..."
            run_sql_in_container "$SCRIPT_DIR/create-bsim-schema.sql"
            success "Base BSim schema deployed"
        else
            error "Base BSim schema file not found: $SCRIPT_DIR/create-bsim-schema.sql"
            exit 1
        fi
    fi
}

# Deploy enhanced schema
deploy_enhanced_schema() {
    log "Deploying enhanced BSim schema..."

    if [[ -f "$SCRIPT_DIR/updated-single-version-schema.sql" ]]; then
        run_sql_in_container "$SCRIPT_DIR/updated-single-version-schema.sql"
        success "Unified version schema deployed"
    else
        error "Schema file not found: $SCRIPT_DIR/updated-single-version-schema.sql"
        exit 1
    fi
}

# Initialize BSim database if needed
initialize_bsim_database() {
    log "Checking if BSim database needs initialization..."

    local exe_count
    exe_count=$(run_sql "SELECT COUNT(*) FROM exetable;" 2>/dev/null | grep -o '[0-9]\+' | head -1 || echo "0")

    if [[ $exe_count -eq 0 ]]; then
        warn "BSim database appears empty"

        # Check if we have LSH database file
        if [[ -f "$SCRIPT_DIR/large_32.xml" ]]; then
            log "Creating BSim database from XML template..."
            "$SCRIPT_DIR/create-large-bsim.sh"
            success "BSim database initialized"
        else
            warn "No BSim XML template found. Database initialized with schema only."
        fi
    else
        success "BSim database already contains $exe_count executables"
    fi
}

# Populate version fields
populate_version_fields() {
    log "Populating version fields from executable filenames..."

    local affected_rows
    affected_rows=$(run_sql "SELECT populate_version_fields_from_filename();" | grep -o '[0-9]\+' | head -1 || echo "0")

    if [[ $affected_rows -gt 0 ]]; then
        success "Populated version fields for $affected_rows executables"
    else
        success "Version fields already populated"
    fi

    # Show version distribution
    log "Version distribution summary:"
    run_sql "
    SELECT
        'Version Summary' as metric,
        COUNT(*) FILTER (WHERE version_family IS NOT NULL) as with_family,
        COUNT(*) FILTER (WHERE game_version IS NOT NULL) as with_version,
        COUNT(*) as total
    FROM exetable;
    "
}

# Deploy similarity workflow
deploy_similarity_workflow() {
    log "Checking similarity workflow deployment..."

    local sim_count
    sim_count=$(run_sql "SELECT COUNT(*) FROM function_similarity_matrix;" 2>/dev/null | grep -o '[0-9]\+' | head -1 || echo "0")

    if [[ $sim_count -eq 0 ]]; then
        warn "No similarity data found"
        if [[ -f "$SCRIPT_DIR/update-bsim-similarity-schema.sql" ]]; then
            log "Deploying similarity schema..."
            run_sql_in_container "$SCRIPT_DIR/update-bsim-similarity-schema.sql"
            success "Similarity schema deployed"
        fi
    else
        success "Similarity data contains $sim_count relationships"
    fi
}

# Refresh materialized views
refresh_views() {
    log "Refreshing materialized views..."

    if run_sql "SELECT refresh_cross_version_data();" >/dev/null 2>&1; then
        success "Materialized views refreshed"
    else
        error "Failed to refresh materialized views"
        return 1
    fi
}

# Validate deployment
validate_deployment() {
    log "Validating enhanced BSim deployment..."

    # Check tables exist
    local required_tables=("desctable" "exetable" "enhanced_signatures" "function_similarity_matrix" "function_evolution" "cross_version_function_groups")

    for table in "${required_tables[@]}"; do
        if run_sql "SELECT 1 FROM information_schema.tables WHERE table_name = '$table';" | grep -q "1"; then
            success "Table '$table' exists"
        else
            error "Missing required table: $table"
            return 1
        fi
    done

    # Check materialized view
    if run_sql "SELECT 1 FROM information_schema.tables WHERE table_name = 'cross_version_functions' AND table_type = 'MATERIALIZED VIEW';" | grep -q "1"; then
        success "Materialized view 'cross_version_functions' exists"
    else
        error "Missing materialized view: cross_version_functions"
        return 1
    fi

    # Check constraints
    local constraint_count
    constraint_count=$(run_sql "SELECT COUNT(*) FROM information_schema.check_constraints WHERE constraint_name LIKE 'valid_%';" | grep -o '[0-9]\+' | head -1)

    if [[ $constraint_count -gt 0 ]]; then
        success "Version field constraints active ($constraint_count found)"
    else
        warn "No version field constraints found"
    fi

    # Check indexes
    local index_count
    index_count=$(run_sql "SELECT COUNT(*) FROM pg_indexes WHERE indexname LIKE 'idx_%version%';" | grep -o '[0-9]\+' | head -1)

    if [[ $index_count -gt 0 ]]; then
        success "Version field indexes active ($index_count found)"
    else
        warn "No version field indexes found"
    fi
}

# Show deployment summary
show_summary() {
    log "Enhanced BSim Deployment Summary:"

    echo ""
    echo "=== Database Statistics ==="
    run_sql "
    SELECT
        'Executables' as type,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE version_family IS NOT NULL) as with_family,
        COUNT(*) FILTER (WHERE game_version IS NOT NULL) as with_version
    FROM exetable
    UNION ALL
    SELECT
        'Functions' as type,
        COUNT(*) as total,
        NULL as with_family,
        NULL as with_version
    FROM desctable;
    "

    echo ""
    echo "=== Cross-Version Analysis ==="
    run_sql "SELECT * FROM cross_version_statistics;"

    echo ""
    echo "=== Version Distribution ==="
    run_sql "
    SELECT
        version_family,
        COUNT(*) as executables,
        COUNT(DISTINCT game_version) as versions
    FROM exetable
    WHERE version_family IS NOT NULL
    GROUP BY version_family
    ORDER BY version_family;
    "
}

# Main deployment function
main() {
    case "${1:-full}" in
        "full")
            log "Starting full enhanced BSim deployment..."
            check_database
            deploy_base_schema
            deploy_enhanced_schema
            initialize_bsim_database
            populate_version_fields
            deploy_similarity_workflow
            refresh_views
            validate_deployment
            show_summary
            success "Enhanced BSim deployment completed successfully!"
            ;;
        "schema")
            log "Deploying schema only..."
            check_database
            deploy_base_schema
            deploy_enhanced_schema
            validate_deployment
            success "Schema deployment completed!"
            ;;
        "migrate")
            log "Migrating existing installation..."
            check_database
            deploy_enhanced_schema
            populate_version_fields
            refresh_views
            validate_deployment
            show_summary
            success "Migration completed successfully!"
            ;;
        "validate")
            check_database
            validate_deployment
            show_summary
            ;;
        "refresh")
            check_database
            populate_version_fields
            refresh_views
            show_summary
            ;;
        "help"|"-h"|"--help")
            echo "Enhanced BSim Deployment Script"
            echo ""
            echo "Usage: $0 [command]"
            echo ""
            echo "Commands:"
            echo "  full      - Complete deployment (schema + data + validation) [default]"
            echo "  schema    - Deploy enhanced schema only"
            echo "  migrate   - Migrate existing installation to enhanced version"
            echo "  validate  - Validate current deployment"
            echo "  refresh   - Refresh materialized views and data"
            echo "  help      - Show this help message"
            echo ""
            echo "Environment Variables:"
            echo "  DB_HOST     - Database host (default: localhost)"
            echo "  DB_PORT     - Database port (default: 5432)"
            echo "  DB_NAME     - Database name (default: bsim)"
            echo "  DB_USER     - Database user (default: ben)"
            echo "  DB_PASSWORD - Database password (required)"
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