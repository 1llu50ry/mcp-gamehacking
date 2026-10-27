#!/bin/bash
#
# start-bsim.sh - Start Ghidra BSim PostgreSQL Database
#
# This script starts the BSim PostgreSQL container and verifies the setup
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CONTAINER_NAME="bsim-postgres"
ENV_FILE=".env"
DOCKER_COMPOSE_FILE="docker-compose.yml"

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if Docker is running
check_docker() {
    if ! docker ps >/dev/null 2>&1; then
        print_error "Docker is not running or not accessible"
        print_error "Please start Docker and try again"
        exit 1
    fi
}

# Function to check if environment file exists
check_env_file() {
    if [[ ! -f "$ENV_FILE" ]]; then
        print_warning "Environment file $ENV_FILE not found"
        print_status "Creating default environment file..."

        cat > "$ENV_FILE" << 'EOF'
# BSim Database Configuration
BSIM_DB_NAME=bsim
BSIM_DB_USER=bsim_user
BSIM_DB_PASSWORD=CHANGE_ME_SECURE_PASSWORD
BSIM_DB_PORT=5432
EOF
        print_success "Created $ENV_FILE with default BSim configuration"
        print_error "SECURITY WARNING: Default credentials created!"
        print_error "You MUST change BSIM_DB_PASSWORD before production use!"
        print_error "See PRODUCTION-SECURITY.md for guidance."
    fi
}

# Function to validate security settings
validate_security() {
    if [[ -f "$ENV_FILE" ]]; then
        if grep -q "CHANGE_ME_SECURE_PASSWORD\|bsim\|bsim_password" "$ENV_FILE"; then
            print_error "SECURITY WARNING: Default/insecure passwords detected!"
            print_error "Change credentials in $ENV_FILE before production use."
            print_error "See PRODUCTION-SECURITY.md for guidance."

            read -p "Continue anyway? (NOT recommended for production) [y/N]: " confirm
            if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
                print_status "Stopped for security. Please update credentials in $ENV_FILE"
                exit 1
            fi
        fi
    fi
}

# Function to check if docker-compose.yml exists
check_compose_file() {
    if [[ ! -f "$DOCKER_COMPOSE_FILE" ]]; then
        print_error "Docker Compose file $DOCKER_COMPOSE_FILE not found"
        print_error "Please ensure you're in the correct directory"
        exit 1
    fi
}

# Function to start the BSim container
start_container() {
    print_status "Starting BSim PostgreSQL container..."

    if docker ps -a --format "table {{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
        if docker ps --format "table {{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
            print_warning "Container $CONTAINER_NAME is already running"
            return 0
        else
            print_status "Starting existing container..."
            docker-compose up -d bsim-postgres
        fi
    else
        print_status "Creating and starting new container..."
        docker-compose up -d bsim-postgres
    fi
}

# Function to wait for database to be ready
wait_for_database() {
    print_status "Waiting for database to be ready..."

    local max_attempts=30
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        if docker exec $CONTAINER_NAME pg_isready -U ben -d bsim >/dev/null 2>&1; then
            print_success "Database is ready!"
            return 0
        fi

        echo -n "."
        sleep 2
        ((attempt++))
    done

    echo ""
    print_error "Database failed to start within 60 seconds"
    print_error "Check container logs with: docker logs $CONTAINER_NAME"
    return 1
}

# Function to verify BSim setup
verify_bsim_setup() {
    print_status "Verifying BSim database setup..."

    # Check if BSim tables exist
    local tables_result
    tables_result=$(docker exec $CONTAINER_NAME psql -U ben -d bsim -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('keyvaluetable', 'executable', 'function', 'signature');" 2>/dev/null || echo "0")

    if [[ "${tables_result// /}" -ge 4 ]]; then
        print_success "BSim tables found"
    else
        print_warning "BSim tables not found or incomplete"
        print_status "Database schema will be initialized automatically"
    fi

    # Check LSH extension
    if docker exec $CONTAINER_NAME psql -U ben -d bsim -t -c "SELECT 1 FROM pg_extension WHERE extname = 'lsh';" 2>/dev/null | grep -q "1"; then
        print_success "LSH extension is available"
    else
        print_warning "LSH extension not found"
        print_warning "Please ensure the LSH extension is built and installed"
        print_warning "Refer to BSIM-SETUP.md for instructions"
    fi

    # Check SSL configuration
    local ssl_status
    ssl_status=$(docker exec $CONTAINER_NAME psql -U ben -d bsim -t -c "SHOW ssl;" 2>/dev/null || echo "off")

    if [[ "${ssl_status// /}" == "on" ]]; then
        print_success "SSL is enabled"
    else
        print_warning "SSL is not enabled"
    fi
}

# Function to display connection information
show_connection_info() {
    print_success "BSim PostgreSQL Database Started Successfully!"
    echo ""
    echo "Connection Information:"
    echo "  Host:     localhost"
    echo "  Port:     5432"
    echo "  Database: bsim"
    echo "  User:     ben"
    echo "  Password: bsim"
    echo "  URL:      postgresql://ben:bsim@localhost:5432/bsim"
    echo ""
    echo "Ghidra BSim Connection:"
    echo "  1. Open Ghidra → Tools → BSim Search"
    echo "  2. Server: postgresql://ben:bsim@localhost:5432/bsim"
    echo "  3. Enable 'Use SSL'"
    echo ""
    echo "Useful Commands:"
    echo "  Monitor logs:    docker logs -f $CONTAINER_NAME"
    echo "  Connect to DB:   docker exec -it $CONTAINER_NAME psql -U ben -d bsim"
    echo "  Stop container:  ./stop-bsim.sh"
    echo "  Monitor status:  ./monitor-bsim.sh"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --help     Show this help message"
    echo "  -v, --verbose  Enable verbose output"
    echo "  -q, --quiet    Suppress non-error output"
    echo ""
    echo "This script starts the Ghidra BSim PostgreSQL database container"
    echo "and verifies the setup is working correctly."
}

# Parse command line arguments
VERBOSE=false
QUIET=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_usage
            exit 0
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -q|--quiet)
            QUIET=true
            shift
            ;;
        *)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Suppress output if quiet mode
if [[ "$QUIET" == "true" ]]; then
    exec >/dev/null 2>&1
fi

# Main execution
main() {
    print_status "Starting Ghidra BSim PostgreSQL Database..."

    # Pre-flight checks
    check_docker
    check_env_file
    validate_security
    check_compose_file

    # Start the container
    start_container

    # Wait for database to be ready
    if ! wait_for_database; then
        exit 1
    fi

    # Verify BSim setup
    verify_bsim_setup

    # Show connection information
    if [[ "$QUIET" != "true" ]]; then
        show_connection_info
    fi

    print_success "BSim database started successfully!"

    if [[ "$VERBOSE" == "true" ]]; then
        echo ""
        print_status "Container status:"
        docker ps --filter "name=$CONTAINER_NAME"

        echo ""
        print_status "Container resource usage:"
        docker stats --no-stream $CONTAINER_NAME
    fi
}

# Run main function
main "$@"