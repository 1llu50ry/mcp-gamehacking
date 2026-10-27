#!/bin/bash

echo "=== RE-Universe Platform Integration Tests ==="
echo "Timestamp: $(date)"
echo

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Test logging
log_test() {
    local test_name="$1"
    local status="$2"
    local details="$3"

    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    if [ "$status" = "PASS" ]; then
        echo -e "${GREEN}✓ PASS${NC}: $test_name"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    elif [ "$status" = "FAIL" ]; then
        echo -e "${RED}✗ FAIL${NC}: $test_name"
        if [ -n "$details" ]; then
            echo -e "  ${RED}Error: $details${NC}"
        fi
        FAILED_TESTS=$((FAILED_TESTS + 1))
    elif [ "$status" = "WARN" ]; then
        echo -e "${YELLOW}⚠ WARN${NC}: $test_name"
        if [ -n "$details" ]; then
            echo -e "  ${YELLOW}Warning: $details${NC}"
        fi
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        echo -e "${BLUE}ℹ INFO${NC}: $test_name"
    fi
}

# Test HTTP endpoint
test_http_endpoint() {
    local name="$1"
    local url="$2"
    local expected_status="${3:-200}"
    local timeout="${4:-10}"

    local response_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout $timeout "$url" 2>/dev/null)

    if [ "$response_code" = "$expected_status" ]; then
        log_test "$name HTTP endpoint" "PASS"
        return 0
    else
        log_test "$name HTTP endpoint" "FAIL" "Expected $expected_status, got $response_code"
        return 1
    fi
}

# Test JSON API endpoint
test_json_endpoint() {
    local name="$1"
    local url="$2"
    local expected_field="$3"
    local timeout="${4:-10}"

    local response=$(curl -s --connect-timeout $timeout "$url" 2>/dev/null)

    if [ $? -eq 0 ] && echo "$response" | python3 -c "import sys,json; data=json.load(sys.stdin); sys.exit(0 if '$expected_field' in data else 1)" 2>/dev/null; then
        log_test "$name JSON API" "PASS"
        return 0
    else
        log_test "$name JSON API" "FAIL" "Invalid JSON response or missing field '$expected_field'"
        return 1
    fi
}

# Test database connectivity
test_database() {
    local name="$1"
    local command="$2"

    if docker exec bsim-postgres bash -c "$command" >/dev/null 2>&1; then
        log_test "$name database connectivity" "PASS"
        return 0
    else
        log_test "$name database connectivity" "FAIL" "Database command failed"
        return 1
    fi
}

echo "=== Phase 1: Container Health Tests ==="
echo

# Test all containers are running
containers=("bsim-postgres" "redis-cache" "vector-search" "ai-orchestration" "chat-interface" "github-mining" "knowledge-integration" "monitoring-dashboard" "ghidra-api" "ghidra-web")

for container in "${containers[@]}"; do
    if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        if [ "$(docker inspect --format='{{.State.Health.Status}}' $container 2>/dev/null)" = "healthy" ] || \
           [ "$(docker inspect --format='{{.State.Status}}' $container 2>/dev/null)" = "running" ]; then
            log_test "$container container health" "PASS"
        else
            log_test "$container container health" "WARN" "Container running but not healthy"
        fi
    else
        log_test "$container container health" "FAIL" "Container not running"
    fi
done

echo
echo "=== Phase 2: Core Service API Tests ==="
echo

# Test core service health endpoints
test_json_endpoint "Vector Search" "http://localhost:8091/health" "status"
test_json_endpoint "AI Orchestration" "http://localhost:8092/health" "status"
test_json_endpoint "Chat Interface" "http://localhost:8093/health" "status"
test_json_endpoint "GitHub Mining" "http://localhost:8094/health" "status"
test_json_endpoint "Knowledge Integration" "http://localhost:8095/health" "status"
test_json_endpoint "Monitoring Dashboard" "http://localhost:8096/health" "status"

# Test Ghidra API (different format)
test_http_endpoint "Ghidra API" "http://localhost:8081/api/health"

echo
echo "=== Phase 3: Web Interface Tests ==="
echo

# Test web interfaces
test_http_endpoint "D2Docs Website" "http://localhost:8083/"
test_http_endpoint "Chat Web Interface" "http://localhost:8093/"
test_http_endpoint "Monitoring Dashboard Web" "http://localhost:8096/"

echo
echo "=== Phase 4: Database Integration Tests ==="
echo

# Test PostgreSQL
test_database "PostgreSQL Connection" "psql -U ben -d bsim -c 'SELECT 1;'"
test_database "PostgreSQL BSim Schema" "psql -U ben -d bsim -c 'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '\''public'\'';'"

# Test Redis
if docker exec redis-cache redis-cli ping >/dev/null 2>&1; then
    log_test "Redis connectivity" "PASS"
else
    log_test "Redis connectivity" "FAIL"
fi

echo
echo "=== Phase 5: Service Integration Tests ==="
echo

# Test AI Orchestration service endpoints
test_json_endpoint "AI Models List" "http://localhost:8092/models" "available_models"
test_json_endpoint "AI Cost Tracking" "http://localhost:8092/cost-summary" "total_requests"

# Test Vector Search endpoints
test_json_endpoint "Vector Search Stats" "http://localhost:8091/stats" "total_vectors"

# Test GitHub Mining endpoints
test_json_endpoint "GitHub Mining Stats" "http://localhost:8094/stats" "total_repositories"

# Test Knowledge Integration endpoints
test_json_endpoint "Knowledge Integration Stats" "http://localhost:8095/stats" "total_functions_analyzed"

# Test Chat Interface endpoints
test_json_endpoint "Chat Interface Stats" "http://localhost:8093/api/stats" "total_conversations"

echo
echo "=== Phase 6: Monitoring System Tests ==="
echo

# Test monitoring dashboard data collection
test_json_endpoint "System Metrics" "http://localhost:8096/api/metrics/system" "total_services"
test_json_endpoint "Service Health Collection" "http://localhost:8096/api/health/all" "0"  # Array should have at least one element

# Test performance baselines exist
if [ -f "baseline_vectorsearch.json" ]; then
    log_test "Performance baselines exist" "PASS"
else
    log_test "Performance baselines exist" "FAIL" "Run ./establish-baselines.sh first"
fi

echo
echo "=== Phase 7: End-to-End Workflow Tests ==="
echo

# Test complete workflow: Chat -> AI -> Vector Search
echo "Testing complete workflow..."

# 1. Test chat message creation (if database is available)
if curl -s "http://localhost:8093/health" | grep -q "healthy"; then
    log_test "Chat service workflow readiness" "PASS"
else
    log_test "Chat service workflow readiness" "WARN" "Chat service degraded - workflow may be limited"
fi

# 2. Test AI orchestration workflow
if curl -s "http://localhost:8092/health" | grep -q -E "(healthy|degraded)"; then
    log_test "AI orchestration workflow readiness" "PASS"
else
    log_test "AI orchestration workflow readiness" "WARN" "AI service requires API keys for full functionality"
fi

# 3. Test vector search integration
if curl -s "http://localhost:8091/health" | grep -q -E "(healthy|degraded)"; then
    log_test "Vector search workflow readiness" "PASS"
else
    log_test "Vector search workflow readiness" "FAIL" "Vector search service unavailable"
fi

# 4. Test GitHub mining integration
if curl -s "http://localhost:8094/health" | grep -q -E "(healthy|degraded)"; then
    log_test "GitHub mining workflow readiness" "PASS"
else
    log_test "GitHub mining workflow readiness" "WARN" "GitHub mining requires API key for full functionality"
fi

# 5. Test knowledge integration workflow
if curl -s "http://localhost:8095/health" | grep -q -E "(healthy|degraded)"; then
    log_test "Knowledge integration workflow readiness" "PASS"
else
    log_test "Knowledge integration workflow readiness" "FAIL" "Knowledge integration service unavailable"
fi

echo
echo "=== Phase 8: Performance Validation Tests ==="
echo

# Validate response times are within acceptable ranges
echo "Validating response times against baselines..."

services=("vectorsearch" "aiorchestration" "chatinterface" "githubmining" "knowledgeintegration" "monitoringdashboard")

for service in "${services[@]}"; do
    if [ -f "baseline_${service}.json" ]; then
        warning_threshold=$(cat "baseline_${service}.json" | python3 -c "import sys,json; print(json.load(sys.stdin).get('warning_threshold', 100))" 2>/dev/null)

        # Test current response time
        case $service in
            "vectorsearch") url="http://localhost:8091/health" ;;
            "aiorchestration") url="http://localhost:8092/health" ;;
            "chatinterface") url="http://localhost:8093/health" ;;
            "githubmining") url="http://localhost:8094/health" ;;
            "knowledgeintegration") url="http://localhost:8095/health" ;;
            "monitoringdashboard") url="http://localhost:8096/health" ;;
        esac

        start_time=$(date +%s%3N)
        if curl -s --connect-timeout 5 "$url" >/dev/null 2>&1; then
            end_time=$(date +%s%3N)
            response_time=$((end_time - start_time))

            if [ $response_time -lt $warning_threshold ]; then
                log_test "$service response time validation" "PASS"
            else
                log_test "$service response time validation" "WARN" "Response time ${response_time}ms exceeds baseline warning ${warning_threshold}ms"
            fi
        else
            log_test "$service response time validation" "FAIL" "Service unreachable"
        fi
    fi
done

echo
echo "=== Phase 9: Security and Configuration Tests ==="
echo

# Test that services are not exposing sensitive information
echo "Testing security configurations..."

# Check for exposed debug information
for port in 8091 8092 8093 8094 8095 8096; do
    response=$(curl -s "http://localhost:$port/debug" 2>/dev/null || echo "")
    if [ -z "$response" ] || echo "$response" | grep -q "404\|Not Found"; then
        log_test "Port $port debug endpoint security" "PASS"
    else
        log_test "Port $port debug endpoint security" "WARN" "Debug endpoint may be exposed"
    fi
done

# Test database security (should not be directly accessible)
if ! curl -s --connect-timeout 2 "http://localhost:5432/" >/dev/null 2>&1; then
    log_test "PostgreSQL direct access security" "PASS"
else
    log_test "PostgreSQL direct access security" "WARN" "Database may be directly accessible"
fi

echo
echo "=== Test Results Summary ==="
echo "=============================================="
echo -e "Total Tests: $TOTAL_TESTS"
echo -e "${GREEN}Passed: $PASSED_TESTS${NC}"
echo -e "${RED}Failed: $FAILED_TESTS${NC}"
echo

# Calculate success rate
if [ $TOTAL_TESTS -gt 0 ]; then
    success_rate=$((PASSED_TESTS * 100 / TOTAL_TESTS))
    echo -e "Success Rate: ${success_rate}%"
    echo

    if [ $success_rate -ge 95 ]; then
        echo -e "${GREEN}🎉 EXCELLENT: System is operating at optimal levels${NC}"
    elif [ $success_rate -ge 85 ]; then
        echo -e "${YELLOW}⚠️  GOOD: System is mostly functional with minor issues${NC}"
    elif [ $success_rate -ge 70 ]; then
        echo -e "${YELLOW}⚠️  ACCEPTABLE: System has some issues that should be addressed${NC}"
    else
        echo -e "${RED}❌ POOR: System has significant issues requiring immediate attention${NC}"
    fi
else
    echo "No tests were executed."
fi

echo
echo "=== Integration Test Complete ==="
echo "For ongoing monitoring, use: ./health-check.sh"
echo "For detailed metrics, visit: http://localhost:8096"
echo "For performance baselines, see: baseline_*.json files"

# Exit with appropriate code
if [ $FAILED_TESTS -eq 0 ]; then
    exit 0
else
    exit 1
fi