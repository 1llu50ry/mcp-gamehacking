#!/bin/bash
#
# stop-bsim.sh - Stop Ghidra BSim PostgreSQL Database
#
# This script safely stops the BSim PostgreSQL container
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
        exit 1
    fi
}

# Function to stop the container
stop_container() {
    if docker ps --format "table {{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
        print_status "Stopping BSim PostgreSQL container..."
        docker-compose down bsim-postgres
        print_success "Container stopped successfully"
    else
        print_warning "Container $CONTAINER_NAME is not running"
    fi
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --help       Show this help message"
    echo "  -f, --force      Force stop the container"
    echo "  -r, --remove     Remove the container after stopping"
    echo "  -v, --volumes    Also remove volumes (WARNING: data loss!)"
    echo ""
    echo "This script safely stops the Ghidra BSim PostgreSQL database container"
}

# Parse command line arguments
FORCE=false
REMOVE=false
REMOVE_VOLUMES=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_usage
            exit 0
            ;;
        -f|--force)
            FORCE=true
            shift
            ;;
        -r|--remove)
            REMOVE=true
            shift
            ;;
        -v|--volumes)
            REMOVE_VOLUMES=true
            shift
            ;;
        *)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Main execution
main() {
    print_status "Stopping Ghidra BSim PostgreSQL Database..."

    # Check Docker
    check_docker

    # Stop container
    if [[ "$FORCE" == "true" ]]; then
        print_status "Force stopping container..."
        docker kill $CONTAINER_NAME 2>/dev/null || true
    else
        stop_container
    fi

    # Remove container if requested
    if [[ "$REMOVE" == "true" ]]; then
        if docker ps -a --format "table {{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
            print_status "Removing container..."
            docker rm $CONTAINER_NAME
            print_success "Container removed"
        fi
    fi

    # Remove volumes if requested
    if [[ "$REMOVE_VOLUMES" == "true" ]]; then
        print_warning "This will delete ALL BSim data permanently!"
        read -p "Are you sure? (yes/no): " confirm
        if [[ "$confirm" == "yes" ]]; then
            print_status "Removing volumes..."
            docker volume rm re-universe_bsim_postgres_data 2>/dev/null || print_warning "Volume not found"
            docker volume rm re-universe_bsim_ssl_certs 2>/dev/null || print_warning "SSL volume not found"
            print_success "Volumes removed"
        else
            print_status "Volume removal cancelled"
        fi
    fi

    print_success "BSim database stopped successfully!"
}

# Run main function
main "$@"