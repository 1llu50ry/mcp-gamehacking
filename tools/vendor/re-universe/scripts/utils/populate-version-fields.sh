#!/bin/bash

# Populate Version Fields Script
# Author: Claude Code Assistant
# Date: 2026-01-16
# Purpose: Populate separate version fields during BSim ingestion

set -e

# Configuration
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-bsim}"
DB_USER="${DB_USER:-ben}"
DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD must be set}"

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
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$1"
}

run_sql_file() {
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$1"
}

# Check database connectivity
check_database() {
    log "Checking database connectivity..."
    if run_sql "SELECT 1;" >/dev/null 2>&1; then
        success "Database connection successful"
    else
        error "Cannot connect to database"
        exit 1
    fi
}

# Populate version fields from filenames
populate_version_fields() {
    log "Populating version fields from executable filenames..."

    local affected_rows
    affected_rows=$(run_sql "SELECT populate_version_fields_from_filename();" | grep -o '[0-9]\+' | head -1)

    if [[ $affected_rows -gt 0 ]]; then
        success "Updated version fields for $affected_rows executable records"
    else
        warn "No new records updated (all may already be populated)"
    fi

    # Show current version distribution
    log "Current version distribution:"
    run_sql "
    SELECT
        version_family,
        game_version,
        COUNT(*) as count
    FROM exetable
    WHERE version_family IS NOT NULL AND game_version IS NOT NULL
    GROUP BY version_family, game_version
    ORDER BY version_family, game_version;
    "
}

# Validate version field constraints
validate_version_fields() {
    log "Validating version field constraints..."

    # Check for invalid game versions
    local invalid_versions
    invalid_versions=$(run_sql "SELECT COUNT(*) FROM exetable WHERE game_version IS NOT NULL AND game_version !~ '^1\.[0-9]+[a-z]?\$';" | grep -o '[0-9]\+' | head -1)

    if [[ $invalid_versions -gt 0 ]]; then
        warn "$invalid_versions executables have invalid game_version format"
        run_sql "SELECT name_exec, game_version FROM exetable WHERE game_version IS NOT NULL AND game_version !~ '^1\.[0-9]+[a-z]?\$' LIMIT 5;"
    else
        success "All game_version values are valid"
    fi

    # Check for invalid version families
    local invalid_families
    invalid_families=$(run_sql "SELECT COUNT(*) FROM exetable WHERE version_family IS NOT NULL AND version_family NOT IN ('Classic', 'LoD', 'D2R');" | grep -o '[0-9]\+' | head -1)

    if [[ $invalid_families -gt 0 ]]; then
        warn "$invalid_families executables have invalid version_family values"
        run_sql "SELECT name_exec, version_family FROM exetable WHERE version_family IS NOT NULL AND version_family NOT IN ('Classic', 'LoD', 'D2R') LIMIT 5;"
    else
        success "All version_family values are valid"
    fi
}

# Refresh cross-version data
refresh_cross_version_data() {
    log "Refreshing cross-version materialized views..."

    if run_sql "SELECT refresh_cross_version_data();" >/dev/null 2>&1; then
        success "Cross-version data refreshed successfully"
    else
        error "Failed to refresh cross-version data"
        return 1
    fi

    # Show updated statistics
    log "Updated cross-version statistics:"
    run_sql "SELECT * FROM cross_version_statistics;"
}

# Manual version field population (for specific files)
manual_populate() {
    local name_exec="$1"
    local version_family="$2"
    local game_version="$3"

    if [[ -z "$name_exec" || -z "$version_family" || -z "$game_version" ]]; then
        error "Usage: $0 manual <name_exec> <version_family> <game_version>"
        error "Example: $0 manual D2Game.dll LoD 1.13c"
        exit 1
    fi

    log "Manually setting version fields for $name_exec"

    local updated
    updated=$(run_sql "
    UPDATE exetable
    SET
        version_family = '$version_family',
        game_version = '$game_version'
    WHERE name_exec = '$name_exec';
    " | grep "UPDATE" | cut -d' ' -f2)

    if [[ $updated -gt 0 ]]; then
        success "Updated $updated executable(s): $name_exec -> $version_family/$game_version"
    else
        warn "No executables updated. Check if '$name_exec' exists in database."
    fi
}

# Show current status
show_status() {
    log "Version Field Population Status:"

    echo ""
    echo "=== Executable Version Distribution ==="
    run_sql "
    SELECT
        'Total Executables' as metric,
        COUNT(*) as count
    FROM exetable
    UNION ALL
    SELECT
        'With Version Family' as metric,
        COUNT(*) as count
    FROM exetable WHERE version_family IS NOT NULL
    UNION ALL
    SELECT
        'With Game Version' as metric,
        COUNT(*) as count
    FROM exetable WHERE game_version IS NOT NULL
    UNION ALL
    SELECT
        'Fully Populated' as metric,
        COUNT(*) as count
    FROM exetable WHERE version_family IS NOT NULL AND game_version IS NOT NULL;
    "

    echo ""
    echo "=== Version Family Distribution ==="
    run_sql "
    SELECT
        COALESCE(version_family, 'NULL') as version_family,
        COUNT(*) as count,
        ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM exetable), 2) as percentage
    FROM exetable
    GROUP BY version_family
    ORDER BY count DESC;
    "

    echo ""
    echo "=== Cross-Version Function Analysis ==="
    run_sql "SELECT * FROM cross_version_statistics;"
}

# Main function
main() {
    case "${1:-auto}" in
        "auto")
            log "Starting automatic version field population..."
            check_database
            populate_version_fields
            validate_version_fields
            refresh_cross_version_data
            show_status
            success "Version field population completed successfully"
            ;;
        "manual")
            check_database
            manual_populate "$2" "$3" "$4"
            ;;
        "validate")
            check_database
            validate_version_fields
            ;;
        "refresh")
            check_database
            refresh_cross_version_data
            ;;
        "status")
            check_database
            show_status
            ;;
        "help"|"-h"|"--help")
            echo "Usage: $0 [command]"
            echo ""
            echo "Commands:"
            echo "  auto                          - Automatic population from filenames (default)"
            echo "  manual <name> <family> <ver>  - Manually set version for specific executable"
            echo "  validate                      - Validate version field constraints"
            echo "  refresh                       - Refresh cross-version materialized views"
            echo "  status                        - Show current version field status"
            echo "  help                          - Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                            # Auto-populate from filenames"
            echo "  $0 manual D2Game.dll LoD 1.13c"
            echo "  $0 status"
            echo "  $0 refresh"
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