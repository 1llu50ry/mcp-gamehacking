#!/bin/bash
# Complete D2 Function Matching Workflow
# End-to-end automation for Diablo 2 cross-version function naming

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_CONTAINER="bsim-postgres"
LOG_DIR="${SCRIPT_DIR}/logs"
RESULTS_DIR="${SCRIPT_DIR}/results"

# Create directories
mkdir -p "$LOG_DIR" "$RESULTS_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
stage() { echo -e "${PURPLE}[STAGE]${NC} $1"; }

# Execute SQL and log
exec_sql() {
    local query="$1"
    local description="$2"

    if [ -n "$description" ]; then
        log "$description"
    fi

    docker exec "$DB_CONTAINER" psql -U ben -d bsim -c "$query" 2>&1 | tee -a "$LOG_DIR/sql_$(date +%Y%m%d).log"
}

# Function to analyze D2 database state
analyze_database() {
    stage "Analyzing D2 Database State"

    log "Checking available D2 executables..."
    exec_sql "SELECT * FROM d2_function_coverage ORDER BY coverage_percent DESC;" "Coverage Analysis"

    log "Generating statistics..."
    exec_sql "
    SELECT
        'Total D2 Executables' as metric,
        COUNT(*)::TEXT as value
    FROM executable
    WHERE name_category = 'Diablo2' OR name_exec LIKE '%diablo2%'
    UNION ALL
    SELECT
        'Total Functions' as metric,
        COUNT(*)::TEXT as value
    FROM function f
    JOIN executable e ON f.executable_id = e.id
    WHERE e.name_category = 'Diablo2' OR e.name_exec LIKE '%diablo2%'
    UNION ALL
    SELECT
        'Named Functions' as metric,
        COUNT(*)::TEXT as value
    FROM function f
    JOIN executable e ON f.executable_id = e.id
    WHERE (e.name_category = 'Diablo2' OR e.name_exec LIKE '%diablo2%')
    AND f.name_func NOT LIKE 'FUN_%'
    AND f.name_func != '';
    " "Database Statistics"
}

# Automated propagation workflow
run_auto_propagation() {
    local source_version="$1"
    local target_version="$2"
    local confidence_threshold="$3"

    stage "Automated Propagation: $source_version -> $target_version"

    # Dry run first
    log "Performing dry run analysis..."
    "$SCRIPT_DIR/d2_auto_propagate.sh" --source "$source_version" --target "$target_version" --threshold "$confidence_threshold" \
        > "$RESULTS_DIR/dry_run_${source_version}_to_${target_version}.log" 2>&1

    local dry_run_count=$(grep "Would update" "$RESULTS_DIR/dry_run_${source_version}_to_${target_version}.log" | wc -l)
    log "Dry run found $dry_run_count potential updates"

    if [ "$dry_run_count" -gt 0 ]; then
        log "Applying propagation..."
        "$SCRIPT_DIR/d2_auto_propagate.sh" --source "$source_version" --target "$target_version" --threshold "$confidence_threshold" --apply \
            > "$RESULTS_DIR/applied_${source_version}_to_${target_version}.log" 2>&1

        local applied_count=$(grep "Successfully updated" "$RESULTS_DIR/applied_${source_version}_to_${target_version}.log" | tail -1 | grep -o '[0-9]*' || echo 0)
        success "Applied $applied_count function name updates"

        return $applied_count
    else
        log "No functions to propagate at threshold $confidence_threshold"
        return 0
    fi
}

# Advanced pattern matching
run_advanced_matching() {
    local source_version="$1"
    local target_version="$2"

    stage "Advanced Pattern Matching: $source_version -> $target_version"

    log "Finding advanced patterns..."
    exec_sql "
    SELECT
        source_func_name,
        target_func_name,
        similarity_score,
        confidence_level,
        match_reason
    FROM find_d2_function_patterns('$source_version', '$target_version', 0.6)
    ORDER BY similarity_score DESC
    LIMIT 20;
    " "Advanced Pattern Analysis"

    log "Checking for batch propagation opportunities..."
    exec_sql "
    SELECT * FROM batch_propagate_d2_names(
        ARRAY['$source_version'],
        ARRAY['$target_version'],
        0.7,
        TRUE  -- Dry run
    );
    " "Batch Analysis"
}

# Quality validation
run_quality_checks() {
    stage "Quality Validation"

    log "Checking for naming conflicts..."
    exec_sql "
    SELECT
        e.name_exec as version,
        conflicted_name,
        function_count,
        recommendation
    FROM executable e,
         detect_naming_conflicts(e.name_exec) dnc
    WHERE e.name_category = 'Diablo2' OR e.name_exec LIKE '%diablo2%'
    ORDER BY function_count DESC;
    " "Conflict Detection"

    log "Analyzing function categories..."
    exec_sql "
    SELECT
        CASE
            WHEN name_func LIKE '%player%' THEN 'PLAYER'
            WHEN name_func LIKE '%item%' THEN 'ITEM'
            WHEN name_func LIKE '%skill%' THEN 'SKILL'
            WHEN name_func LIKE '%network%' THEN 'NETWORK'
            WHEN name_func LIKE '%save%' THEN 'SAVE'
            WHEN name_func LIKE '%ui%' OR name_func LIKE '%interface%' THEN 'UI'
            WHEN name_func LIKE '%monster%' THEN 'MONSTER'
            ELSE 'OTHER'
        END as category,
        COUNT(*) as function_count,
        AVG(s.significance)::NUMERIC(5,3) as avg_significance
    FROM function f
    JOIN executable e ON f.executable_id = e.id
    JOIN signature s ON f.id = s.function_id
    WHERE (e.name_category = 'Diablo2' OR e.name_exec LIKE '%diablo2%')
    AND f.name_func NOT LIKE 'FUN_%'
    AND f.name_func != ''
    GROUP BY
        CASE
            WHEN name_func LIKE '%player%' THEN 'PLAYER'
            WHEN name_func LIKE '%item%' THEN 'ITEM'
            WHEN name_func LIKE '%skill%' THEN 'SKILL'
            WHEN name_func LIKE '%network%' THEN 'NETWORK'
            WHEN name_func LIKE '%save%' THEN 'SAVE'
            WHEN name_func LIKE '%ui%' OR name_func LIKE '%interface%' THEN 'UI'
            WHEN name_func LIKE '%monster%' THEN 'MONSTER'
            ELSE 'OTHER'
        END
    ORDER BY function_count DESC;
    " "Category Analysis"
}

# Generate comprehensive report
generate_final_report() {
    stage "Generating Final Report"

    local report_file="$RESULTS_DIR/d2_analysis_report_$(date +%Y%m%d_%H%M%S).txt"

    {
        echo "=================================================================="
        echo "Diablo 2 Function Matching Analysis Report"
        echo "Generated: $(date)"
        echo "=================================================================="
        echo

        echo "DATABASE COVERAGE:"
        docker exec "$DB_CONTAINER" psql -U ben -d bsim -t -c "SELECT * FROM d2_function_coverage ORDER BY coverage_percent DESC;"
        echo

        echo "FUNCTION STATISTICS:"
        docker exec "$DB_CONTAINER" psql -U ben -d bsim -t -c "
        SELECT
            'Total Named Functions: ' || COUNT(*),
            'Average Significance: ' || AVG(s.significance)::NUMERIC(5,3),
            'Function Categories: ' || COUNT(DISTINCT CASE
                WHEN f.name_func LIKE '%player%' THEN 'PLAYER'
                WHEN f.name_func LIKE '%item%' THEN 'ITEM'
                WHEN f.name_func LIKE '%skill%' THEN 'SKILL'
                WHEN f.name_func LIKE '%network%' THEN 'NETWORK'
                ELSE 'OTHER'
            END)
        FROM function f
        JOIN executable e ON f.executable_id = e.id
        JOIN signature s ON f.id = s.function_id
        WHERE (e.name_category = 'Diablo2' OR e.name_exec LIKE '%diablo2%')
        AND f.name_func NOT LIKE 'FUN_%';"
        echo

        echo "RECENT OPERATIONS:"
        if [ -f "$LOG_DIR/sql_$(date +%Y%m%d).log" ]; then
            echo "See detailed logs in: $LOG_DIR/"
        fi

        echo
        echo "RECOMMENDATIONS:"
        echo "- Use advanced matching for cross-version analysis"
        echo "- Review low-confidence matches manually"
        echo "- Validate critical game functions (player, item, skill)"
        echo "- Monitor for naming conflicts during propagation"

    } > "$report_file"

    success "Report generated: $report_file"

    # Display summary
    echo
    stage "ANALYSIS SUMMARY"
    cat "$report_file" | head -30
}

# Main workflow
main() {
    local mode="${1:-full}"

    case "$mode" in
        "analyze")
            analyze_database
            ;;
        "propagate")
            local source="${2:-diablo2_109d.exe}"
            local target="${3:-diablo2_113c.exe}"
            local threshold="${4:-0.8}"
            run_auto_propagation "$source" "$target" "$threshold"
            ;;
        "advanced")
            local source="${2:-diablo2_113c.exe}"
            local target="${3:-diablo2_114d.exe}"
            run_advanced_matching "$source" "$target"
            ;;
        "validate")
            run_quality_checks
            ;;
        "report")
            generate_final_report
            ;;
        "full")
            stage "Complete D2 Function Matching Workflow"
            analyze_database
            echo
            run_auto_propagation "diablo2_109d.exe" "diablo2_113c.exe" "0.8"
            echo
            run_auto_propagation "diablo2_113c.exe" "diablo2_114d.exe" "0.7"
            echo
            run_advanced_matching "diablo2_109d.exe" "diablo2_114d.exe"
            echo
            run_quality_checks
            echo
            generate_final_report
            ;;
        *)
            echo "Usage: $0 [mode]"
            echo "Modes:"
            echo "  analyze                           - Analyze database state"
            echo "  propagate <source> <target> <th>  - Propagate names"
            echo "  advanced <source> <target>        - Advanced matching"
            echo "  validate                          - Quality checks"
            echo "  report                            - Generate report"
            echo "  full                              - Complete workflow (default)"
            exit 1
            ;;
    esac
}

# Run with all arguments
main "$@"