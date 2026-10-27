#!/bin/bash

# Cross-Version BSim Data Population Script
# This script processes multiple versions of binaries for cross-version analysis

DB_URL="postgresql://${BSIM_DB_USER:-bsim_user}:${BSIM_DB_PASSWORD}@${BSIM_DB_HOST:-localhost}:${BSIM_DB_PORT:-5432}/${BSIM_DB_NAME:-bsim}"
GHIDRA_DIR="./ghidra/Ghidra/RuntimeScripts/Linux/support"
BINARIES_DIR="/path/to/your/binaries"  # Update this path
PROJECT_DIR="/tmp/ghidra_projects"
PROJECT_NAME="CrossVersionAnalysis"

# Create project directory
mkdir -p "$PROJECT_DIR"

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

# Function to process a single binary
process_binary() {
    local binary_path="$1"
    local binary_name=$(basename "$binary_path")

    log_info "Processing $binary_name..."

    # Step 1: Import and analyze with Ghidra
    log_info "Analyzing $binary_name with Ghidra..."
    if "$GHIDRA_DIR/analyzeHeadless" \
        "$PROJECT_DIR" "$PROJECT_NAME" \
        -import "$binary_path" \
        -noanalysis \
        -postScript BSim.java \
        -deleteProject > /tmp/ghidra_${binary_name}.log 2>&1; then
        log_success "Analysis completed for $binary_name"
    else
        log_error "Analysis failed for $binary_name"
        return 1
    fi

    # Step 2: Generate BSim signatures
    log_info "Generating BSim signatures for $binary_name..."
    if "$GHIDRA_DIR/analyzeHeadless" \
        "$PROJECT_DIR" "$PROJECT_NAME" \
        -process "$binary_name" \
        -postScript GenerateBSimSignatures.java >> /tmp/ghidra_${binary_name}.log 2>&1; then
        log_success "Signatures generated for $binary_name"
    else
        log_warning "Signature generation had issues for $binary_name (check log)"
    fi

    # Step 3: Commit to BSim database
    log_info "Committing $binary_name to BSim database..."
    if "$GHIDRA_DIR/bsim" "$DB_URL" -commit "$binary_path" > /tmp/bsim_${binary_name}.log 2>&1; then
        log_success "Successfully committed $binary_name to BSim database"
        return 0
    else
        log_error "Failed to commit $binary_name to BSim database"
        return 1
    fi
}

# Function to process all binaries in directory
process_directory() {
    local dir="$1"
    local pattern="$2"

    log_info "Processing binaries in $dir matching pattern: $pattern"

    local count=0
    local success_count=0

    for binary in "$dir"/$pattern; do
        if [[ -f "$binary" ]]; then
            count=$((count + 1))
            if process_binary "$binary"; then
                success_count=$((success_count + 1))
            fi
        fi
    done

    log_info "Processed $success_count/$count binaries successfully"
}

# Function to check database status
check_database() {
    log_info "Checking BSim database status..."
    if "$GHIDRA_DIR/bsim" "$DB_URL" -info > /tmp/bsim_info.log 2>&1; then
        log_success "BSim database is accessible"
        cat /tmp/bsim_info.log
    else
        log_error "Cannot connect to BSim database"
        exit 1
    fi
}

# Main execution
main() {
    log_info "Starting cross-version BSim data population"

    # Check prerequisites
    if [[ ! -f "$GHIDRA_DIR/bsim" ]]; then
        log_error "BSim tool not found at $GHIDRA_DIR/bsim"
        exit 1
    fi

    if [[ ! -f "$GHIDRA_DIR/analyzeHeadless" ]]; then
        log_error "Ghidra headless analyzer not found at $GHIDRA_DIR/analyzeHeadless"
        exit 1
    fi

    # Check database connectivity
    check_database

    # Process binaries based on command line arguments
    case "$1" in
        "single")
            if [[ -z "$2" ]]; then
                log_error "Usage: $0 single <binary_path>"
                exit 1
            fi
            process_binary "$2"
            ;;
        "directory")
            if [[ -z "$2" ]]; then
                log_error "Usage: $0 directory <directory_path> [pattern]"
                exit 1
            fi
            local pattern="${3:-*.exe}"
            process_directory "$2" "$pattern"
            ;;
        "examples")
            log_info "Processing example Diablo II binaries..."
            # Example patterns for Diablo II versions
            process_directory "$BINARIES_DIR" "Classic_*_Game.exe"
            process_directory "$BINARIES_DIR" "LoD_*_Game.exe"
            process_directory "$BINARIES_DIR" "*_D2Game.dll"
            ;;
        *)
            echo "Usage: $0 {single|directory|examples}"
            echo ""
            echo "Commands:"
            echo "  single <binary_path>              - Process a single binary"
            echo "  directory <dir> [pattern]          - Process all binaries in directory"
            echo "  examples                           - Process example Diablo II binaries"
            echo ""
            echo "Examples:"
            echo "  $0 single /path/to/Classic_1.00_Game.exe"
            echo "  $0 directory /path/to/binaries '*.exe'"
            echo "  $0 examples"
            exit 1
            ;;
    esac

    log_success "Cross-version data population completed"
}

main "$@"