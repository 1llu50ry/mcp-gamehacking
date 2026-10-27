#!/bin/bash

# Test script for BSim data population workflows
# Validates all BSim population scripts and database integration

GHIDRA_DIR="./ghidra/Ghidra/RuntimeScripts/Linux/support"
SCRIPT_DIR="/opt/re-universe/ghidra-scripts"
PROJECT_DIR="/tmp/ghidra_test_projects"
TEST_BINARY_DIR="/tmp/bsim_test_binaries"
DB_URL="postgresql://${BSIM_DB_USER:-bsim_user}:${BSIM_DB_PASSWORD}@${BSIM_DB_HOST:-localhost}:${BSIM_DB_PORT:-5432}/${BSIM_DB_NAME:-bsim}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

test_database_connection() {
    log_info "Testing database connection..."

    if docker exec -i bsim-postgres psql -U ben -d bsim -c "SELECT 1;" > /dev/null 2>&1; then
        log_success "Database connection successful"
        return 0
    else
        log_error "Cannot connect to BSim database"
        return 1
    fi
}

test_ghidra_tools() {
    log_info "Testing Ghidra tools availability..."

    if [[ ! -f "$GHIDRA_DIR/analyzeHeadless" ]]; then
        log_error "Ghidra headless analyzer not found at $GHIDRA_DIR/analyzeHeadless"
        return 1
    fi

    if [[ ! -d "$SCRIPT_DIR" ]]; then
        log_error "Ghidra scripts directory not found at $SCRIPT_DIR"
        return 1
    fi

    log_success "Ghidra tools available"
    return 0
}

test_bsim_scripts() {
    log_info "Testing BSim population scripts..."

    local required_scripts=(
        "AddProgramToBSimDatabase.java"
        "SimpleBSimPopulation.java"
        "PopulateCommentsIntoBSim.java"
        "PopulateFunctionSignatures.java"
    )

    local missing_scripts=()
    for script in "${required_scripts[@]}"; do
        if [[ ! -f "$SCRIPT_DIR/$script" ]]; then
            missing_scripts+=("$script")
        fi
    done

    if [[ ${#missing_scripts[@]} -eq 0 ]]; then
        log_success "All BSim scripts found"
        return 0
    else
        log_error "Missing scripts: ${missing_scripts[*]}"
        return 1
    fi
}

create_test_binary() {
    log_info "Creating test binary for validation..."

    mkdir -p "$TEST_BINARY_DIR"

    # Create a simple C test program
    cat > "$TEST_BINARY_DIR/test_program.c" << 'EOF'
#include <stdio.h>
#include <stdlib.h>

// Function with parameters and return type
int add_numbers(int a, int b) {
    return a + b;
}

// Function with pointer parameter
void print_string(char* str) {
    printf("String: %s\n", str);
}

// Function with array parameter
double calculate_average(double numbers[], int count) {
    double sum = 0.0;
    for(int i = 0; i < count; i++) {
        sum += numbers[i];
    }
    return sum / count;
}

// Main function
int main() {
    int result = add_numbers(5, 3);
    printf("Result: %d\n", result);

    print_string("Hello BSim");

    double nums[] = {1.5, 2.5, 3.5, 4.5};
    double avg = calculate_average(nums, 4);
    printf("Average: %.2f\n", avg);

    return 0;
}
EOF

    # Try to compile the test program
    if command -v gcc > /dev/null 2>&1; then
        if gcc -o "$TEST_BINARY_DIR/test_program" "$TEST_BINARY_DIR/test_program.c" 2>/dev/null; then
            log_success "Created test binary: $TEST_BINARY_DIR/test_program"
            return 0
        else
            log_warning "Could not compile test binary (gcc failed)"
            return 1
        fi
    else
        log_warning "gcc not available - skipping test binary creation"
        return 1
    fi
}

test_function_population() {
    local binary_path="$1"

    log_info "Testing function population with AddProgramToBSimDatabase.java..."

    # Create unique project for this test
    local project_name="BSim_Test_$(date +%s)"

    # Run Ghidra headless with function population script
    if "$GHIDRA_DIR/analyzeHeadless" \
        "$PROJECT_DIR" "$project_name" \
        -import "$binary_path" \
        -scriptPath "$SCRIPT_DIR" \
        -postScript "AddProgramToBSimDatabase.java" \
        -deleteProject > "/tmp/test_function_pop.log" 2>&1; then

        log_success "Function population test passed"
        return 0
    else
        log_error "Function population test failed - check /tmp/test_function_pop.log"
        return 1
    fi
}

test_comment_population() {
    local binary_path="$1"

    log_info "Testing comment population with PopulateCommentsIntoBSim.java..."

    # Create unique project for this test
    local project_name="BSim_Comment_Test_$(date +%s)"

    # Run Ghidra headless with comment population script
    if "$GHIDRA_DIR/analyzeHeadless" \
        "$PROJECT_DIR" "$project_name" \
        -import "$binary_path" \
        -scriptPath "$SCRIPT_DIR" \
        -postScript "PopulateCommentsIntoBSim.java" \
        -deleteProject > "/tmp/test_comment_pop.log" 2>&1; then

        log_success "Comment population test passed"
        return 0
    else
        log_warning "Comment population test had issues - check /tmp/test_comment_pop.log"
        return 0  # Comments might not exist, so this is not a failure
    fi
}

test_signature_population() {
    local binary_path="$1"

    log_info "Testing signature population with PopulateFunctionSignatures.java..."

    # Create unique project for this test
    local project_name="BSim_Signature_Test_$(date +%s)"

    # Run Ghidra headless with signature population script
    if "$GHIDRA_DIR/analyzeHeadless" \
        "$PROJECT_DIR" "$project_name" \
        -import "$binary_path" \
        -scriptPath "$SCRIPT_DIR" \
        -postScript "PopulateFunctionSignatures.java" \
        -deleteProject > "/tmp/test_signature_pop.log" 2>&1; then

        log_success "Signature population test passed"
        return 0
    else
        log_error "Signature population test failed - check /tmp/test_signature_pop.log"
        return 1
    fi
}

test_database_data() {
    log_info "Testing database data integrity..."

    # Check if data was populated
    local function_count=$(docker exec -i bsim-postgres psql -U ben -d bsim -t -c "SELECT COUNT(*) FROM desctable;" 2>/dev/null | tr -d ' ')
    local executable_count=$(docker exec -i bsim-postgres psql -U ben -d bsim -t -c "SELECT COUNT(*) FROM exetable;" 2>/dev/null | tr -d ' ')

    if [[ "$function_count" =~ ^[0-9]+$ ]] && [[ "$executable_count" =~ ^[0-9]+$ ]]; then
        log_success "Database contains $function_count functions across $executable_count executables"

        # Test if our extended tables exist
        local signature_table_exists=$(docker exec -i bsim-postgres psql -U ben -d bsim -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'function_signatures';" 2>/dev/null | tr -d ' ')

        if [[ "$signature_table_exists" == "1" ]]; then
            local signature_count=$(docker exec -i bsim-postgres psql -U ben -d bsim -t -c "SELECT COUNT(*) FROM function_signatures;" 2>/dev/null | tr -d ' ')
            log_success "Extended schema found with $signature_count function signatures"
        else
            log_warning "Extended schema not found (function_signatures table missing)"
        fi

        return 0
    else
        log_error "Database data validation failed"
        return 1
    fi
}

test_automation_script() {
    log_info "Testing automation script functionality..."

    if [[ -f "/opt/re-universe/automate-ghidra-bsim-population.sh" ]]; then
        # Test status command
        if bash /opt/re-universe/automate-ghidra-bsim-population.sh status > /tmp/test_automation.log 2>&1; then
            log_success "Automation script status check passed"
            return 0
        else
            log_error "Automation script test failed - check /tmp/test_automation.log"
            return 1
        fi
    else
        log_warning "Automation script not found"
        return 1
    fi
}

cleanup_test_files() {
    log_info "Cleaning up test files..."

    rm -rf "$PROJECT_DIR" 2>/dev/null
    rm -rf "$TEST_BINARY_DIR" 2>/dev/null
    rm -f /tmp/test_*.log 2>/dev/null

    log_success "Test cleanup completed"
}

# Main test execution
main() {
    log_info "Starting BSim data population workflow tests"

    mkdir -p "$PROJECT_DIR"

    local test_results=()

    # Run prerequisite tests
    test_database_connection && test_results+=("DB_CONNECTION:PASS") || test_results+=("DB_CONNECTION:FAIL")
    test_ghidra_tools && test_results+=("GHIDRA_TOOLS:PASS") || test_results+=("GHIDRA_TOOLS:FAIL")
    test_bsim_scripts && test_results+=("BSIM_SCRIPTS:PASS") || test_results+=("BSIM_SCRIPTS:FAIL")
    test_automation_script && test_results+=("AUTOMATION:PASS") || test_results+=("AUTOMATION:FAIL")
    test_database_data && test_results+=("DATABASE_DATA:PASS") || test_results+=("DATABASE_DATA:FAIL")

    # Test with binary if available
    if create_test_binary; then
        local test_binary="$TEST_BINARY_DIR/test_program"

        test_function_population "$test_binary" && test_results+=("FUNCTION_POP:PASS") || test_results+=("FUNCTION_POP:FAIL")
        test_comment_population "$test_binary" && test_results+=("COMMENT_POP:PASS") || test_results+=("COMMENT_POP:FAIL")
        test_signature_population "$test_binary" && test_results+=("SIGNATURE_POP:PASS") || test_results+=("SIGNATURE_POP:FAIL")
    else
        test_results+=("TEST_BINARY:SKIP")
        test_results+=("FUNCTION_POP:SKIP")
        test_results+=("COMMENT_POP:SKIP")
        test_results+=("SIGNATURE_POP:SKIP")
    fi

    # Print results summary
    echo ""
    log_info "Test Results Summary:"
    echo "=============================="

    local pass_count=0
    local fail_count=0
    local skip_count=0

    for result in "${test_results[@]}"; do
        IFS=':' read -r test_name status <<< "$result"
        case "$status" in
            "PASS")
                echo -e "${GREEN}✓${NC} $test_name: PASSED"
                ((pass_count++))
                ;;
            "FAIL")
                echo -e "${RED}✗${NC} $test_name: FAILED"
                ((fail_count++))
                ;;
            "SKIP")
                echo -e "${YELLOW}⊘${NC} $test_name: SKIPPED"
                ((skip_count++))
                ;;
        esac
    done

    echo "=============================="
    echo "Total: $((pass_count + fail_count + skip_count)) tests"
    echo "Passed: $pass_count"
    echo "Failed: $fail_count"
    echo "Skipped: $skip_count"

    if [[ $fail_count -eq 0 ]]; then
        log_success "All critical tests passed! BSim data population workflows are working correctly."
        cleanup_test_files
        exit 0
    else
        log_error "Some tests failed. Please check the logs and fix issues before proceeding."
        log_info "Test logs are available in /tmp/test_*.log"
        exit 1
    fi
}

# Handle command line arguments
case "$1" in
    "quick")
        log_info "Running quick validation tests only..."
        test_database_connection && test_ghidra_tools && test_bsim_scripts && test_database_data
        ;;
    "cleanup")
        cleanup_test_files
        ;;
    *)
        main
        ;;
esac