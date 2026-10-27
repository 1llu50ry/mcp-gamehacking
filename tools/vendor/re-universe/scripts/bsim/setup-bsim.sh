#!/bin/bash

# Ghidra BSim Database Setup Script
# This script sets up a BSim database using the official Ghidra BSim tools
#
# Prerequisites:
# - Ghidra installed with BSim extension built (make-postgres.sh executed)
# - PostgreSQL container running with BSim database
# - Network connectivity between host and container

set -e

# Default values
GHIDRA_INSTALL_DIR=""
DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="bsim"
DB_USER="ben"
DB_PASSWORD="${BSIM_DB_PASSWORD}"
DB_TEMPLATE="medium_32"
FORCE=false
VERBOSE=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -g|--ghidra-dir)
            GHIDRA_INSTALL_DIR="$2"
            shift 2
            ;;
        --host)
            DB_HOST="$2"
            shift 2
            ;;
        --port)
            DB_PORT="$2"
            shift 2
            ;;
        --database)
            DB_NAME="$2"
            shift 2
            ;;
        --user)
            DB_USER="$2"
            shift 2
            ;;
        --password)
            DB_PASSWORD="$2"
            shift 2
            ;;
        --template)
            DB_TEMPLATE="$2"
            shift 2
            ;;
        --force)
            FORCE=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -g, --ghidra-dir DIR    Ghidra installation directory"
            echo "  --host HOST             Database host (default: localhost)"
            echo "  --port PORT             Database port (default: 5432)"
            echo "  --database NAME         Database name (default: bsim)"
            echo "  --user USER             Database user (default: ben)"
            echo "  --password PASS         Database password (default: bsim)"
            echo "  --template TEMPLATE     BSim database template (default: medium_32)"
            echo "  --force                 Force database creation even if exists"
            echo "  -v, --verbose           Verbose output"
            echo "  -h, --help              Show this help message"
            echo ""
            echo "Available templates:"
            echo "  - small_32          Small database for 32-bit binaries"
            echo "  - small_64          Small database for 64-bit binaries"
            echo "  - medium_32         Medium database for 32-bit binaries"
            echo "  - medium_64         Medium database for 64-bit binaries"
            echo "  - medium_nosize     Medium database with size-agnostic matching"
            echo "  - large_32          Large database for 32-bit binaries"
            echo "  - large_64          Large database for 64-bit binaries"
            echo ""
            echo "Example:"
            echo "  $0 --ghidra-dir /opt/ghidra --template medium_nosize"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use -h or --help for usage information"
            exit 1
            ;;
    esac
done

# Logging function
log() {
    local message="$1"
    local level="${2:-INFO}"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    case $level in
        "ERROR")
            echo -e "${RED}[$timestamp] [ERROR] $message${NC}"
            ;;
        "WARN")
            echo -e "${YELLOW}[$timestamp] [WARN] $message${NC}"
            ;;
        "SUCCESS")
            echo -e "${GREEN}[$timestamp] [SUCCESS] $message${NC}"
            ;;
        *)
            echo -e "${WHITE}[$timestamp] [INFO] $message${NC}"
            ;;
    esac
}

# Detect Ghidra installation
detect_ghidra() {
    if [[ -n "$GHIDRA_INSTALL_DIR" && -d "$GHIDRA_INSTALL_DIR" ]]; then
        log "Using provided Ghidra directory: $GHIDRA_INSTALL_DIR"
        return 0
    fi

    # Try common installation paths
    local common_paths=(
        "/opt/ghidra"
        "/usr/local/ghidra"
        "$HOME/ghidra"
        "$(find /opt -maxdepth 2 -name "ghidra_*" -type d 2>/dev/null | head -1)"
        "$(find /usr/local -maxdepth 2 -name "ghidra_*" -type d 2>/dev/null | head -1)"
    )

    for path in "${common_paths[@]}"; do
        if [[ -n "$path" && -d "$path/support" && -f "$path/support/bsim" ]]; then
            GHIDRA_INSTALL_DIR="$path"
            log "Auto-detected Ghidra installation: $GHIDRA_INSTALL_DIR"
            return 0
        fi
    done

    log "Could not find Ghidra installation. Please specify with --ghidra-dir" "ERROR"
    exit 1
}

# Verify Ghidra BSim tools
verify_bsim_tools() {
    local bsim_script="$GHIDRA_INSTALL_DIR/support/bsim"
    local bsim_ctl_script="$GHIDRA_INSTALL_DIR/support/bsim_ctl"

    if [[ ! -f "$bsim_script" ]]; then
        log "BSim script not found: $bsim_script" "ERROR"
        exit 1
    fi

    if [[ ! -x "$bsim_script" ]]; then
        log "Making BSim script executable: $bsim_script"
        chmod +x "$bsim_script"
    fi

    if [[ -f "$bsim_ctl_script" && ! -x "$bsim_ctl_script" ]]; then
        log "Making BSim control script executable: $bsim_ctl_script"
        chmod +x "$bsim_ctl_script"
    fi

    log "BSim tools verified successfully" "SUCCESS"
}

# Test database connectivity
test_connectivity() {
    log "Testing PostgreSQL connectivity..."

    if command -v psql > /dev/null; then
        if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT bsim_connectivity_test();" 2>/dev/null; then
            log "Database connectivity test successful" "SUCCESS"
            return 0
        fi
    fi

    # Try with docker if psql not available
    if docker exec bsim-postgres psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT bsim_connectivity_test();" 2>/dev/null; then
        log "Database connectivity test successful (via Docker)" "SUCCESS"
        return 0
    fi

    log "Database connectivity test failed" "ERROR"
    exit 1
}

# Create BSim database
create_bsim_database() {
    local bsim_script="$GHIDRA_INSTALL_DIR/support/bsim"
    local db_url="postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME"

    log "Creating BSim database with template: $DB_TEMPLATE"
    log "Database URL: postgresql://$DB_USER:***@$DB_HOST:$DB_PORT/$DB_NAME"

    cd "$GHIDRA_INSTALL_DIR/support" || exit 1

    if [[ "$VERBOSE" == "true" ]]; then
        log "Executing: ./bsim createdatabase $db_url $DB_TEMPLATE --user $DB_USER"
    fi

    # Execute the BSim database creation
    if ./bsim createdatabase "$db_url" "$DB_TEMPLATE" --user "$DB_USER"; then
        log "BSim database created successfully with template: $DB_TEMPLATE" "SUCCESS"
        return 0
    else
        log "Failed to create BSim database" "ERROR"
        return 1
    fi
}

# Add executable categories
add_executable_categories() {
    local bsim_script="$GHIDRA_INSTALL_DIR/support/bsim"
    local db_url="postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME"

    log "Adding default executable categories..."

    cd "$GHIDRA_INSTALL_DIR/support" || exit 1

    # Add common categories
    local categories=("UNKNOWN" "LIBRARY" "EXECUTABLE" "DRIVER" "MALWARE")

    for category in "${categories[@]}"; do
        if [[ "$VERBOSE" == "true" ]]; then
            log "Adding category: $category"
        fi

        if ./bsim addexecategory "$db_url" "$category" 2>/dev/null; then
            log "Added category: $category" "SUCCESS"
        else
            log "Category may already exist: $category" "WARN"
        fi
    done
}

# Main execution
main() {
    echo -e "${CYAN}=== Ghidra BSim Database Setup ===${NC}"
    echo ""

    # Load configuration from .env file if it exists
    if [[ -f ".env" ]]; then
        log "Loading configuration from .env file..."
        source .env
        DB_NAME=${BSIM_DB_NAME:-$DB_NAME}
        DB_USER=${BSIM_DB_USER:-$DB_USER}
        DB_PASSWORD=${BSIM_DB_PASSWORD:-$DB_PASSWORD}
        DB_PORT=${BSIM_DB_PORT:-$DB_PORT}
    fi

    log "Configuration: Host=$DB_HOST, Port=$DB_PORT, DB=$DB_NAME, User=$DB_USER, Template=$DB_TEMPLATE"

    # Detect and verify Ghidra installation
    detect_ghidra
    verify_bsim_tools

    # Test database connectivity
    test_connectivity

    # Create BSim database
    if create_bsim_database; then
        add_executable_categories

        echo ""
        echo -e "${GREEN}=== BSim Database Setup Complete ===${NC}"
        echo -e "${WHITE}Database URL: postgresql://$DB_USER@$DB_HOST:$DB_PORT/$DB_NAME${NC}"
        echo -e "${WHITE}Template used: $DB_TEMPLATE${NC}"
        echo ""
        echo -e "${CYAN}=== Next Steps ===${NC}"
        echo -e "${WHITE}1. Configure Ghidra BSim to connect to this database${NC}"
        echo -e "${WHITE}2. Use the BSim plugin in Ghidra to populate the database${NC}"
        echo -e "${WHITE}3. Run similarity searches using the BSim interface${NC}"
        echo ""
        echo -e "${CYAN}=== Useful Commands ===${NC}"
        echo -e "${WHITE}List databases: ./bsim listdbs postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/${NC}"
        echo -e "${WHITE}Drop database:  ./bsim dropdatabase postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME${NC}"
    else
        echo ""
        echo -e "${RED}=== BSim Database Setup Failed ===${NC}"
        echo -e "${WHITE}Please check the error messages above and try again${NC}"
        exit 1
    fi
}

# Run main function
main "$@"