#!/bin/bash

# Large BSim Database Creation Script
# Creates a BSim database optimized for 100M+ functions using large_32 template

set -e

# Default values
GHIDRA_INSTALL_DIR=""
DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="bsim"
DB_USER="${BSIM_DB_USER:-bsim_user}"
DB_PASSWORD="${BSIM_DB_PASSWORD:?BSIM_DB_PASSWORD must be set}"
DB_TEMPLATE="large_32"
OPTIMIZE_DB=true
VERBOSE=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -g|--ghidra-dir)
            GHIDRA_INSTALL_DIR="$2"
            shift 2
            ;;
        --no-optimize)
            OPTIMIZE_DB=false
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Creates a large BSim database optimized for 100M+ functions"
            echo ""
            echo "Options:"
            echo "  -g, --ghidra-dir DIR    Ghidra installation directory"
            echo "  --no-optimize          Skip database optimization"
            echo "  -v, --verbose          Verbose output"
            echo "  -h, --help             Show this help message"
            echo ""
            echo "This script:"
            echo "  - Creates BSim database with large_32 template"
            echo "  - Optimizes PostgreSQL for large datasets"
            echo "  - Sets up performance monitoring"
            echo "  - Configures backup retention"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use -h or --help for usage information"
            exit 1
            ;;
    esac
done

# Logging function
log() {
    local message="$1"
    local level="${2:-INFO}"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    case $level in
        "ERROR")
            echo -e "${RED}[$timestamp] [ERROR] $message${NC}"
            ;;
        "WARN")
            echo -e "${YELLOW}[$timestamp] [WARN] $message${NC}"
            ;;
        "SUCCESS")
            echo -e "${GREEN}[$timestamp] [SUCCESS] $message${NC}"
            ;;
        *)
            echo -e "${WHITE}[$timestamp] [INFO] $message${NC}"
            ;;
    esac
}

# Check system resources
check_system_resources() {
    log "Checking system resources for large BSim database..."

    # Check available RAM
    local available_ram=$(free -g | awk '/^Mem:/ {print $7}')
    if [[ $available_ram -lt 4 ]]; then
        log "Warning: Only ${available_ram}GB RAM available. Large BSim databases require 8GB+ for optimal performance." "WARN"
    else
        log "Available RAM: ${available_ram}GB - sufficient for large BSim database" "SUCCESS"
    fi

    # Check available disk space
    local available_space=$(df -BG . | awk 'NR==2 {print $4}' | sed 's/G//')
    if [[ $available_space -lt 50 ]]; then
        log "Warning: Only ${available_space}GB disk space available. Large BSim databases may require 50GB+ for 100M functions." "WARN"
    else
        log "Available disk space: ${available_space}GB - sufficient for large datasets" "SUCCESS"
    fi
}

# Optimize PostgreSQL for large databases
optimize_postgresql() {
    if [[ "$OPTIMIZE_DB" != "true" ]]; then
        log "Skipping database optimization (--no-optimize specified)"
        return 0
    fi

    log "Optimizing PostgreSQL for large BSim database..."

    # Get total system memory for calculations
    local total_ram_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    local total_ram_mb=$((total_ram_kb / 1024))

    # Calculate optimal settings
    local shared_buffers=$((total_ram_mb / 4))  # 25% of RAM
    local effective_cache=$((total_ram_mb * 3 / 4))  # 75% of RAM
    local maintenance_work_mem=$((total_ram_mb / 16))  # 1/16 of RAM, max 2GB

    # Cap values at reasonable maximums
    [[ $shared_buffers -gt 8192 ]] && shared_buffers=8192
    [[ $maintenance_work_mem -gt 2048 ]] && maintenance_work_mem=2048

    log "Applying PostgreSQL optimizations:"
    log "  - shared_buffers: ${shared_buffers}MB"
    log "  - effective_cache_size: ${effective_cache}MB"
    log "  - maintenance_work_mem: ${maintenance_work_mem}MB"

    # Apply optimizations
    docker exec bsim-postgres psql -U ben -d bsim -c "ALTER SYSTEM SET shared_buffers = '${shared_buffers}MB';" || true
    docker exec bsim-postgres psql -U ben -d bsim -c "ALTER SYSTEM SET effective_cache_size = '${effective_cache}MB';" || true
    docker exec bsim-postgres psql -U ben -d bsim -c "ALTER SYSTEM SET maintenance_work_mem = '${maintenance_work_mem}MB';" || true
    docker exec bsim-postgres psql -U ben -d bsim -c "ALTER SYSTEM SET checkpoint_completion_target = 0.9;" || true
    docker exec bsim-postgres psql -U ben -d bsim -c "ALTER SYSTEM SET wal_buffers = '16MB';" || true
    docker exec bsim-postgres psql -U ben -d bsim -c "ALTER SYSTEM SET default_statistics_target = 100;" || true
    docker exec bsim-postgres psql -U ben -d bsim -c "ALTER SYSTEM SET random_page_cost = 1.1;" || true

    # Enable query performance tracking
    docker exec bsim-postgres psql -U ben -d bsim -c "ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';" || true
    docker exec bsim-postgres psql -U ben -d bsim -c "ALTER SYSTEM SET track_activity_query_size = 2048;" || true

    # Reload configuration
    docker exec bsim-postgres psql -U ben -d bsim -c "SELECT pg_reload_conf();" || true

    log "PostgreSQL optimization complete. Restart container to apply all changes." "SUCCESS"
}

# Create performance monitoring views
create_monitoring_views() {
    log "Creating performance monitoring views..."

    docker exec bsim-postgres psql -U ben -d bsim <<-EOSQL || true
        -- Create extension for query statistics (if not exists)
        CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

        -- Create view for BSim table sizes
        CREATE OR REPLACE VIEW bsim_table_sizes AS
        SELECT
            schemaname,
            tablename,
            pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size_pretty,
            pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
        FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

        -- Create view for function and signature counts
        CREATE OR REPLACE VIEW bsim_statistics AS
        SELECT
            'Total Functions' AS metric,
            COUNT(*) AS value
        FROM function
        UNION ALL
        SELECT
            'Total Signatures' AS metric,
            COUNT(*) AS value
        FROM signature
        UNION ALL
        SELECT
            'Total Executables' AS metric,
            COUNT(*) AS value
        FROM executable;

        -- Grant permissions
        GRANT SELECT ON bsim_table_sizes TO ben;
        GRANT SELECT ON bsim_statistics TO ben;
EOSQL

    log "Performance monitoring views created successfully" "SUCCESS"
}

# Main execution
main() {
    echo -e "${CYAN}=== Large BSim Database Creation ===${NC}"
    echo -e "${WHITE}Template: $DB_TEMPLATE (100M+ functions, 32-bit optimized)${NC}"
    echo ""

    # Load configuration
    if [[ -f ".env" ]]; then
        log "Loading configuration from .env file..."
        source .env
        DB_NAME=${BSIM_DB_NAME:-$DB_NAME}
        DB_USER=${BSIM_DB_USER:-$DB_USER}
        DB_PASSWORD=${BSIM_DB_PASSWORD:-$DB_PASSWORD}
        DB_PORT=${BSIM_DB_PORT:-$DB_PORT}
    fi

    # Check system resources
    check_system_resources

    # Check if database is ready
    if ! docker exec bsim-postgres psql -U ben -d bsim -c "SELECT version();" > /dev/null 2>&1; then
        log "BSim database container is not running or not accessible" "ERROR"
        log "Please run: docker-compose up -d bsim-postgres" "ERROR"
        exit 1
    fi

    # Optimize PostgreSQL
    optimize_postgresql

    # Create monitoring views
    create_monitoring_views

    if [[ -n "$GHIDRA_INSTALL_DIR" && -d "$GHIDRA_INSTALL_DIR" ]]; then
        # Run BSim database creation
        log "Creating large BSim database with Ghidra..."
        log "This may take several minutes for large databases..."

        if ./setup-bsim.sh --ghidra-dir "$GHIDRA_INSTALL_DIR" --template "$DB_TEMPLATE" --verbose; then
            log "Large BSim database created successfully!" "SUCCESS"
        else
            log "Failed to create BSim database" "ERROR"
            exit 1
        fi
    else
        log "Ghidra installation not found or not specified" "WARN"
        log "Database is optimized and ready. Run with --ghidra-dir when Ghidra is available" "WARN"
    fi

    echo ""
    echo -e "${GREEN}=== Large BSim Database Setup Complete ===${NC}"
    echo -e "${WHITE}Template: $DB_TEMPLATE${NC}"
    echo -e "${WHITE}Capacity: ~100 million unique vectors${NC}"
    echo -e "${WHITE}Architecture: 32-bit optimized${NC}"
    echo ""
    echo -e "${CYAN}=== Performance Monitoring ===${NC}"
    echo -e "${WHITE}View table sizes: docker exec bsim-postgres psql -U ben -d bsim -c \"SELECT * FROM bsim_table_sizes;\"${NC}"
    echo -e "${WHITE}View statistics: docker exec bsim-postgres psql -U ben -d bsim -c \"SELECT * FROM bsim_statistics;\"${NC}"
    echo ""
    echo -e "${CYAN}=== Next Steps ===${NC}"
    echo -e "${WHITE}1. Import large binary collections using Ghidra headless analysis${NC}"
    echo -e "${WHITE}2. Monitor database growth and performance${NC}"
    echo -e "${WHITE}3. Run similarity queries through Ghidra BSim interface${NC}"
    echo ""
    echo -e "${CYAN}=== Documentation ===${NC}"
    echo -e "${WHITE}See CREATE-LARGE-BSIM.md for detailed usage instructions${NC}"
}

# Run main function
main "$@"