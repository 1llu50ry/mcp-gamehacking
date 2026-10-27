#!/bin/bash
# Quick Test Runner for GitHub Actions
# Simplified test suite for CI/CD validation

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}=== Quick Test Suite ===${NC}"

# Test 1: Basic Prerequisites
echo -e "${CYAN}[1/5] Checking Prerequisites${NC}"
if command -v docker >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Docker available${NC}"
else
    echo -e "${RED}❌ Docker not found${NC}"
    exit 1
fi

if command -v docker-compose >/dev/null 2>&1 || docker compose version >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Docker Compose available${NC}"
else
    echo -e "${RED}❌ Docker Compose not found${NC}"
    exit 1
fi

# Test 2: Script Syntax
echo -e "${CYAN}[2/5] Validating Script Syntax${NC}"
SYNTAX_ERRORS=0

for script in *.sh; do
    if [[ -f "$script" ]]; then
        if bash -n "$script" 2>/dev/null; then
            echo -e "${GREEN}✅ $script syntax valid${NC}"
        else
            echo -e "${RED}❌ $script syntax error${NC}"
            ((SYNTAX_ERRORS++))
        fi
    fi
done

if (( SYNTAX_ERRORS > 0 )); then
    echo -e "${RED}Found $SYNTAX_ERRORS syntax errors${NC}"
    exit 1
fi

# Test 3: Configuration
echo -e "${CYAN}[3/5] Testing Configuration${NC}"
if [[ -f "config.sh" ]]; then
    chmod +x config.sh
    if ./config.sh -Action validate >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Configuration validation passed${NC}"
    else
        echo -e "${RED}❌ Configuration validation failed${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ config.sh not found${NC}"
    exit 1
fi

# Test 4: Setup Process
echo -e "${CYAN}[4/5] Testing Setup Process${NC}"
if [[ -f "setup.sh" ]]; then
    chmod +x setup.sh
    if ./setup.sh >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Setup process completed${NC}"
    else
        echo -e "${RED}❌ Setup process failed${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ setup.sh not found${NC}"
    exit 1
fi

# Test 5: File Structure
echo -e "${CYAN}[5/5] Validating File Structure${NC}"
REQUIRED_FILES=("docker-compose.yml" ".env.example" "README.md")
MISSING_FILES=0

for file in "${REQUIRED_FILES[@]}"; do
    if [[ -f "$file" ]]; then
        echo -e "${GREEN}✅ $file exists${NC}"
    else
        echo -e "${RED}❌ Missing: $file${NC}"
        ((MISSING_FILES++))
    fi
done

if (( MISSING_FILES > 0 )); then
    echo -e "${RED}Missing $MISSING_FILES required files${NC}"
    exit 1
fi

echo -e "\n${GREEN}🎉 All quick tests passed!${NC}"
echo -e "${CYAN}Platform is ready for GitHub Actions testing${NC}"
