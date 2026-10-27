#!/bin/bash
#
# test-bsim-setup.sh - Test Ghidra BSim Database Setup
#
# This script performs comprehensive testing of the BSim database setup
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CONTAINER_NAME="bsim-postgres"
TEST_COUNT=0
PASS_COUNT=0
FAIL_COUNT=0

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[FAIL]${NC} $1"
}

# Function to run a test
run_test() {
    local test_name="$1"
    local test_command="$2"
    local expected_result="${3:-0}"

    ((TEST_COUNT++))
    echo -n "Testing: $test_name... "

    if eval "$test_command" >/dev/null 2>&1; then
        local result=0
    else
        local result=1
    fi

    if [[ $result -eq $expected_result ]]; then
        echo -e "${GREEN}PASS${NC}"
        ((PASS_COUNT++))
        return 0
    else
        echo -e "${RED}FAIL${NC}"
        ((FAIL_COUNT++))
        return 1
    fi
}

# Function to run a test with output capture
run_test_with_output() {
    local test_name="$1"
    local test_command="$2"
    local expected_pattern="$3"

    ((TEST_COUNT++))
    echo -n "Testing: $test_name... "

    local output
    if output=$(eval "$test_command" 2>&1); then
        if [[ -n "$expected_pattern" && "$output" =~ $expected_pattern ]]; then
            echo -e "${GREEN}PASS${NC}"
            ((PASS_COUNT++))
            return 0
        elif [[ -z "$expected_pattern" ]]; then
            echo -e "${GREEN}PASS${NC}"
            ((PASS_COUNT++))
            return 0
        fi
    fi

    echo -e "${RED}FAIL${NC}"
    if [[ "$VERBOSE" == "true" ]]; then
        echo "  Output: $output"
        echo "  Expected pattern: $expected_pattern"
    fi
    ((FAIL_COUNT++))
    return 1
}

# Test functions
test_docker_connectivity() {
    print_status "Testing Docker connectivity..."
    run_test "Docker daemon" "docker ps"
}

test_container_status() {
    print_status "Testing container status..."
    run_test "Container exists" "docker ps -a --format '{{.Names}}' | grep -q '^${CONTAINER_NAME}$'"
    run_test "Container running" "docker ps --format '{{.Names}}' | grep -q '^${CONTAINER_NAME}$'"
}

test_database_connectivity() {
    print_status "Testing database connectivity..."
    run_test "PostgreSQL responding" "docker exec $CONTAINER_NAME pg_isready -U ben -d bsim"
    run_test "Database connection" "docker exec $CONTAINER_NAME psql -U ben -d bsim -c 'SELECT 1;'"
}

test_ssl_configuration() {
    print_status "Testing SSL configuration..."
    run_test "SSL enabled" "docker exec $CONTAINER_NAME psql -U ben -d bsim -t -c 'SHOW ssl;' | grep -q 'on'"
    run_test "SSL certificates exist" "docker exec $CONTAINER_NAME ls -la /etc/ssl/certs/server.crt"
}

test_bsim_schema() {
    print_status "Testing BSim schema..."

    local required_tables=("keyvaluetable" "executable" "function" "signature" "vector" "callgraph" "feature")

    for table in "${required_tables[@]}"; do
        run_test "Table: $table" "docker exec $CONTAINER_NAME psql -U ben -d bsim -c '\\dt $table' | grep -q '$table'"
    done

    # Test key-value configuration
    run_test "BSim configuration keys" "docker exec $CONTAINER_NAME psql -U ben -d bsim -t -c \"SELECT COUNT(*) FROM keyvaluetable WHERE key IN ('k', 'L', 'template');\" | grep -q '3'"
}

test_lsh_extension() {
    print_status "Testing LSH extension..."

    run_test "LSH extension installed" "docker exec $CONTAINER_NAME psql -U ben -d bsim -c '\\dx lsh' | grep -q 'lsh'"

    # Test LSH functions
    if docker exec $CONTAINER_NAME psql -U ben -d bsim -c '\dx lsh' | grep -q 'lsh'; then
        run_test "LSH functions available" "docker exec $CONTAINER_NAME psql -U ben -d bsim -t -c \"SELECT COUNT(*) FROM pg_proc WHERE proname LIKE 'lsh_%';\" | grep -q '[1-9]'"
    else
        print_warning "LSH extension not found - skipping function tests"
    fi
}

test_bsim_functions() {
    print_status "Testing BSim utility functions..."

    run_test "BSim info function" "docker exec $CONTAINER_NAME psql -U ben -d bsim -c 'SELECT * FROM bsim_database_info();'"
    run_test "BSim capacity function" "docker exec $CONTAINER_NAME psql -U ben -d bsim -c 'SELECT * FROM bsim_capacity_stats();'"
    run_test "BSim statistics view" "docker exec $CONTAINER_NAME psql -U ben -d bsim -c 'SELECT * FROM bsim_statistics;'"
}

test_performance() {
    print_status "Testing database performance..."

    # Test query performance with EXPLAIN
    run_test "Query planner working" "docker exec $CONTAINER_NAME psql -U ben -d bsim -c 'EXPLAIN SELECT 1;'"

    # Test index usage
    run_test "Indexes created" "docker exec $CONTAINER_NAME psql -U ben -d bsim -t -c \"SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public';\" | grep -q '[1-9]'"
}

test_backup_capability() {
    print_status "Testing backup capability..."

    run_test "pg_dump available" "docker exec $CONTAINER_NAME pg_dump --version"
    run_test "Backup permissions" "docker exec $CONTAINER_NAME pg_dump -U ben -d bsim --schema-only -f /tmp/test_backup.sql"
    run_test "Backup cleanup" "docker exec $CONTAINER_NAME rm -f /tmp/test_backup.sql"
}

test_capacity_and_limits() {
    print_status "Testing capacity and limits..."

    # Check current usage
    run_test_with_output "Database size check" "docker exec $CONTAINER_NAME psql -U ben -d bsim -t -c \"SELECT pg_size_pretty(pg_database_size('bsim'));\"" ".*[0-9].*"

    # Check configuration limits
    run_test_with_output "Function capacity limit" "docker exec $CONTAINER_NAME psql -U ben -d bsim -t -c \"SELECT capacity_limit FROM bsim_capacity_stats() WHERE metric = 'Functions';\"" "100000000"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --help         Show this help message"
    echo "  -v, --verbose      Enable verbose output"
    echo "  -q, --quiet        Run quietly (only show summary)"
    echo "  -t, --test TYPE    Run specific test type:"
    echo "                     docker, container, database, ssl, schema,"
    echo "                     lsh, functions, performance, backup, capacity"
    echo "  --comprehensive    Run all tests including slow ones"
    echo ""
    echo "This script tests the BSim database setup comprehensively"
}

# Function to show test summary
show_summary() {
    echo ""
    echo "==============================================="
    echo "Test Summary:"
    echo "  Total Tests: $TEST_COUNT"
    echo -e "  Passed:      ${GREEN}$PASS_COUNT${NC}"
    echo -e "  Failed:      ${RED}$FAIL_COUNT${NC}"
    echo ""

    if [[ $FAIL_COUNT -eq 0 ]]; then
        echo -e "${GREEN}🎉 All tests passed! BSim setup is working correctly.${NC}"
    else
        echo -e "${RED}❌ Some tests failed. Check the output above for details.${NC}"
        echo ""
        echo "Common fixes:"
        echo "  - Ensure container is running: ./start-bsim.sh"
        echo "  - Check LSH extension: see BSIM-SETUP.md"
        echo "  - Review container logs: docker logs $CONTAINER_NAME"
    fi
    echo "==============================================="
}

# Parse command line arguments
VERBOSE=false
QUIET=false
SPECIFIC_TEST=""
COMPREHENSIVE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_usage
            exit 0
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -q|--quiet)
            QUIET=true
            shift
            ;;
        -t|--test)
            SPECIFIC_TEST="$2"
            shift 2
            ;;
        --comprehensive)
            COMPREHENSIVE=true
            shift
            ;;
        *)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Main execution
main() {
    if [[ "$QUIET" != "true" ]]; then
        print_status "Starting BSim Database Setup Tests..."
        echo ""
    fi

    # Run specific test if requested
    case "$SPECIFIC_TEST" in
        "docker")
            test_docker_connectivity
            ;;
        "container")
            test_container_status
            ;;
        "database")
            test_database_connectivity
            ;;
        "ssl")
            test_ssl_configuration
            ;;
        "schema")
            test_bsim_schema
            ;;
        "lsh")
            test_lsh_extension
            ;;
        "functions")
            test_bsim_functions
            ;;
        "performance")
            test_performance
            ;;
        "backup")
            test_backup_capability
            ;;
        "capacity")
            test_capacity_and_limits
            ;;
        "")
            # Run all standard tests
            test_docker_connectivity
            test_container_status
            test_database_connectivity
            test_ssl_configuration
            test_bsim_schema
            test_lsh_extension
            test_bsim_functions

            if [[ "$COMPREHENSIVE" == "true" ]]; then
                test_performance
                test_backup_capability
                test_capacity_and_limits
            fi
            ;;
        *)
            print_error "Unknown test type: $SPECIFIC_TEST"
            show_usage
            exit 1
            ;;
    esac

    if [[ "$QUIET" != "true" ]]; then
        show_summary
    fi

    # Exit with appropriate code
    if [[ $FAIL_COUNT -eq 0 ]]; then
        exit 0
    else
        exit 1
    fi
}

# Run main function
main "$@"