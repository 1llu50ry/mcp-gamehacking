#!/bin/bash
#
# monitor-bsim.sh - Monitor Ghidra BSim Database Status
#
# This script provides real-time monitoring and status reporting for BSim database
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Configuration
CONTAINER_NAME="bsim-postgres"
REFRESH_INTERVAL=5

# Function to print colored output
print_header() {
    echo -e "${BOLD}${CYAN}$1${NC}"
}

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if container is running
check_container_status() {
    if docker ps --format "table {{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
        return 0
    else
        return 1
    fi
}

# Function to get container stats
get_container_stats() {
    if check_container_status; then
        docker stats --no-stream --format "table {{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}" $CONTAINER_NAME
    else
        echo "Container not running"
    fi
}

# Function to get database size
get_database_size() {
    if check_container_status; then
        docker exec $CONTAINER_NAME psql -U ben -d bsim -t -c "SELECT pg_size_pretty(pg_database_size('bsim'));" 2>/dev/null | xargs || echo "N/A"
    else
        echo "N/A"
    fi
}

# Function to get database statistics
get_database_stats() {
    if check_container_status; then
        docker exec $CONTAINER_NAME psql -U ben -d bsim -c "SELECT * FROM bsim_statistics;" 2>/dev/null || echo "Statistics not available"
    else
        echo "Container not running"
    fi
}

# Function to get capacity utilization
get_capacity_stats() {
    if check_container_status; then
        docker exec $CONTAINER_NAME psql -U ben -d bsim -c "SELECT * FROM bsim_capacity_stats();" 2>/dev/null || echo "Capacity stats not available"
    else
        echo "Container not running"
    fi
}

# Function to get connection count
get_connection_count() {
    if check_container_status; then
        docker exec $CONTAINER_NAME psql -U ben -d bsim -t -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active';" 2>/dev/null | xargs || echo "N/A"
    else
        echo "N/A"
    fi
}

# Function to get recent activity
get_recent_activity() {
    if check_container_status; then
        docker exec $CONTAINER_NAME psql -U ben -d bsim -c "SELECT query_start, left(query, 80) as query FROM pg_stat_activity WHERE state = 'active' AND query NOT LIKE '%pg_stat_activity%' ORDER BY query_start DESC LIMIT 5;" 2>/dev/null || echo "No recent activity"
    else
        echo "Container not running"
    fi
}

# Function to get data quality metrics
get_data_quality() {
    if check_container_status; then
        docker exec $CONTAINER_NAME psql -U ben -d bsim -t -c "
        WITH stats AS (
            SELECT
                COUNT(DISTINCT d.name_func) as unique_functions,
                COUNT(d.name_func) as total_entries,
                COUNT(d.name_func) - COUNT(DISTINCT d.name_func) as duplicates
            FROM desctable d
            JOIN exetable e ON d.id_exe = e.id
        )
        SELECT
            unique_functions || ',' || total_entries || ',' || duplicates || ',' ||
            ROUND(100.0 * duplicates / total_entries, 1) || '%'
        FROM stats;" 2>/dev/null | xargs || echo "N/A,N/A,N/A,N/A"
    else
        echo "N/A,N/A,N/A,N/A"
    fi
}

# Function to show basic status
show_basic_status() {
    clear
    print_header "=== BSim Database Status ==="
    echo ""

    # Container status
    if check_container_status; then
        print_success "Container Status: Running"
        uptime=$(docker inspect --format='{{.State.StartedAt}}' $CONTAINER_NAME 2>/dev/null)
        echo "    Started: $uptime"
    else
        print_error "Container Status: Not Running"
        echo "    Run: ./start-bsim.sh to start the container"
        return
    fi

    # Database connectivity
    if docker exec $CONTAINER_NAME pg_isready -U ben -d bsim >/dev/null 2>&1; then
        print_success "Database Status: Connected"
    else
        print_warning "Database Status: Connection Issues"
    fi

    # Database size
    db_size=$(get_database_size)
    echo "Database Size: $db_size"

    # Active connections
    connections=$(get_connection_count)
    echo "Active Connections: $connections"

    echo ""
    print_header "=== Quick Stats ==="
    get_database_stats

    # Data quality metrics
    echo ""
    print_header "=== Data Quality ==="
    quality_stats=$(get_data_quality)
    IFS=',' read -r unique total duplicates percentage <<< "$quality_stats"
    echo "Unique Functions: $unique"
    echo "Total Entries: $total"
    echo "Duplicates: $duplicates ($percentage)"

    # Quality status indicator
    if [ "$percentage" != "N/A" ]; then
        dup_num=$(echo "$percentage" | sed 's/%//' | cut -d'.' -f1)
        if [ "$dup_num" -gt 50 ]; then
            echo -e "${RED}⚠️  Data Quality: CRITICAL - High duplicate rate${NC}"
        elif [ "$dup_num" -gt 25 ]; then
            echo -e "${YELLOW}⚠️  Data Quality: WARNING - Moderate duplicates${NC}"
        elif [ "$dup_num" -gt 5 ]; then
            echo -e "${YELLOW}ℹ️  Data Quality: OK - Low duplicates${NC}"
        else
            echo -e "${GREEN}✅ Data Quality: GOOD - Minimal duplicates${NC}"
        fi
    fi
}

# Function to show detailed metrics
show_metrics() {
    show_basic_status

    echo ""
    print_header "=== Capacity Utilization ==="
    get_capacity_stats

    echo ""
    print_header "=== Container Resource Usage ==="
    if check_container_status; then
        echo "CPU%     MEM USAGE / LIMIT     MEM%    NET I/O         BLOCK I/O"
        get_container_stats | tail -n 1
    else
        echo "Container not running"
    fi
}

# Function to show performance data
show_performance() {
    show_metrics

    echo ""
    print_header "=== Recent Database Activity ==="
    get_recent_activity

    echo ""
    print_header "=== PostgreSQL Performance ==="
    if check_container_status; then
        echo "Database Connections:"
        docker exec $CONTAINER_NAME psql -U ben -d bsim -c "SELECT datname, numbackends, xact_commit, xact_rollback FROM pg_stat_database WHERE datname = 'bsim';" 2>/dev/null || echo "Performance data not available"

        echo ""
        echo "Cache Hit Ratio:"
        docker exec $CONTAINER_NAME psql -U ben -d bsim -c "SELECT schemaname, tablename, heap_blks_read, heap_blks_hit, CASE WHEN heap_blks_hit + heap_blks_read = 0 THEN 0 ELSE round((heap_blks_hit::float / (heap_blks_hit + heap_blks_read)) * 100, 2) END as hit_ratio FROM pg_statio_user_tables WHERE schemaname = 'public' ORDER BY hit_ratio DESC LIMIT 10;" 2>/dev/null || echo "Cache statistics not available"
    fi
}

# Function to show logs
show_logs() {
    if [[ "$1" == "--follow" ]]; then
        print_status "Following BSim container logs (Press Ctrl+C to stop)..."
        docker logs -f $CONTAINER_NAME
    else
        print_header "=== Recent Container Logs ==="
        docker logs --tail=50 $CONTAINER_NAME 2>/dev/null || echo "Logs not available"
    fi
}

# Function to watch mode (continuous monitoring)
watch_mode() {
    local mode="$1"

    print_status "Starting continuous monitoring (Press Ctrl+C to stop)..."

    while true; do
        case "$mode" in
            "basic")
                show_basic_status
                ;;
            "metrics")
                show_metrics
                ;;
            "performance")
                show_performance
                ;;
        esac

        echo ""
        echo -e "${BLUE}Refreshing in $REFRESH_INTERVAL seconds...${NC}"
        sleep $REFRESH_INTERVAL
    done
}

# Function to show database configuration
show_config() {
    print_header "=== BSim Database Configuration ==="

    if check_container_status; then
        echo "BSim Configuration:"
        docker exec $CONTAINER_NAME psql -U ben -d bsim -c "SELECT * FROM bsim_database_info();" 2>/dev/null || echo "Configuration not available"

        echo ""
        echo "PostgreSQL Configuration (key settings):"
        docker exec $CONTAINER_NAME psql -U ben -d bsim -c "SELECT name, setting, unit FROM pg_settings WHERE name IN ('shared_buffers', 'effective_cache_size', 'maintenance_work_mem', 'checkpoint_completion_target', 'wal_buffers', 'default_statistics_target');" 2>/dev/null || echo "PostgreSQL config not available"
    else
        print_error "Container not running"
    fi
}

# Function to show alerts
check_alerts() {
    print_header "=== BSim Health Alerts ==="

    local alerts=0

    # Check container status
    if ! check_container_status; then
        print_error "CRITICAL: Container is not running"
        ((alerts++))
    fi

    if check_container_status; then
        # Check database connectivity
        if ! docker exec $CONTAINER_NAME pg_isready -U ben -d bsim >/dev/null 2>&1; then
            print_error "CRITICAL: Database is not responding"
            ((alerts++))
        fi

        # Check disk space (if database is very large)
        db_size_bytes=$(docker exec $CONTAINER_NAME psql -U ben -d bsim -t -c "SELECT pg_database_size('bsim');" 2>/dev/null | xargs || echo "0")
        if [[ "$db_size_bytes" -gt 107374182400 ]]; then  # 100GB
            print_warning "WARNING: Database size is very large (>100GB)"
            ((alerts++))
        fi

        # Check capacity utilization
        function_count=$(docker exec $CONTAINER_NAME psql -U ben -d bsim -t -c "SELECT COUNT(*) FROM function;" 2>/dev/null | xargs || echo "0")
        if [[ "$function_count" -gt 90000000 ]]; then  # 90M functions (90% of 100M capacity)
            print_warning "WARNING: Function count approaching capacity limit"
            ((alerts++))
        fi

        # Check for long-running queries
        long_queries=$(docker exec $CONTAINER_NAME psql -U ben -d bsim -t -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND query_start < now() - interval '5 minutes';" 2>/dev/null | xargs || echo "0")
        if [[ "$long_queries" -gt 0 ]]; then
            print_warning "WARNING: $long_queries long-running queries detected"
            ((alerts++))
        fi

        # Check SSL configuration
        if ! docker exec $CONTAINER_NAME psql -U ben -d bsim -t -c "SHOW ssl;" 2>/dev/null | grep -q "on"; then
            print_warning "WARNING: SSL is not enabled"
            ((alerts++))
        fi
    fi

    if [[ $alerts -eq 0 ]]; then
        print_success "All checks passed - no alerts"
    else
        echo ""
        echo -e "${YELLOW}Total alerts: $alerts${NC}"
    fi
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  status          Show basic status (default)"
    echo "  metrics         Show detailed metrics"
    echo "  performance     Show performance statistics"
    echo "  config          Show database configuration"
    echo "  alerts          Check for health alerts"
    echo "  logs            Show recent logs"
    echo "  watch           Continuous monitoring mode"
    echo ""
    echo "Options:"
    echo "  --follow        Follow logs in real-time (with logs command)"
    echo "  --interval N    Set refresh interval in seconds (default: 5)"
    echo "  -h, --help      Show this help message"
    echo ""
    echo "Watch modes:"
    echo "  watch basic     Continuous basic status"
    echo "  watch metrics   Continuous detailed metrics"
    echo "  watch performance  Continuous performance monitoring"
    echo ""
    echo "Examples:"
    echo "  $0                      # Show basic status"
    echo "  $0 metrics             # Show detailed metrics"
    echo "  $0 logs --follow       # Follow logs"
    echo "  $0 watch performance   # Continuous performance monitoring"
    echo "  $0 alerts              # Check for issues"
}

# Parse command line arguments
COMMAND="${1:-status}"
shift 2>/dev/null || true

# Parse options
while [[ $# -gt 0 ]]; do
    case $1 in
        --follow)
            FOLLOW=true
            shift
            ;;
        --interval)
            REFRESH_INTERVAL="$2"
            shift 2
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Main execution
main() {
    case "$COMMAND" in
        "status")
            show_basic_status
            ;;
        "metrics")
            show_metrics
            ;;
        "performance")
            show_performance
            ;;
        "config")
            show_config
            ;;
        "alerts")
            check_alerts
            ;;
        "logs")
            if [[ "$FOLLOW" == "true" ]]; then
                show_logs --follow
            else
                show_logs
            fi
            ;;
        "watch")
            watch_mode "${2:-basic}"
            ;;
        *)
            echo "Unknown command: $COMMAND"
            show_usage
            exit 1
            ;;
    esac
}

# Run main function
main "$@"