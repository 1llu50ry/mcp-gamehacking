#!/bin/bash

# Unified Version Management Script
# Author: Claude Code Assistant
# Date: 2026-01-16
# Purpose: Manage version fields in unified BSim system

set -e

# Configuration
DB_CONTAINER="${DB_CONTAINER:-bsim-postgres}"
DB_NAME="${DB_NAME:-bsim}"
DB_USER="${DB_USER:-ben}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
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
    docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "$1"
}

# Populate version fields using unified extraction function
populate_versions() {
    log "Populating version fields using unified extraction..."

    local affected_rows
    affected_rows=$(run_sql "SELECT populate_version_fields_from_filename();" | grep -o '[0-9]\+' | head -1)

    success "Updated version fields for $affected_rows executable records"

    # Show version distribution
    log "Current version distribution:"
    run_sql "
    SELECT
        game_version,
        COUNT(*) as executables,
        COUNT(*) FILTER (WHERE name_exec ~ '^1\\.[0-9]+[a-z]?_') AS unified_format,
        COUNT(*) FILTER (WHERE name_exec ~ '^(Classic|LoD)_') AS exception_format
    FROM exetable
    WHERE game_version IS NOT NULL
    GROUP BY game_version
    ORDER BY game_version;
    "
}

# Validate naming convention compliance
validate_naming() {
    log "Validating unified naming convention compliance..."

    local compliant_count
    local total_count

    compliant_count=$(run_sql "
    SELECT COUNT(*)
    FROM exetable
    WHERE (
        -- Standard unified binaries: 1.03_D2Game.dll
        name_exec ~ '^1\\.[0-9]+[a-z]?_[A-Za-z0-9_]+\\.(dll|exe)\$'
        OR
        -- Exception binaries: Classic_1.03_Game.exe, LoD_1.13c_Game.exe
        name_exec ~ '^(Classic|LoD)_1\\.[0-9]+[a-z]?_(Game|Diablo_II)\\.(exe|dll)\$'
    );
    " | grep -o '[0-9]\+' | head -1)

    total_count=$(run_sql "SELECT COUNT(*) FROM exetable;" | grep -o '[0-9]\+' | head -1)

    if [[ $compliant_count -eq $total_count ]]; then
        success "All $total_count executables follow unified naming convention"
    else
        local non_compliant=$((total_count - compliant_count))
        warn "$non_compliant out of $total_count executables don't follow naming convention"

        log "Examples of non-compliant files:"
        run_sql "
        SELECT name_exec
        FROM exetable
        WHERE NOT (
            name_exec ~ '^1\\.[0-9]+[a-z]?_[A-Za-z0-9_]+\\.(dll|exe)\$'
            OR
            name_exec ~ '^(Classic|LoD)_1\\.[0-9]+[a-z]?_(Game|Diablo_II)\\.(exe|dll)\$'
        )
        LIMIT 5;
        "
    fi
}

# Show version extraction examples
show_examples() {
    log "Testing version extraction examples..."

    run_sql "
    SELECT
        'Standard Binary' as type,
        '1.03_D2Game.dll' as example,
        extract_version_from_name('1.03_D2Game.dll') as extracted_version,
        is_exception_binary('1.03_D2Game.dll') as is_exception,
        get_family_for_exception('1.03_D2Game.dll') as family_type
    UNION ALL
    SELECT
        'Exception Binary' as type,
        'Classic_1.03_Game.exe' as example,
        extract_version_from_name('Classic_1.03_Game.exe') as extracted_version,
        is_exception_binary('Classic_1.03_Game.exe') as is_exception,
        get_family_for_exception('Classic_1.03_Game.exe') as family_type
    UNION ALL
    SELECT
        'Exception Binary' as type,
        'LoD_1.13c_Game.exe' as example,
        extract_version_from_name('LoD_1.13c_Game.exe') as extracted_version,
        is_exception_binary('LoD_1.13c_Game.exe') as is_exception,
        get_family_for_exception('LoD_1.13c_Game.exe') as family_type;
    "
}

# Refresh materialized views
refresh_views() {
    log "Refreshing cross-version materialized views..."

    run_sql "REFRESH MATERIALIZED VIEW cross_version_functions;"
    success "Cross-version views refreshed"

    # Show updated statistics
    log "Cross-version statistics:"
    run_sql "SELECT * FROM cross_version_statistics;"
}

# Show statistics
show_stats() {
    log "Unified version system statistics:"

    run_sql "
    SELECT
        'Total Executables' as metric,
        COUNT(*) as count
    FROM exetable
    UNION ALL
    SELECT
        'With Game Version' as metric,
        COUNT(*) as count
    FROM exetable
    WHERE game_version IS NOT NULL
    UNION ALL
    SELECT
        'Unified Format' as metric,
        COUNT(*) as count
    FROM exetable
    WHERE name_exec ~ '^1\\.[0-9]+[a-z]?_'
    UNION ALL
    SELECT
        'Exception Format' as metric,
        COUNT(*) as count
    FROM exetable
    WHERE name_exec ~ '^(Classic|LoD)_';
    "
}

# Main function
main() {
    case "${1:-help}" in
        "populate")
            populate_versions
            ;;
        "validate")
            validate_naming
            ;;
        "examples")
            show_examples
            ;;
        "refresh")
            refresh_views
            ;;
        "stats")
            show_stats
            ;;
        "full")
            log "Running complete unified version management..."
            populate_versions
            validate_naming
            refresh_views
            show_stats
            success "✅ Unified version management completed successfully!"
            ;;
        "help"|"-h"|"--help")
            echo "Unified Version Management Script"
            echo ""
            echo "Usage: $0 [command]"
            echo ""
            echo "Commands:"
            echo "  populate   - Populate version fields from filenames"
            echo "  validate   - Validate naming convention compliance"
            echo "  examples   - Show version extraction examples"
            echo "  refresh    - Refresh materialized views"
            echo "  stats      - Show version statistics"
            echo "  full       - Run complete management workflow [default]"
            echo "  help       - Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 populate      # Update all version fields"
            echo "  $0 validate      # Check naming compliance"
            echo "  $0 full          # Complete workflow"
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