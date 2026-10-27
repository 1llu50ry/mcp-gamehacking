#!/bin/bash

# Data Quality Validator Script
# Author: Claude Code Assistant
# Date: 2026-01-16
# Purpose: Validate BSim data quality before and after ingestion

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
    docker exec -i bsim-postgres psql -U "$DB_USER" -d "$DB_NAME" -c "$1"
}

# Check for unversioned executables
check_unversioned_executables() {
    log "Checking for unversioned executables..."

    local unversioned_count
    unversioned_count=$(run_sql "
    SELECT COUNT(*)
    FROM exetable
    WHERE game_version IS NULL;
    " | grep -o '[0-9]\+' | head -1)

    if [[ $unversioned_count -eq 0 ]]; then
        success "All executables have version information"
    else
        error "$unversioned_count executables missing version information"

        # Show examples
        echo "Examples of problematic executables:"
        run_sql "
        SELECT name_exec, game_version
        FROM exetable
        WHERE game_version IS NULL
        LIMIT 5;
        "
        return 1
    fi
}

# Check filename naming convention
check_filename_convention() {
    log "Checking filename naming convention..."

    local bad_names_count
    bad_names_count=$(run_sql "
    SELECT COUNT(*)
    FROM exetable
    WHERE NOT (
        -- Standard unified binaries: 1.03_D2Game.dll
        name_exec ~ '^1\.[0-9]+[a-z]?_[A-Za-z0-9_]+\.(dll|exe)$'
        OR
        -- Exception binaries: Classic_1.03_Game.exe, LoD_1.13c_Game.exe
        name_exec ~ '^(Classic|LoD)_1\.[0-9]+[a-z]?_(Game|Diablo_II)\.(exe|dll)$'
    );
    " | grep -o '[0-9]\+' | head -1)

    if [[ $bad_names_count -eq 0 ]]; then
        success "All executables follow naming convention"
    else
        error "$bad_names_count executables don't follow naming convention"

        # Show examples
        echo "Examples of bad filenames:"
        run_sql "
        SELECT name_exec
        FROM exetable
        WHERE NOT (
            -- Standard unified binaries: 1.03_D2Game.dll
            name_exec ~ '^1\.[0-9]+[a-z]?_[A-Za-z0-9_]+\.(dll|exe)$'
            OR
            -- Exception binaries: Classic_1.03_Game.exe, LoD_1.13c_Game.exe
            name_exec ~ '^(Classic|LoD)_1\.[0-9]+[a-z]?_(Game|Diablo_II)\.(exe|dll)$'
        )
        LIMIT 10;
        "
        return 1
    fi
}

# Check cross-version data quality
check_cross_version_data() {
    log "Checking cross-version data quality..."

    # Check for functions with similarity data
    local functions_with_similarities
    functions_with_similarities=$(run_sql "
    SELECT COUNT(*)
    FROM cross_version_functions
    WHERE cross_version_matches > 0;
    " | grep -o '[0-9]\+' | head -1)

    if [[ $functions_with_similarities -gt 0 ]]; then
        success "$functions_with_similarities functions have cross-version similarity data"
    else
        warn "No functions have cross-version similarity data yet"
    fi

    # Check for Unknown/Other entries
    local unknown_entries
    unknown_entries=$(run_sql "
    SELECT COUNT(*)
    FROM cross_version_functions
    WHERE game_type = 'Other' OR version = 'Unknown';
    " | grep -o '[0-9]\+' | head -1)

    if [[ $unknown_entries -eq 0 ]]; then
        success "No Unknown/Other version entries"
    else
        warn "$unknown_entries functions have Unknown/Other version data"

        # This might be acceptable if they have 0 similarity matches
        local unknown_with_matches
        unknown_with_matches=$(run_sql "
        SELECT COUNT(*)
        FROM cross_version_functions
        WHERE (game_type = 'Other' OR version = 'Unknown')
          AND cross_version_matches > 0;
        " | grep -o '[0-9]\+' | head -1)

        if [[ $unknown_with_matches -gt 0 ]]; then
            error "$unknown_with_matches functions with similarity data have Unknown/Other versions"
            return 1
        else
            success "Unknown/Other entries have no similarity data (acceptable)"
        fi
    fi
}

# Check function_evolution table
check_function_evolution() {
    log "Checking function_evolution table..."

    local evolution_count
    evolution_count=$(run_sql "SELECT COUNT(*) FROM function_evolution;" | grep -o '[0-9]\+' | head -1)

    if [[ $evolution_count -gt 0 ]]; then
        success "$evolution_count function evolution records"
    else
        error "function_evolution table is empty"
        return 1
    fi

    # Check for D2Game functions specifically
    local d2game_functions
    d2game_functions=$(run_sql "
    SELECT COUNT(*)
    FROM function_evolution
    WHERE array_to_string(versions, ',') LIKE '%D2Game%';
    " | grep -o '[0-9]\+' | head -1)

    if [[ $d2game_functions -gt 0 ]]; then
        success "$d2game_functions D2Game functions in evolution table"
    else
        warn "No D2Game functions found in evolution table"
    fi
}

# Check API compatibility
check_api_compatibility() {
    log "Testing API compatibility..."

    # Test health endpoint
    if curl -s --connect-timeout 5 "http://localhost:8081/api/health" | grep -q "healthy"; then
        success "API health endpoint working"
    else
        error "API health endpoint not responding"
        return 1
    fi

    # Test cross-version endpoint with a versioned file
    local test_response
    test_response=$(curl -s --connect-timeout 10 "http://localhost:8081/api/functions/cross-version/Classic_1.03_D2Game.dll" | head -c 200)

    if [[ $test_response == *"functions"* ]]; then
        if [[ $test_response == *"\"functions\":{}"* ]]; then
            warn "API responding but no function data for Classic_1.03_D2Game.dll"
        else
            success "API returning function data for Classic_1.03_D2Game.dll"
        fi
    else
        error "API not returning valid JSON response"
        echo "Response: $test_response"
        return 1
    fi
}

# Generate data quality report
generate_report() {
    log "Generating data quality report..."

    echo ""
    echo "=== BSim Data Quality Report ==="
    run_sql "
    SELECT
        'Total Executables' as metric,
        COUNT(*) as count
    FROM exetable
    UNION ALL
    SELECT
        'With Version Info' as metric,
        COUNT(*) as count
    FROM exetable
    WHERE game_version IS NOT NULL
    UNION ALL
    SELECT
        'Total Functions' as metric,
        COUNT(*) as count
    FROM desctable
    UNION ALL
    SELECT
        'Functions with Similarities' as metric,
        COUNT(*) as count
    FROM cross_version_functions
    WHERE cross_version_matches > 0;
    "

    echo ""
    echo "=== Version Distribution ==="
    run_sql "
    SELECT
        game_version,
        COUNT(*) as executables
    FROM exetable
    WHERE game_version IS NOT NULL
    GROUP BY game_version
    ORDER BY game_version;
    "

    echo ""
    echo "=== Cross-Version Statistics ==="
    run_sql "SELECT * FROM cross_version_statistics;"
}

# Main validation function
main() {
    case "${1:-full}" in
        "full")
            log "Starting full data quality validation..."

            local errors=0

            check_unversioned_executables || ((errors++))
            check_filename_convention || ((errors++))
            check_cross_version_data || ((errors++))
            check_function_evolution || ((errors++))
            check_api_compatibility || ((errors++))

            generate_report

            if [[ $errors -eq 0 ]]; then
                success "✅ All data quality checks passed!"
                exit 0
            else
                error "❌ $errors data quality check(s) failed"
                exit 1
            fi
            ;;
        "pre-ingestion")
            log "Pre-ingestion validation..."
            check_unversioned_executables || exit 1
            check_filename_convention || exit 1
            success "Ready for data ingestion"
            ;;
        "post-ingestion")
            log "Post-ingestion validation..."
            check_cross_version_data || exit 1
            check_function_evolution || exit 1
            check_api_compatibility || exit 1
            generate_report
            success "Data ingestion validation complete"
            ;;
        "report")
            generate_report
            ;;
        "help"|"-h"|"--help")
            echo "Data Quality Validator"
            echo ""
            echo "Usage: $0 [command]"
            echo ""
            echo "Commands:"
            echo "  full           - Complete validation suite [default]"
            echo "  pre-ingestion  - Validate before data ingestion"
            echo "  post-ingestion - Validate after data ingestion"
            echo "  report         - Generate data quality report only"
            echo "  help           - Show this help message"
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