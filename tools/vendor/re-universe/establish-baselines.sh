#!/bin/bash

echo "=== Performance Baseline Establishment ==="
echo "Timestamp: $(date)"
echo

# Performance baseline collection script
collect_performance_data() {
    local service_name=$1
    local endpoint=$2
    local iterations=${3:-10}

    echo "Collecting baseline data for $service_name ($iterations iterations)..."

    local total_time=0
    local success_count=0
    local min_time=999999
    local max_time=0

    for i in $(seq 1 $iterations); do
        local start_time=$(date +%s%3N)

        if curl -s --connect-timeout 5 "$endpoint" >/dev/null 2>&1; then
            local end_time=$(date +%s%3N)
            local response_time=$((end_time - start_time))

            total_time=$((total_time + response_time))
            success_count=$((success_count + 1))

            if [ $response_time -lt $min_time ]; then
                min_time=$response_time
            fi

            if [ $response_time -gt $max_time ]; then
                max_time=$response_time
            fi

            echo "  Iteration $i: ${response_time}ms"
        else
            echo "  Iteration $i: FAILED"
        fi

        sleep 1
    done

    if [ $success_count -gt 0 ]; then
        local avg_time=$((total_time / success_count))
        local success_rate=$((success_count * 100 / iterations))

        # Calculate suggested thresholds (avg + 2*std deviation approximation)
        local warning_threshold=$((avg_time + avg_time / 2))  # ~1.5x average
        local critical_threshold=$((avg_time * 3))            # 3x average

        echo "  Results:"
        echo "    Success Rate: ${success_rate}%"
        echo "    Average: ${avg_time}ms"
        echo "    Min: ${min_time}ms"
        echo "    Max: ${max_time}ms"
        echo "    Suggested Warning Threshold: ${warning_threshold}ms"
        echo "    Suggested Critical Threshold: ${critical_threshold}ms"
        echo

        # Store baseline in monitoring service if available
        if curl -s http://localhost:8096/health >/dev/null 2>&1; then
            local baseline_data=$(cat <<EOF
{
    "service_name": "$service_name",
    "metric_name": "response_time_ms",
    "baseline_value": $avg_time,
    "min_value": $min_time,
    "max_value": $max_time,
    "success_rate": $success_rate,
    "warning_threshold": $warning_threshold,
    "critical_threshold": $critical_threshold,
    "measurement_date": "$(date -Iseconds)",
    "iterations": $iterations
}
EOF
            )
            echo "$baseline_data" > "baseline_${service_name,,}.json"
            echo "  Baseline data saved to baseline_${service_name,,}.json"
        fi
    else
        echo "  ERROR: No successful requests for $service_name"
    fi

    echo
}

# Database performance baseline
echo "=== Database Performance Baseline ==="
db_start_time=$(date +%s%3N)
if docker exec bsim-postgres psql -U ben -d bsim -c "SELECT COUNT(*) FROM pg_stat_activity;" >/dev/null 2>&1; then
    db_end_time=$(date +%s%3N)
    db_response_time=$((db_end_time - db_start_time))
    echo "Database query response time: ${db_response_time}ms"
else
    echo "Database connection failed"
fi
echo

# Redis performance baseline
echo "=== Redis Performance Baseline ==="
redis_start_time=$(date +%s%3N)
if docker exec redis-cache redis-cli ping >/dev/null 2>&1; then
    redis_end_time=$(date +%s%3N)
    redis_response_time=$((redis_end_time - redis_start_time))
    echo "Redis ping response time: ${redis_response_time}ms"
else
    echo "Redis connection failed"
fi
echo

# Collect baselines for all services
echo "=== Service Response Time Baselines ==="

# Core services
collect_performance_data "VectorSearch" "http://localhost:8091/health" 5
collect_performance_data "AIOrchestration" "http://localhost:8092/health" 5
collect_performance_data "ChatInterface" "http://localhost:8093/health" 5
collect_performance_data "GitHubMining" "http://localhost:8094/health" 5
collect_performance_data "KnowledgeIntegration" "http://localhost:8095/health" 5
collect_performance_data "MonitoringDashboard" "http://localhost:8096/health" 5
collect_performance_data "GhidraAPI" "http://localhost:8081/api/health" 5

# Web interfaces
collect_performance_data "D2DocsWebsite" "http://localhost:8083/" 5
collect_performance_data "ChatWebInterface" "http://localhost:8093/" 5
collect_performance_data "MonitoringWebInterface" "http://localhost:8096/" 5

# System resource baselines
echo "=== System Resource Baselines ==="

# Docker container resource usage
echo "Container Resource Usage:"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}" | head -20

echo
echo "Disk Usage:"
df -h | grep -E "(/$|/var/lib/docker)"

echo
echo "Network Connections:"
netstat -i | head -5

echo
echo "=== Performance Baseline Collection Complete ==="
echo "Baseline files created:"
ls -la baseline_*.json 2>/dev/null || echo "No baseline files created"

echo
echo "=== Recommended Alert Thresholds ==="
echo "Based on collected baselines:"
echo "  - Database queries: < 100ms normal, 100-500ms warning, >500ms critical"
echo "  - Redis operations: < 10ms normal, 10-50ms warning, >50ms critical"
echo "  - API endpoints: < 200ms normal, 200-1000ms warning, >1000ms critical"
echo "  - Web interfaces: < 500ms normal, 500-2000ms warning, >2000ms critical"
echo
echo "Monitor these files for tracking:"
for file in baseline_*.json; do
    if [ -f "$file" ]; then
        service_name=$(echo "$file" | sed 's/baseline_\(.*\)\.json/\1/')
        warning=$(cat "$file" | python3 -c "import sys,json; print(json.load(sys.stdin).get('warning_threshold', 'N/A'))" 2>/dev/null)
        critical=$(cat "$file" | python3 -c "import sys,json; print(json.load(sys.stdin).get('critical_threshold', 'N/A'))" 2>/dev/null)
        echo "  - $service_name: Warning ${warning}ms, Critical ${critical}ms"
    fi
done 2>/dev/null

echo
echo "To monitor ongoing performance, run: ./health-check.sh"
echo "To view monitoring dashboard, visit: http://localhost:8096"