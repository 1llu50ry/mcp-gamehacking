#!/bin/bash
# Automated D2 Function Name Propagation Script
# Safely propagates function names across Diablo 2 versions using BSim similarity

set -e

DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_USER=${DB_USER:-ben}
DB_NAME=${DB_NAME:-bsim}
PGPASSWORD=${PGPASSWORD:-${BSIM_DB_PASSWORD}}

# Configuration
SIMILARITY_THRESHOLD=${SIMILARITY_THRESHOLD:-0.85}
MIN_SIGNIFICANCE=${MIN_SIGNIFICANCE:-0.7}
DRY_RUN=${DRY_RUN:-true}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Execute SQL query
exec_sql() {
    local query="$1"
    docker exec bsim-postgres psql -U "$DB_USER" -d "$DB_NAME" -c "$query"
}

# Get available D2 executables
get_d2_versions() {
    log "Finding available Diablo 2 versions in database..."
    exec_sql "
    SELECT e.id, e.name_exec,
           COUNT(f.id) as function_count,
           COUNT(CASE WHEN f.name_func NOT LIKE 'FUN_%' THEN 1 END) as named_count
    FROM executable e
    LEFT JOIN function f ON e.id = f.executable_id
    WHERE e.name_category = 'Diablo2' OR e.name_exec LIKE '%diablo2%'
    GROUP BY e.id, e.name_exec
    ORDER BY named_count DESC;
    "
}

# Find best matches between two versions
find_matches() {
    local source_version="$1"
    local target_version="$2"

    log "Finding matches between $source_version and $target_version..."

    exec_sql "
    WITH source_functions AS (
        SELECT f.id, f.name_func, f.addr, s.significance, s.hash_code
        FROM function f
        JOIN signature s ON f.id = s.function_id
        JOIN executable e ON f.executable_id = e.id
        WHERE e.name_exec = '$source_version'
        AND s.significance >= $MIN_SIGNIFICANCE
        AND f.name_func NOT LIKE 'FUN_%'
    ),
    target_functions AS (
        SELECT f.id, f.name_func, f.addr, s.significance, s.hash_code
        FROM function f
        JOIN signature s ON f.id = s.function_id
        JOIN executable e ON f.executable_id = e.id
        WHERE e.name_exec = '$target_version'
        AND s.significance >= $MIN_SIGNIFICANCE
        AND f.name_func LIKE 'FUN_%'
    ),
    ranked_matches AS (
        SELECT
            sf.id as source_id,
            sf.name_func as source_name,
            tf.id as target_id,
            tf.name_func as target_name,
            tf.addr as target_addr,
            abs(sf.significance - tf.significance) as sig_diff,
            CASE
                WHEN abs(sf.hash_code - tf.hash_code) < 1000000 THEN 0.95
                WHEN abs(sf.hash_code - tf.hash_code) < 10000000 THEN 0.85
                WHEN abs(sf.significance - tf.significance) < 0.1 THEN 0.8
                ELSE 0.7
            END as similarity_score,
            ROW_NUMBER() OVER (PARTITION BY tf.id ORDER BY
                CASE
                    WHEN abs(sf.hash_code - tf.hash_code) < 1000000 THEN 0.95
                    WHEN abs(sf.hash_code - tf.hash_code) < 10000000 THEN 0.85
                    WHEN abs(sf.significance - tf.significance) < 0.1 THEN 0.8
                    ELSE 0.7
                END DESC
            ) as match_rank
        FROM source_functions sf
        CROSS JOIN target_functions tf
    )
    SELECT
        source_name,
        target_name,
        target_id,
        target_addr,
        similarity_score,
        CASE
            WHEN similarity_score >= 0.9 THEN 'HIGH'
            WHEN similarity_score >= 0.8 THEN 'MEDIUM'
            ELSE 'LOW'
        END as confidence
    FROM ranked_matches
    WHERE match_rank = 1
    AND similarity_score >= $SIMILARITY_THRESHOLD
    ORDER BY similarity_score DESC;
    "
}

# Apply name propagation
apply_propagation() {
    local source_version="$1"
    local target_version="$2"
    local min_confidence="$3"

    if [ "$DRY_RUN" = "true" ]; then
        warn "DRY RUN MODE - No changes will be applied"
        log "Would propagate names from $source_version to $target_version (min confidence: $min_confidence)"
    else
        log "Applying name propagation from $source_version to $target_version..."
    fi

    # Get update statements
    local update_sql="
    WITH source_functions AS (
        SELECT f.id, f.name_func, f.addr, s.significance, s.hash_code, f.name_namespace
        FROM function f
        JOIN signature s ON f.id = s.function_id
        JOIN executable e ON f.executable_id = e.id
        WHERE e.name_exec = '$source_version'
        AND s.significance >= $MIN_SIGNIFICANCE
        AND f.name_func NOT LIKE 'FUN_%'
    ),
    target_functions AS (
        SELECT f.id, f.name_func, f.addr, s.significance, s.hash_code
        FROM function f
        JOIN signature s ON f.id = s.function_id
        JOIN executable e ON f.executable_id = e.id
        WHERE e.name_exec = '$target_version'
        AND s.significance >= $MIN_SIGNIFICANCE
        AND f.name_func LIKE 'FUN_%'
    ),
    best_matches AS (
        SELECT
            sf.name_func as source_name,
            sf.name_namespace as source_namespace,
            tf.id as target_id,
            tf.name_func as target_name,
            CASE
                WHEN abs(sf.hash_code - tf.hash_code) < 1000000 THEN 0.95
                WHEN abs(sf.hash_code - tf.hash_code) < 10000000 THEN 0.85
                WHEN abs(sf.significance - tf.significance) < 0.1 THEN 0.8
                ELSE 0.7
            END as similarity_score,
            ROW_NUMBER() OVER (PARTITION BY tf.id ORDER BY
                CASE
                    WHEN abs(sf.hash_code - tf.hash_code) < 1000000 THEN 0.95
                    WHEN abs(sf.hash_code - tf.hash_code) < 10000000 THEN 0.85
                    WHEN abs(sf.significance - tf.significance) < 0.1 THEN 0.8
                    ELSE 0.7
                END DESC
            ) as match_rank
        FROM source_functions sf
        CROSS JOIN target_functions tf
    )
    SELECT
        target_id,
        source_name,
        source_namespace,
        target_name,
        similarity_score
    FROM best_matches
    WHERE match_rank = 1
    AND similarity_score >= $SIMILARITY_THRESHOLD
    ORDER BY similarity_score DESC;
    "

    # Execute and process results
    local results=$(exec_sql "$update_sql" | grep -E '^[[:space:]]*[0-9]+' | head -10)
    local count=0

    while IFS='|' read -r target_id source_name source_namespace target_name similarity_score; do
        # Clean up whitespace
        target_id=$(echo "$target_id" | xargs)
        source_name=$(echo "$source_name" | xargs)
        source_namespace=$(echo "$source_namespace" | xargs)
        target_name=$(echo "$target_name" | xargs)
        similarity_score=$(echo "$similarity_score" | xargs)

        if [ -n "$target_id" ] && [ "$target_id" != "target_id" ]; then
            if [ "$DRY_RUN" = "true" ]; then
                log "Would update: $target_name -> $source_name (score: $similarity_score)"
            else
                exec_sql "UPDATE function SET name_func = '$source_name', name_namespace = '$source_namespace' WHERE id = $target_id;"
                success "Updated: $target_name -> $source_name"
            fi
            count=$((count + 1))
        fi
    done <<< "$results"

    if [ "$DRY_RUN" = "true" ]; then
        log "Dry run complete. Would update $count functions."
    else
        success "Successfully updated $count function names."
    fi
}

# Generate coverage report
generate_report() {
    log "Generating D2 function naming coverage report..."

    exec_sql "
    SELECT
        e.name_exec as version,
        COUNT(f.id) as total_functions,
        COUNT(CASE WHEN f.name_func NOT LIKE 'FUN_%' THEN 1 END) as named_functions,
        ROUND(
            COUNT(CASE WHEN f.name_func NOT LIKE 'FUN_%' THEN 1 END) * 100.0 /
            NULLIF(COUNT(f.id), 0), 2
        ) as coverage_percent
    FROM executable e
    LEFT JOIN function f ON e.id = f.executable_id
    WHERE e.name_category = 'Diablo2' OR e.name_exec LIKE '%diablo2%'
    GROUP BY e.id, e.name_exec
    ORDER BY coverage_percent DESC NULLS LAST;
    "
}

# Main execution
main() {
    log "D2 Function Name Propagation Tool Starting..."

    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --source)
                SOURCE_VERSION="$2"
                shift 2
                ;;
            --target)
                TARGET_VERSION="$2"
                shift 2
                ;;
            --apply)
                DRY_RUN=false
                shift
                ;;
            --threshold)
                SIMILARITY_THRESHOLD="$2"
                shift 2
                ;;
            --help)
                echo "Usage: $0 [OPTIONS]"
                echo "Options:"
                echo "  --source VERSION    Source version (must have named functions)"
                echo "  --target VERSION    Target version (to receive names)"
                echo "  --apply            Actually apply changes (default: dry run)"
                echo "  --threshold FLOAT  Similarity threshold (default: 0.85)"
                echo "  --help             Show this help"
                exit 0
                ;;
            *)
                error "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    # Show available versions
    get_d2_versions
    echo

    # Generate coverage report
    generate_report
    echo

    if [ -n "$SOURCE_VERSION" ] && [ -n "$TARGET_VERSION" ]; then
        log "Processing $SOURCE_VERSION -> $TARGET_VERSION"
        find_matches "$SOURCE_VERSION" "$TARGET_VERSION"
        echo
        apply_propagation "$SOURCE_VERSION" "$TARGET_VERSION" "MEDIUM"
    else
        log "Use --source and --target options to propagate names between versions"
        log "Example: $0 --source diablo2_109d.exe --target diablo2_113c.exe --apply"
    fi
}

# Run main function with all arguments
main "$@"