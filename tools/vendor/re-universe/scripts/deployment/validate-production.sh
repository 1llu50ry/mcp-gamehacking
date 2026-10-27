#!/bin/bash

# Production Validation Script
# Validates that BSim production deployment is ready

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

CHECKS_PASSED=0
CHECKS_FAILED=0

check_pass() {
    echo -e "${GREEN}✓ $1${NC}"
    ((CHECKS_PASSED++))
}

check_fail() {
    echo -e "${RED}✗ $1${NC}"
    ((CHECKS_FAILED++))
}

check_warn() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_header() {
    echo -e "${BOLD}${BLUE}$1${NC}"
}

echo -e "${BOLD}${BLUE}🔍 BSim Production Validation${NC}"
echo ""

# Check 1: Production credentials exist
print_header "1. Production Credentials"
if [[ -f ".env.production" ]]; then
    check_pass "Production environment file exists"

    # Load and validate
    source .env.production

    if [[ -n "$BSIM_DB_PASSWORD" && ${#BSIM_DB_PASSWORD} -ge 16 ]]; then
        check_pass "Database password is secure (${#BSIM_DB_PASSWORD} characters)"
    else
        check_fail "Database password is too weak"
    fi

    if [[ "$BSIM_DB_USER" != "ben" && "$BSIM_DB_USER" != "bsim" ]]; then
        check_pass "Database user is not default"
    else
        check_fail "Using default database user"
    fi

    if [[ "$BSIM_DB_NAME" == *"production"* ]]; then
        check_pass "Database name indicates production"
    else
        check_warn "Database name should indicate production environment"
    fi
else
    check_fail "Production environment file missing"
fi

echo ""

# Check 2: SSL Certificates
print_header "2. SSL Configuration"
if [[ -f "ssl/prod-server.crt" && -f "ssl/prod-server.key" ]]; then
    check_pass "Production SSL certificates exist"

    # Check certificate validity
    if openssl x509 -in ssl/prod-server.crt -checkend 86400 > /dev/null 2>&1; then
        check_pass "SSL certificate is valid and not expiring soon"
    else
        check_fail "SSL certificate is expired or expiring within 24 hours"
    fi

    # Check key permissions
    if [[ $(stat -c "%a" ssl/prod-server.key) == "600" ]]; then
        check_pass "SSL private key has secure permissions"
    else
        check_fail "SSL private key permissions are too permissive"
    fi
else
    check_fail "Production SSL certificates missing"
fi

echo ""

# Check 3: Production Scripts
print_header "3. Production Scripts"
scripts=("deploy-production.sh" "production-backup.sh" "production-monitoring.sh" "generate-prod-credentials.sh")

for script in "${scripts[@]}"; do
    if [[ -f "$script" && -x "$script" ]]; then
        check_pass "$script is executable"
    else
        check_fail "$script is missing or not executable"
    fi
done

echo ""

# Check 4: Docker Configuration
print_header "4. Docker Environment"
if docker ps > /dev/null 2>&1; then
    check_pass "Docker is accessible"
else
    check_fail "Cannot access Docker"
fi

if docker images | grep -q "bsim-postgres.*15-lshvector"; then
    check_pass "Custom BSim PostgreSQL image is available"
else
    check_fail "Custom BSim PostgreSQL image not found"
fi

if [[ -f "docker-compose.yml" ]]; then
    check_pass "Docker Compose configuration exists"
else
    check_fail "Docker Compose configuration missing"
fi

echo ""

# Check 5: Security Validation
print_header "5. Security Configuration"
if [[ -f ".gitignore" ]] && grep -q ".env.production" .gitignore; then
    check_pass "Production credentials excluded from git"
else
    check_fail "Production credentials may be committed to git"
fi

# Check for development passwords in production
if [[ -f ".env.production" ]]; then
    source .env.production
    if echo "$BSIM_DB_PASSWORD" | grep -qE "(***REDACTED***|bsim|password|changeme)"; then
        check_fail "Production uses weak/default password"
    else
        check_pass "Production password is not a default value"
    fi
fi

echo ""

# Check 6: Backup Configuration
print_header "6. Backup & Monitoring"
if [[ -f "production-backup.sh" ]]; then
    if grep -q "ENCRYPTION_ENABLED=true" production-backup.sh; then
        check_pass "Backup encryption is enabled"
    else
        check_warn "Backup encryption should be enabled for production"
    fi
fi

# Check if backup directory would be created
if [[ -d "/opt/bsim/backups" ]] || mkdir -p "./backups" 2>/dev/null; then
    check_pass "Backup directory is accessible"
else
    check_fail "Cannot create backup directory"
fi

echo ""

# Summary
print_header "📊 Validation Summary"
echo -e "${GREEN}Passed: $CHECKS_PASSED${NC}"
echo -e "${RED}Failed: $CHECKS_FAILED${NC}"

if [[ $CHECKS_FAILED -eq 0 ]]; then
    echo ""
    echo -e "${BOLD}${GREEN}🎉 Production validation completed successfully!${NC}"
    echo -e "${GREEN}Your BSim deployment is ready for production use.${NC}"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo -e "  1. Review final configuration: ${BLUE}nano .env.production${NC}"
    echo -e "  2. Deploy to production: ${BLUE}./deploy-production.sh${NC}"
    echo -e "  3. Set up monitoring: ${BLUE}./production-monitoring.sh --daemon${NC}"
    echo -e "  4. Schedule backups: ${BLUE}crontab -e${NC}"
    exit 0
else
    echo ""
    echo -e "${BOLD}${RED}❌ Production validation failed!${NC}"
    echo -e "${RED}Please fix the failed checks before deploying to production.${NC}"
    echo ""
    echo -e "${YELLOW}Common fixes:${NC}"
    echo -e "  • Generate credentials: ${BLUE}./generate-prod-credentials.sh${NC}"
    echo -e "  • Create SSL certificates: ${BLUE}./generate-ssl-certs.sh${NC}"
    echo -e "  • Build Docker image: ${BLUE}docker-compose build bsim-postgres${NC}"
    echo -e "  • Fix file permissions: ${BLUE}chmod +x *.sh${NC}"
    exit 1
fi