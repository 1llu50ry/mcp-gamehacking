#!/bin/bash

# Automated Ghidra Script BSim Population Workflow
# This script runs the Ghidra BSim population script on multiple binaries

GHIDRA_DIR="./ghidra/Ghidra/RuntimeScripts/Linux/support"
SCRIPT_DIR="/opt/re-universe/ghidra-scripts"
PROJECT_DIR="/tmp/ghidra_bsim_projects"
PROJECT_NAME="BSim_CrossVersion_Analysis"
BINARIES_DIR="/path/to/your/binaries"  # Update this path

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

# Function to run Ghidra script on a single binary
process_binary_with_script() {
    local binary_path="$1"
    local binary_name=$(basename "$binary_path")

    log_info "Processing $binary_name with Ghidra script..."

    # Create unique project for this binary
    local project_name="${PROJECT_NAME}_${binary_name//[^a-zA-Z0-9]/_}"

    # Run Ghidra headless with our BSim script
    if "$GHIDRA_DIR/analyzeHeadless" \
        "$PROJECT_DIR" "$project_name" \
        -import "$binary_path" \
        -scriptPath "$SCRIPT_DIR" \
        -postScript "AddProgramToBSimDatabase.java" \
        -deleteProject > "/tmp/ghidra_script_${binary_name}.log" 2>&1; then

        log_success "Successfully processed $binary_name with BSim script"
        return 0
    else
        log_error "Failed to process $binary_name with BSim script"
        echo "Check log file: /tmp/ghidra_script_${binary_name}.log"
        return 1
    fi
}

# Function to process directory of binaries
process_directory_with_script() {
    local dir="$1"
    local pattern="$2"

    log_info "Processing binaries in $dir matching pattern: $pattern"

    local count=0
    local success_count=0

    for binary in "$dir"/$pattern; do
        if [[ -f "$binary" ]]; then
            count=$((count + 1))
            log_info "Processing binary $count: $(basename "$binary")"

            if process_binary_with_script "$binary"; then
                success_count=$((success_count + 1))
            fi

            # Add small delay to prevent overwhelming the database
            sleep 2
        fi
    done

    log_info "Processed $success_count/$count binaries successfully"
}

# Function to check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check if Ghidra tools exist
    if [[ ! -f "$GHIDRA_DIR/analyzeHeadless" ]]; then
        log_error "Ghidra headless analyzer not found at $GHIDRA_DIR/analyzeHeadless"
        exit 1
    fi

    # Check if our script exists
    if [[ ! -f "$SCRIPT_DIR/AddProgramToBSimDatabase.java" ]]; then
        log_error "BSim script not found at $SCRIPT_DIR/AddProgramToBSimDatabase.java"
        exit 1
    fi

    # Create project directory
    mkdir -p "$PROJECT_DIR"

    # Check database connectivity
    if docker exec -i bsim-postgres psql -U ben -d bsim -c "SELECT 1;" > /dev/null 2>&1; then
        log_success "Database connection verified"
    else
        log_error "Cannot connect to BSim database"
        exit 1
    fi

    log_success "All prerequisites checked"
}

# Function to show current database status
show_database_status() {
    log_info "Checking current BSim database status..."

    docker exec -i bsim-postgres psql -U ben -d bsim -c "
        SELECT
            COUNT(*) as total_functions,
            COUNT(DISTINCT d.name_func) as unique_function_names,
            COUNT(DISTINCT e.name_exec) as total_executables
        FROM desctable d
        JOIN exetable e ON d.id_exe = e.id;

        SELECT COUNT(*) as cross_version_functions FROM function_evolution;
    " 2>/dev/null || log_warning "Could not retrieve database status"
}

# Function to refresh all materialized views
refresh_views() {
    log_info "Refreshing materialized views for cross-version analysis..."

    docker exec -i bsim-postgres psql -U ben -d bsim -c "
        REFRESH MATERIALIZED VIEW cross_version_functions;
        REFRESH MATERIALIZED VIEW function_evolution;
        SELECT 'Views refreshed successfully' as status;
    " > /dev/null 2>&1

    if [[ $? -eq 0 ]]; then
        log_success "Materialized views refreshed"
    else
        log_warning "Could not refresh materialized views"
    fi
}

# Main execution function
main() {
    log_info "Starting automated Ghidra BSim population workflow"

    case "$1" in
        "single")
            if [[ -z "$2" ]]; then
                log_error "Usage: $0 single <binary_path>"
                exit 1
            fi
            check_prerequisites
            show_database_status
            process_binary_with_script "$2"
            refresh_views
            show_database_status
            ;;
        "directory")
            if [[ -z "$2" ]]; then
                log_error "Usage: $0 directory <directory_path> [pattern]"
                exit 1
            fi
            local pattern="${3:-*.exe}"
            check_prerequisites
            show_database_status
            process_directory_with_script "$2" "$pattern"
            refresh_views
            show_database_status
            ;;
        "examples")
            check_prerequisites
            show_database_status
            log_info "Processing example Diablo II binaries..."
            # Process different binary types
            process_directory_with_script "$BINARIES_DIR" "Classic_*_Game.exe"
            process_directory_with_script "$BINARIES_DIR" "LoD_*_Game.exe"
            process_directory_with_script "$BINARIES_DIR" "*_D2Game.dll"
            refresh_views
            show_database_status
            ;;
        "status")
            check_prerequisites
            show_database_status
            ;;
        "refresh")
            check_prerequisites
            refresh_views
            show_database_status
            ;;
        *)
            echo "Automated Ghidra BSim Population Workflow"
            echo ""
            echo "Usage: $0 {single|directory|examples|status|refresh}"
            echo ""
            echo "Commands:"
            echo "  single <binary_path>           - Process single binary with Ghidra script"
            echo "  directory <dir> [pattern]      - Process all binaries in directory"
            echo "  examples                       - Process example Diablo II binaries"
            echo "  status                         - Show current database status"
            echo "  refresh                        - Refresh materialized views"
            echo ""
            echo "Examples:"
            echo "  $0 single /path/to/Classic_1.03_Game.exe"
            echo "  $0 single /path/to/1.03_D2Game.dll"
            echo "  $0 directory /path/to/binaries '*.exe'"
            echo "  $0 examples"
            echo "  $0 status"
            echo ""
            echo "The script will:"
            echo "  1. Import binary into Ghidra"
            echo "  2. Run AddProgramToBSimDatabase.java script"
            echo "  3. Add functions to BSim database"
            echo "  4. Update cross-version analysis views"
            exit 1
            ;;
    esac

    log_success "Automated BSim population workflow completed"
}

main "$@"