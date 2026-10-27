#!/bin/bash
# Automated Test Suite for Ghidra RE Platform
# This script runs comprehensive tests that can be executed in CI/CD

set -e  # Exit on error

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

# Test counters - Initialize properly for arithmetic operations
declare -i TESTS_RUN=0
declare -i TESTS_PASSED=0
declare -i TESTS_FAILED=0

# Logging function
log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Test result functions
test_start() {
    TESTS_RUN=$((TESTS_RUN + 1))
    echo -e "\n${CYAN}[TEST $TESTS_RUN] $1${NC}"
}

test_pass() {
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo -e "${GREEN}✅ PASS: $1${NC}"
}

test_fail() {
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo -e "${RED}❌ FAIL: $1${NC}"
    if [[ "${CI:-false}" != "true" ]]; then
        echo -e "${YELLOW}Continuing with remaining tests...${NC}"
    fi
}

# Test 1: Prerequisites Check
test_prerequisites() {
    test_start "Prerequisites Check"
    
    # Docker
    if command -v docker >/dev/null 2>&1; then
        test_pass "Docker is installed"
    else
        test_fail "Docker is not installed"
        return 1
    fi
    
    # Docker Compose
    if command -v docker-compose >/dev/null 2>&1 || docker compose version >/dev/null 2>&1; then
        test_pass "Docker Compose is installed"
    else
        test_fail "Docker Compose is not installed"
        return 1
    fi
    
    # Check if scripts exist
    local scripts=("start.sh" "stop.sh" "config.sh" "backup.sh" "restore.sh" "cleanup.sh" "test-connectivity.sh")
    for script in "${scripts[@]}"; do
        if [[ -f "$script" ]]; then
            test_pass "Script exists: $script"
        else
            test_fail "Missing script: $script"
        fi
    done
}

# Test 2: Script Syntax Validation
test_script_syntax() {
    test_start "Script Syntax Validation"
    
    # Test bash scripts
    for script in *.sh; do
        if [[ -f "$script" ]]; then
            if bash -n "$script" 2>/dev/null; then
                test_pass "Bash syntax valid: $script"
            else
                test_fail "Bash syntax error: $script"
            fi
        fi
    done
    
    # Test PowerShell scripts (if running on Windows or with PowerShell available)
    if command -v pwsh >/dev/null 2>&1 || command -v powershell >/dev/null 2>&1; then
        for script in *.ps1; do
            if [[ -f "$script" ]]; then
                local ps_cmd="pwsh"
                if ! command -v pwsh >/dev/null 2>&1; then
                    ps_cmd="powershell"
                fi
                
                if $ps_cmd -NoProfile -NonInteractive -Command "try { [scriptblock]::Create((Get-Content '$script' -Raw)) | Out-Null; exit 0 } catch { exit 1 }" 2>/dev/null; then
                    test_pass "PowerShell syntax valid: $script"
                else
                    test_fail "PowerShell syntax error: $script"
                fi
            fi
        done
    else
        echo -e "${YELLOW}⚠️  PowerShell not available, skipping .ps1 syntax tests${NC}"
    fi
}

# Test 3: Configuration Management
test_configuration() {
    test_start "Configuration Management"
    
    # Backup existing .env if it exists
    local env_backup=""
    if [[ -f ".env" ]]; then
        env_backup=".env.backup.$(date +%s)"
        cp ".env" "$env_backup"
    fi
    
    # Test config script functionality
    if [[ -f "config.sh" ]]; then
        # Test show functionality
        if ./config.sh >/dev/null 2>&1; then
            test_pass "Config show functionality works"
        else
            test_fail "Config show functionality failed"
        fi
        
        # Test validation
        if ./config.sh -Action validate >/dev/null 2>&1; then
            test_pass "Config validation works"
        else
            test_fail "Config validation failed"
        fi
        
        # Test set functionality
        if ./config.sh -Action set -Key TEST_KEY -Value test_value >/dev/null 2>&1; then
            if grep -q "TEST_KEY=test_value" .env 2>/dev/null; then
                test_pass "Config set functionality works"
                # Clean up test key
                sed -i '/^TEST_KEY=/d' .env 2>/dev/null || true
            else
                test_fail "Config set functionality failed - value not found"
            fi
        else
            test_fail "Config set functionality failed - command error"
        fi
        
        # Test reset functionality
        if ./config.sh -Action reset >/dev/null 2>&1; then
            test_pass "Config reset functionality works"
        else
            test_fail "Config reset functionality failed"
        fi
    else
        test_fail "config.sh script not found"
    fi
    
    # Restore backup if it exists
    if [[ -n "$env_backup" && -f "$env_backup" ]]; then
        mv "$env_backup" ".env"
    fi
}

# Test 4: Directory Structure
test_directory_structure() {
    test_start "Directory Structure Validation"
    
    local required_dirs=("repo-data" "sync-logs" "backups" ".vscode")
    for dir in "${required_dirs[@]}"; do
        if [[ -d "$dir" ]]; then
            test_pass "Directory exists: $dir"
        else
            test_fail "Missing directory: $dir"
        fi
    done
    
    # Check for important files
    local required_files=("docker-compose.yml" ".env.example" "README.md")
    for file in "${required_files[@]}"; do
        if [[ -f "$file" ]]; then
            test_pass "Required file exists: $file"
        else
            test_fail "Missing required file: $file"
        fi
    done
}

# Test 5: Docker Configuration
test_docker_config() {
    test_start "Docker Configuration Validation"
    
    # Test docker-compose file syntax
    if command -v docker-compose >/dev/null 2>&1; then
        DOCKER_COMPOSE_CMD="docker-compose"
    else
        DOCKER_COMPOSE_CMD="docker compose"
    fi
    
    if $DOCKER_COMPOSE_CMD config >/dev/null 2>&1; then
        test_pass "docker-compose.yml syntax is valid"
    else
        test_fail "docker-compose.yml has syntax errors"
    fi
    
    # Test that required services are defined
    if $DOCKER_COMPOSE_CMD config 2>/dev/null | grep -q "ghidra-server"; then
        test_pass "ghidra-server service is defined"
    else
        test_fail "ghidra-server service not found in docker-compose.yml"
    fi
}

# Test 6: Backup System (without actually creating large backups)
test_backup_system() {
    test_start "Backup System Validation"
    
    # Test backup script help
    if [[ -f "backup.sh" ]]; then
        if ./backup.sh --help >/dev/null 2>&1; then
            test_pass "Backup script help works"
        else
            test_fail "Backup script help failed"
        fi
    else
        test_fail "backup.sh script not found"
    fi
    
    # Test restore script help
    if [[ -f "restore.sh" ]] && ./restore.sh --help >/dev/null 2>&1; then
        test_pass "Restore script help works"
    else
        test_fail "Restore script help failed or script missing"
    fi
}

# Test 7: VS Code Integration
test_vscode_integration() {
    test_start "VS Code Integration"
    
    # Check tasks.json
    if [[ -f ".vscode/tasks.json" ]]; then
        # Validate JSON syntax
        if command -v jq >/dev/null 2>&1; then
            if jq . ".vscode/tasks.json" >/dev/null 2>&1; then
                test_pass "tasks.json syntax is valid"
            else
                test_fail "tasks.json has syntax errors"
            fi
        else
            # Fallback validation without jq
            if python3 -c "import json; json.load(open('.vscode/tasks.json'))" 2>/dev/null; then
                test_pass "tasks.json syntax is valid (python validation)"
            else
                test_fail "tasks.json syntax validation failed"
            fi
        fi
    else
        test_fail ".vscode/tasks.json not found"
    fi
    
    # Check extensions.json
    if [[ -f ".vscode/extensions.json" ]]; then
        if command -v jq >/dev/null 2>&1; then
            if jq . ".vscode/extensions.json" >/dev/null 2>&1; then
                test_pass "extensions.json syntax is valid"
            else
                test_fail "extensions.json has syntax errors"
            fi
        else
            # Fallback validation
            if python3 -c "import json; json.load(open('.vscode/extensions.json'))" 2>/dev/null; then
                test_pass "extensions.json syntax is valid (python validation)"
            else
                test_fail "extensions.json syntax validation failed"
            fi
        fi
    else
        test_fail ".vscode/extensions.json not found"
    fi
}

# Test 8: Documentation Quality
test_documentation() {
    test_start "Documentation Quality Check"
    
    local docs=("README.md" "CONTRIBUTING.md" "SECURITY.md" "CODE_OF_CONDUCT.md")
    for doc in "${docs[@]}"; do
        if [[ -f "$doc" ]]; then
            # Check if file has content (more than just a title)
            local line_count=$(wc -l < "$doc")
            if (( line_count > 5 )); then
                test_pass "Documentation exists and has content: $doc"
            else
                test_fail "Documentation too short or empty: $doc"
            fi
        else
            test_fail "Missing documentation: $doc"
        fi
    done
    
    # Check for license
    if [[ -f "LICENSE" ]]; then
        test_pass "LICENSE file exists"
    else
        test_fail "LICENSE file missing"
    fi
}

# Main test execution
main() {
    log "${CYAN}=== Ghidra RE Platform - Automated Test Suite ===${NC}"
    log "Running comprehensive validation tests..."
    
    # Run all test suites
    test_prerequisites
    test_script_syntax  
    test_configuration
    test_directory_structure
    test_docker_config
    test_backup_system
    test_vscode_integration
    test_documentation
    
    # Test summary
    echo -e "\n${CYAN}=== Test Results Summary ===${NC}"
    echo -e "${WHITE}Tests Run: ${TESTS_RUN:-0}${NC}"
    echo -e "${GREEN}Passed: ${TESTS_PASSED:-0}${NC}"
    echo -e "${RED}Failed: ${TESTS_FAILED:-0}${NC}"
    
    if [[ ${TESTS_FAILED:-0} -gt 0 ]]; then
        echo -e "\n${RED}❌ Some tests failed. Please review the output above.${NC}"
        exit 1
    else
        echo -e "\n${GREEN}✅ All tests passed! Project is ready for production.${NC}"
        exit 0
    fi
}

# Run tests
main "$@"
