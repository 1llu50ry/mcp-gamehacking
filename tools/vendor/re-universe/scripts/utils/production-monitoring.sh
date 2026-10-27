#!/bin/bash

# Production BSim Monitoring Script
# Comprehensive monitoring for production BSim deployment

set -e

# Configuration
ALERT_EMAIL=""
SLACK_WEBHOOK=""
LOG_FILE="/var/log/bsim-monitoring.log"
CHECK_INTERVAL=300  # 5 minutes

# Load production environment
ENV_FILE="${1:-.env.production}"
if [[ -f "$ENV_FILE" ]]; then
    source "$ENV_FILE"
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Monitoring functions
log_metric() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [METRIC] $1" | tee -a "$LOG_FILE"
}

log_alert() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [ALERT] $1" | tee -a "$LOG_FILE"
    send_alert "$1"
}

send_alert() {
    local message="$1"

    # Email alert (if configured)
    if [[ -n "$ALERT_EMAIL" ]]; then
        echo "BSim Alert: $message" | mail -s "BSim Production Alert" "$ALERT_EMAIL" || true
    fi

    # Slack alert (if configured)
    if [[ -n "$SLACK_WEBHOOK" ]]; then
        curl -X POST -H 'Content-type: application/json' \
             --data "{\"text\":\"🚨 BSim Alert: $message\"}" \
             "$SLACK_WEBHOOK" || true
    fi
}

# Check container health
check_container_health() {
    if ! docker ps --filter "name=bsim-postgres" --filter "status=running" | grep -q bsim-postgres; then
        log_alert "BSim container is not running"
        return 1
    fi

    if ! docker exec bsim-postgres pg_isready -U "${BSIM_DB_USER}" > /dev/null 2>&1; then
        log_alert "Database is not accepting connections"
        return 1
    fi

    log_metric "Container health: OK"
    return 0
}

# Check database metrics
check_database_metrics() {
    # Connection count
    local conn_count=$(docker exec bsim-postgres psql -U "${BSIM_DB_USER}" -d "${BSIM_DB_NAME}" -t -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active';" 2>/dev/null || echo "ERROR")

    if [[ "$conn_count" == "ERROR" ]]; then
        log_alert "Failed to query database metrics"
        return 1
    fi

    log_metric "Active connections: $conn_count"

    # Database size
    local db_size=$(docker exec bsim-postgres psql -U "${BSIM_DB_USER}" -d "${BSIM_DB_NAME}" -t -c "SELECT pg_size_pretty(pg_database_size('${BSIM_DB_NAME}'));" 2>/dev/null || echo "ERROR")
    log_metric "Database size: $db_size"

    # Table statistics
    local table_count=$(docker exec bsim-postgres psql -U "${BSIM_DB_USER}" -d "${BSIM_DB_NAME}" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null || echo "0")
    log_metric "Tables: $table_count"

    # Function count
    local function_count=$(docker exec bsim-postgres psql -U "${BSIM_DB_USER}" -d "${BSIM_DB_NAME}" -t -c "SELECT count(*) FROM function;" 2>/dev/null || echo "0")
    log_metric "Functions: $function_count"

    # Signature count
    local signature_count=$(docker exec bsim-postgres psql -U "${BSIM_DB_USER}" -d "${BSIM_DB_NAME}" -t -c "SELECT count(*) FROM signature;" 2>/dev/null || echo "0")
    log_metric "Signatures: $signature_count"

    return 0
}

# Check SSL certificate expiry
check_ssl_expiry() {
    local cert_file="./ssl/server.crt"
    if [[ -f "$cert_file" ]]; then
        local expiry_date=$(openssl x509 -in "$cert_file" -noout -enddate | cut -d= -f2)
        local expiry_epoch=$(date -d "$expiry_date" +%s)
        local current_epoch=$(date +%s)
        local days_until_expiry=$(( (expiry_epoch - current_epoch) / 86400 ))

        log_metric "SSL certificate expires in $days_until_expiry days"

        if [[ $days_until_expiry -lt 30 ]]; then
            log_alert "SSL certificate expires in $days_until_expiry days"
        fi
    fi
}

# Check disk space
check_disk_space() {
    local disk_usage=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
    log_metric "Disk usage: ${disk_usage}%"

    if [[ $disk_usage -gt 85 ]]; then
        log_alert "High disk usage: ${disk_usage}%"
    fi
}

# Check memory usage
check_memory_usage() {
    local memory_usage=$(free | awk 'NR==2{printf "%.2f", $3*100/$2}')
    log_metric "Memory usage: ${memory_usage}%"

    if (( $(echo "$memory_usage > 90" | bc -l) )); then
        log_alert "High memory usage: ${memory_usage}%"
    fi
}

# Check backup status
check_backup_status() {
    local backup_dir="/opt/bsim/backups"
    local latest_backup_file="${backup_dir}/latest_backup.json"

    if [[ -f "$latest_backup_file" ]]; then
        local last_backup_timestamp=$(jq -r '.timestamp' "$latest_backup_file" 2>/dev/null || echo "")
        if [[ -n "$last_backup_timestamp" ]]; then
            local backup_epoch=$(date -d "$last_backup_timestamp" +%s)
            local current_epoch=$(date +%s)
            local hours_since_backup=$(( (current_epoch - backup_epoch) / 3600 ))

            log_metric "Last backup: $hours_since_backup hours ago"

            if [[ $hours_since_backup -gt 24 ]]; then
                log_alert "Last backup was $hours_since_backup hours ago"
            fi
        fi
    else
        log_alert "No backup status file found"
    fi
}

# Generate monitoring report
generate_report() {
    echo -e "${BLUE}=== BSim Production Monitoring Report ===${NC}"
    echo -e "${BLUE}Timestamp: $(date)${NC}"
    echo ""

    if check_container_health; then
        echo -e "${GREEN}✓ Container Health: OK${NC}"
    else
        echo -e "${RED}✗ Container Health: FAILED${NC}"
    fi

    if check_database_metrics; then
        echo -e "${GREEN}✓ Database Metrics: OK${NC}"
    else
        echo -e "${RED}✗ Database Metrics: FAILED${NC}"
    fi

    check_ssl_expiry
    check_disk_space
    check_memory_usage
    check_backup_status

    echo ""
    echo -e "${BLUE}Recent logs:${NC}"
    tail -10 "$LOG_FILE" | grep -E '\[(ALERT|ERROR)\]' || echo "No recent alerts"
}

# Main monitoring loop
if [[ "$1" == "--daemon" ]]; then
    echo "Starting BSim monitoring daemon..."
    while true; do
        check_container_health
        check_database_metrics
        check_ssl_expiry
        check_disk_space
        check_memory_usage
        check_backup_status
        sleep $CHECK_INTERVAL
    done
else
    # Single check mode
    generate_report
fi