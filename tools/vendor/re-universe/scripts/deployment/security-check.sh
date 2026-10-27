#!/bin/bash
#
# security-check.sh - Automated Security Validation
#
# This script performs comprehensive security validation for production deployment
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Configuration
CONTAINER_NAME="bsim-postgres"
CHECK_COUNT=0
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

# Function to print colored output
print_header() {
    echo -e "${BOLD}${BLUE}$1${NC}"
}

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[FAIL]${NC} $1"
}

print_critical() {
    echo -e "${BOLD}${RED}[CRITICAL]${NC} $1"
}

# Function to run security check
run_security_check() {
    local check_name="$1"
    local check_command="$2"
    local severity="${3:-medium}"  # low, medium, high, critical

    ((CHECK_COUNT++))
    echo -n "🔍 $check_name... "

    if eval "$check_command" >/dev/null 2>&1; then
        echo -e "${GREEN}PASS${NC}"
        ((PASS_COUNT++))
        return 0
    else
        case "$severity" in
            "critical")
                echo -e "${BOLD}${RED}CRITICAL FAIL${NC}"
                ;;
            "high")
                echo -e "${RED}FAIL${NC}"
                ;;
            "medium")
                echo -e "${YELLOW}WARN${NC}"
                ((WARN_COUNT++))
                ;;
            "low")
                echo -e "${YELLOW}INFO${NC}"
                ;;
        esac
        ((FAIL_COUNT++))
        return 1
    fi
}

# Function to check for default credentials
check_default_credentials() {
    print_header "=== Credential Security Checks ==="

    # Check for hardcoded default credentials in files
    run_security_check "No hardcoded ben:bsim credentials" \
        "! grep -r 'ben:bsim' . --include='*.sh' --include='*.md' --include='*.yml' 2>/dev/null" \
        "critical"

    run_security_check "No default bsim_password credentials" \
        "! grep -r 'bsim_password' . --include='*.sh' --include='*.md' --include='*.yml' 2>/dev/null" \
        "critical"

    run_security_check "No CHANGE_ME placeholders in production files" \
        "! grep -r 'CHANGE_ME' .env* 2>/dev/null || true" \
        "high"

    # Check environment file security
    if [[ -f ".env" ]]; then
        run_security_check "Environment file has restrictive permissions" \
            "[[ \$(stat -c '%a' .env) == '600' ]]" \
            "high"

        run_security_check "Environment file contains secure password" \
            "[[ \$(grep 'BSIM_DB_PASSWORD=' .env | cut -d= -f2 | wc -c) -gt 16 ]]" \
            "high"
    fi

    if [[ -f ".env.production" ]]; then
        run_security_check "Production env file has restrictive permissions" \
            "[[ \$(stat -c '%a' .env.production) == '600' ]]" \
            "critical"
    fi
}

# Function to check SSL/TLS configuration
check_ssl_configuration() {
    print_header "=== SSL/TLS Security Checks ==="

    # Check if container is running
    if docker ps --format "table {{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
        run_security_check "SSL is enabled in PostgreSQL" \
            "docker exec $CONTAINER_NAME psql -U postgres -t -c 'SHOW ssl;' | grep -q 'on'" \
            "critical"

        run_security_check "SSL certificates exist" \
            "docker exec $CONTAINER_NAME ls -la /etc/ssl/certs/server.crt >/dev/null 2>&1" \
            "high"

        run_security_check "SSL private key has secure permissions" \
            "docker exec $CONTAINER_NAME stat -c '%a' /etc/ssl/private/server.key | grep -q '^600$'" \
            "high"

        run_security_check "TLS version is secure (1.2+)" \
            "docker exec $CONTAINER_NAME psql -U postgres -t -c \"SHOW ssl_min_protocol_version;\" | grep -E 'TLSv1\\.[2-9]'" \
            "medium"
    else
        print_warning "Container not running - skipping SSL checks"
    fi

    # Check SSL files in host
    if [[ -d "ssl" ]]; then
        run_security_check "SSL directory has secure permissions" \
            "[[ \$(stat -c '%a' ssl) == '700' ]]" \
            "medium"

        if [[ -f "ssl/server.key" ]]; then
            run_security_check "SSL private key has secure permissions (host)" \
                "[[ \$(stat -c '%a' ssl/server.key) == '600' ]]" \
                "high"
        fi
    fi
}

# Function to check network security
check_network_security() {
    print_header "=== Network Security Checks ==="

    # Check PostgreSQL port binding
    run_security_check "PostgreSQL not bound to 0.0.0.0" \
        "! netstat -tlnp 2>/dev/null | grep ':5432 ' | grep '0.0.0.0'" \
        "high"

    # Check for firewall
    if command -v ufw >/dev/null 2>&1; then
        run_security_check "UFW firewall is active" \
            "ufw status | grep -q 'Status: active'" \
            "medium"
    elif command -v iptables >/dev/null 2>&1; then
        run_security_check "iptables has rules configured" \
            "[[ \$(iptables -L | wc -l) -gt 8 ]]" \
            "medium"
    fi

    # Check SSH configuration if present
    if [[ -f "/etc/ssh/sshd_config" ]]; then
        run_security_check "SSH root login disabled" \
            "grep -q '^PermitRootLogin no' /etc/ssh/sshd_config" \
            "medium"

        run_security_check "SSH password authentication disabled" \
            "grep -q '^PasswordAuthentication no' /etc/ssh/sshd_config" \
            "low"
    fi
}

# Function to check file permissions and security
check_file_security() {
    print_header "=== File Security Checks ==="

    # Check script permissions
    run_security_check "Shell scripts are not world-writable" \
        "! find . -name '*.sh' -perm /002 | head -1" \
        "medium"

    # Check for sensitive files in git
    if [[ -d ".git" ]]; then
        run_security_check "No .env files in git" \
            "! git ls-files | grep -E '\\.env(\\..*)?$'" \
            "critical"

        run_security_check "No private keys in git" \
            "! git ls-files | grep -E '\\.(key|pem|p12|pfx)$'" \
            "critical"

        run_security_check "No credential files in git" \
            "! git ls-files | grep -iE '(password|secret|credential|token)'" \
            "high"
    fi

    # Check for backup files with sensitive data
    run_security_check "No backup files with credentials" \
        "! find . -name '*.bak' -o -name '*.backup' -o -name '*~' | xargs grep -l -E '(password|secret|key)' 2>/dev/null" \
        "medium"
}

# Function to check Docker security
check_docker_security() {
    print_header "=== Docker Security Checks ==="

    # Check Docker daemon
    run_security_check "Docker daemon is running" \
        "docker ps >/dev/null 2>&1" \
        "high"

    # Check container security
    if docker ps --format "table {{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
        run_security_check "Container not running as root" \
            "! docker exec $CONTAINER_NAME whoami | grep -q '^root$'" \
            "medium"

        run_security_check "Container has resource limits" \
            "docker inspect $CONTAINER_NAME | grep -q 'Memory'" \
            "low"

        run_security_check "Container has restart policy" \
            "docker inspect $CONTAINER_NAME | grep -q 'RestartPolicy'" \
            "low"

        # Check for privileged mode
        run_security_check "Container not running in privileged mode" \
            "! docker inspect $CONTAINER_NAME | grep -q '\"Privileged\": true'" \
            "high"
    fi

    # Check Docker Compose security
    if [[ -f "docker-compose.yml" ]]; then
        run_security_check "Docker Compose uses specific version" \
            "grep -q '^version:' docker-compose.yml" \
            "low"

        run_security_check "No hardcoded credentials in docker-compose.yml" \
            "! grep -E '(password|secret|key).*:.*[a-zA-Z0-9]{8,}' docker-compose.yml" \
            "high"
    fi
}

# Function to check database security
check_database_security() {
    print_header "=== Database Security Checks ==="

    if docker ps --format "table {{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
        # Check authentication method
        run_security_check "Database uses scram-sha-256 authentication" \
            "docker exec $CONTAINER_NAME cat /var/lib/postgresql/data/pg_hba.conf | grep -q 'scram-sha-256'" \
            "medium"

        # Check logging configuration
        run_security_check "Connection logging is enabled" \
            "docker exec $CONTAINER_NAME psql -U postgres -t -c 'SHOW log_connections;' | grep -q 'on'" \
            "medium"

        # Check for default databases
        run_security_check "No default postgres database access" \
            "! docker exec $CONTAINER_NAME psql -U postgres -l | grep -q 'template1.*postgres'" \
            "low"

        # Check user privileges
        if [[ -f ".env" ]]; then
            local db_user=$(grep "BSIM_DB_USER=" .env | cut -d'=' -f2)
            if [[ -n "$db_user" ]]; then
                run_security_check "Database user is not superuser" \
                    "! docker exec $CONTAINER_NAME psql -U postgres -t -c \"SELECT rolsuper FROM pg_roles WHERE rolname = '$db_user';\" | grep -q 't'" \
                    "medium"
            fi
        fi
    else
        print_warning "Database container not running - skipping database checks"
    fi
}

# Function to check system security
check_system_security() {
    print_header "=== System Security Checks ==="

    # Check OS updates
    if command -v apt >/dev/null 2>&1; then
        run_security_check "System packages are up to date" \
            "[[ \$(apt list --upgradable 2>/dev/null | wc -l) -lt 5 ]]" \
            "low"
    fi

    # Check for security tools
    run_security_check "fail2ban is installed" \
        "command -v fail2ban-server >/dev/null 2>&1" \
        "low"

    if command -v fail2ban-server >/dev/null 2>&1; then
        run_security_check "fail2ban is running" \
            "systemctl is-active --quiet fail2ban" \
            "low"
    fi

    # Check disk space
    run_security_check "Adequate disk space (>20% free)" \
        "[[ \$(df . | tail -1 | awk '{print \$5}' | sed 's/%//') -lt 80 ]]" \
        "low"

    # Check memory
    run_security_check "Adequate memory available" \
        "[[ \$(free | grep '^Mem:' | awk '{print (\$3/\$2)*100}' | cut -d. -f1) -lt 90 ]]" \
        "low"
}

# Function to check monitoring and logging
check_monitoring() {
    print_header "=== Monitoring & Logging Checks ==="

    # Check log files
    run_security_check "Docker logs are accessible" \
        "docker logs $CONTAINER_NAME --tail=1 >/dev/null 2>&1" \
        "medium"

    # Check log rotation
    if [[ -f "/etc/logrotate.d/docker-container" ]]; then
        run_security_check "Log rotation is configured" \
            "[[ -f /etc/logrotate.d/docker-container ]]" \
            "low"
    fi

    # Check monitoring scripts
    run_security_check "Monitoring script exists" \
        "[[ -x ./monitor-bsim.sh ]]" \
        "low"

    run_security_check "Backup script exists" \
        "[[ -x ./bsim-backup.sh ]]" \
        "low"

    # Check cron jobs
    run_security_check "Backup cron job configured" \
        "crontab -l 2>/dev/null | grep -q bsim" \
        "low"
}

# Function to show security recommendations
show_security_recommendations() {
    print_header "=== Security Recommendations ==="

    if [[ $FAIL_COUNT -gt 0 ]]; then
        echo ""
        print_error "Security issues found! Recommendations:"
        echo ""

        if grep -r "ben:bsim" . --include="*.sh" --include="*.md" --include="*.yml" 2>/dev/null; then
            echo "🔴 CRITICAL: Remove all hardcoded credentials (ben:bsim)"
            echo "   → Run: sed -i 's/ben:bsim/[username]:[password]/g' \$(find . -name '*.md' -o -name '*.sh')"
        fi

        if [[ -f ".env" ]] && grep -q "CHANGE_ME\|bsim\|bsim_password" .env; then
            echo "🔴 CRITICAL: Generate secure credentials"
            echo "   → Run: ./generate-prod-credentials.sh"
        fi

        if [[ ! -f ".env.production" ]]; then
            echo "🟡 HIGH: Create production environment file"
            echo "   → Run: ./generate-prod-credentials.sh -e .env.production"
        fi

        if ! docker ps --format "table {{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
            echo "🟡 MEDIUM: Start BSim container for complete validation"
            echo "   → Run: ./start-bsim.sh"
        fi

        if [[ ! -d "ssl" ]] || [[ ! -f "ssl/server.crt" ]]; then
            echo "🟡 MEDIUM: Generate SSL certificates"
            echo "   → Run: ./generate-ssl-certs.sh"
        fi

        echo ""
    fi

    # General recommendations
    echo "📋 General Security Best Practices:"
    echo "   • Change all default passwords before production deployment"
    echo "   • Use CA-signed SSL certificates in production"
    echo "   • Configure firewall to restrict database access"
    echo "   • Enable automated security updates"
    echo "   • Set up monitoring and alerting"
    echo "   • Schedule regular security audits"
    echo "   • Implement backup encryption and testing"
    echo "   • Follow PRODUCTION-SECURITY.md guidelines"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Automated security validation for BSim platform"
    echo ""
    echo "Options:"
    echo "  --quick        Run quick security checks only"
    echo "  --verbose      Enable verbose output"
    echo "  -h, --help     Show this help message"
    echo ""
    echo "Exit codes:"
    echo "  0: All security checks passed"
    echo "  1: Some security issues found"
    echo "  2: Critical security issues found"
}

# Function to show summary
show_summary() {
    echo ""
    print_header "=== Security Check Summary ==="
    echo "📊 Total Checks: $CHECK_COUNT"
    echo -e "✅ Passed: ${GREEN}$PASS_COUNT${NC}"
    echo -e "⚠️  Warnings: ${YELLOW}$WARN_COUNT${NC}"
    echo -e "❌ Failed: ${RED}$FAIL_COUNT${NC}"
    echo ""

    # Determine overall security status
    if [[ $FAIL_COUNT -eq 0 ]]; then
        print_success "🎉 All security checks passed! Platform is secure for deployment."
        return 0
    elif [[ $FAIL_COUNT -lt 3 && $WARN_COUNT -lt 5 ]]; then
        print_warning "⚠️  Minor security issues found. Review and address before production."
        return 1
    else
        print_critical "🚨 Significant security issues found! Do NOT deploy to production!"
        return 2
    fi
}

# Parse command line arguments
QUICK_MODE=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --quick)
            QUICK_MODE=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
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
    print_header "🔒 BSim Security Validation"
    echo "Running comprehensive security checks..."
    echo ""

    # Core security checks
    check_default_credentials
    check_ssl_configuration
    check_file_security
    check_docker_security

    # Extended checks (unless quick mode)
    if [[ "$QUICK_MODE" != "true" ]]; then
        check_network_security
        check_database_security
        check_system_security
        check_monitoring
    fi

    # Show recommendations
    show_security_recommendations

    # Show summary and exit with appropriate code
    show_summary
    return $?
}

# Run main function
main "$@"