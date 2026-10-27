#!/bin/bash

# Production BSim Deployment Script
# Complete setup for production BSim deployment

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

print_header() {
    echo -e "${BOLD}${BLUE}$1${NC}"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    print_header "🔍 Checking Prerequisites"

    # Check if running as root or with docker permissions
    if ! docker ps > /dev/null 2>&1; then
        print_error "Docker is not accessible. Run with sudo or add user to docker group"
        exit 1
    fi

    # Check if production credentials exist
    if [[ ! -f ".env.production" ]]; then
        print_error "Production environment file not found"
        echo "Run: ./generate-prod-credentials.sh"
        exit 1
    fi

    # Check if SSL certificates exist
    if [[ ! -f "ssl/prod-server.crt" ]]; then
        print_warning "Production SSL certificates not found"
        echo "Run: ./generate-ssl-certs.sh"
    fi

    print_success "Prerequisites check completed"
}

# Deploy production environment
deploy_production() {
    print_header "🚀 Deploying Production Environment"

    # Stop any running development containers
    print_warning "Stopping existing containers..."
    docker-compose down 2>/dev/null || true

    # Load production environment
    source .env.production

    # Create production docker-compose override
    cat > docker-compose.production.yml <<EOF
services:
  bsim-postgres:
    container_name: bsim-postgres-production
    environment:
      - POSTGRES_DB=${BSIM_DB_NAME}
      - POSTGRES_USER=${BSIM_DB_USER}
      - POSTGRES_PASSWORD=${BSIM_DB_PASSWORD}
      - POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=C
    volumes:
      - bsim_postgres_production_data:/var/lib/postgresql/data
      - ./ssl/prod-server.crt:/var/lib/postgresql/data/server.crt:ro
      - ./ssl/prod-server.key:/var/lib/postgresql/data/server.key:ro
    command: >
      postgres
      -c ssl=on
      -c ssl_cert_file=/var/lib/postgresql/data/server.crt
      -c ssl_key_file=/var/lib/postgresql/data/server.key
      -c shared_buffers=${BSIM_DB_SHARED_BUFFERS:-8GB}
      -c effective_cache_size=${BSIM_DB_EFFECTIVE_CACHE_SIZE:-24GB}
      -c maintenance_work_mem=${BSIM_DB_MAINTENANCE_WORK_MEM:-2GB}
      -c checkpoint_completion_target=0.9
      -c wal_buffers=64MB
      -c default_statistics_target=100
      -c random_page_cost=1.1
      -c effective_io_concurrency=4
      -c work_mem=32MB
      -c max_worker_processes=8
      -c max_parallel_workers_per_gather=4
      -c max_parallel_workers=8
      -c max_parallel_maintenance_workers=4
      -c log_min_duration_statement=1000
      -c log_checkpoints=on
      -c log_lock_waits=on
      -c log_statement=all
      -c log_line_prefix='%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h '
    restart: unless-stopped

volumes:
  bsim_postgres_production_data:
    external: false
EOF

    # Start production containers
    print_warning "Starting production containers..."
    docker-compose -f docker-compose.yml -f docker-compose.production.yml up -d

    # Wait for database to be ready
    print_warning "Waiting for database to be ready..."
    sleep 30

    # Verify database is accessible
    for i in {1..10}; do
        if docker exec bsim-postgres-production pg_isready -U "${BSIM_DB_USER}" -d "${BSIM_DB_NAME}" > /dev/null 2>&1; then
            print_success "Database is ready"
            break
        fi
        if [[ $i -eq 10 ]]; then
            print_error "Database failed to start"
            exit 1
        fi
        sleep 5
    done

    print_success "Production deployment completed"
}

# Initialize production database
initialize_database() {
    print_header "💾 Initializing Production Database"

    source .env.production

    # Create lshvector extension
    docker exec bsim-postgres-production psql -U "${BSIM_DB_USER}" -d "${BSIM_DB_NAME}" -c "CREATE EXTENSION IF NOT EXISTS lshvector;"

    # Initialize BSim schema
    if [[ -f "create-bsim-schema.sql" ]]; then
        print_warning "Creating BSim schema..."
        docker exec bsim-postgres-production psql -U "${BSIM_DB_USER}" -d "${BSIM_DB_NAME}" -f /dev/stdin < create-bsim-schema.sql
        print_success "BSim schema created"
    else
        print_warning "BSim schema file not found. Database will be empty."
    fi

    print_success "Database initialization completed"
}

# Set up production services
setup_services() {
    print_header "⚙️  Setting Up Production Services"

    # Set up backup service
    chmod +x production-backup.sh
    chmod +x production-monitoring.sh

    # Create systemd service files (optional)
    if command -v systemctl > /dev/null 2>&1; then
        print_warning "Creating systemd service files..."

        sudo tee /etc/systemd/system/bsim-backup.service > /dev/null <<EOF
[Unit]
Description=BSim Production Backup
Wants=bsim-backup.timer

[Service]
Type=oneshot
ExecStart=$(pwd)/production-backup.sh
WorkingDirectory=$(pwd)
User=$(whoami)

[Install]
WantedBy=multi-user.target
EOF

        sudo tee /etc/systemd/system/bsim-backup.timer > /dev/null <<EOF
[Unit]
Description=Run BSim backup daily
Requires=bsim-backup.service

[Timer]
OnCalendar=daily
RandomizedDelaySec=1800
Persistent=true

[Install]
WantedBy=timers.target
EOF

        sudo systemctl daemon-reload
        sudo systemctl enable bsim-backup.timer
        sudo systemctl start bsim-backup.timer

        print_success "Backup service configured"
    else
        print_warning "Systemd not available. Set up cron jobs manually."
    fi

    print_success "Production services configured"
}

# Run security checks
run_security_checks() {
    print_header "🔒 Running Security Validation"

    if [[ -f "./security-check.sh" ]]; then
        chmod +x security-check.sh
        ./security-check.sh || print_warning "Security checks completed with warnings"
    else
        print_warning "Security check script not found"
    fi

    print_success "Security validation completed"
}

# Display deployment summary
show_summary() {
    print_header "📋 Deployment Summary"

    source .env.production

    echo -e "${BLUE}Production BSim Database${NC}"
    echo -e "  🗄️  Database: ${BSIM_DB_NAME}"
    echo -e "  👤 User: ${BSIM_DB_USER}"
    echo -e "  🔌 Port: ${BSIM_DB_PORT}"
    echo -e "  🔐 SSL: Enabled"
    echo ""

    echo -e "${BLUE}Connection Information${NC}"
    echo -e "  📝 URL: postgresql://${BSIM_DB_USER}:<password>@localhost:${BSIM_DB_PORT}/${BSIM_DB_NAME}?sslmode=require"
    echo -e "  🔑 Password: (check .env.production)"
    echo ""

    echo -e "${BLUE}Management Commands${NC}"
    echo -e "  📊 Monitoring: ./production-monitoring.sh"
    echo -e "  💾 Backup: ./production-backup.sh"
    echo -e "  🛑 Stop: docker-compose -f docker-compose.yml -f docker-compose.production.yml down"
    echo ""

    echo -e "${BLUE}Security Reminders${NC}"
    echo -e "  🔐 Keep .env.production secure and never commit to git"
    echo -e "  🔄 Schedule regular credential rotation"
    echo -e "  📅 Monitor SSL certificate expiry"
    echo -e "  🔍 Review security logs regularly"
}

# Main execution
main() {
    print_header "🎯 BSim Production Deployment"

    if [[ "$1" == "--help" ]]; then
        echo "Usage: $0 [--skip-checks] [--help]"
        echo ""
        echo "Deploy BSim for production use with:"
        echo "  - Secure credentials and SSL"
        echo "  - Production-optimized PostgreSQL"
        echo "  - Automated backup and monitoring"
        echo ""
        echo "Options:"
        echo "  --skip-checks    Skip security validation"
        echo "  --help          Show this help"
        exit 0
    fi

    check_prerequisites
    deploy_production
    initialize_database
    setup_services

    if [[ "$1" != "--skip-checks" ]]; then
        run_security_checks
    fi

    show_summary

    print_success "🎉 Production deployment completed successfully!"
}

# Run main function with all arguments
main "$@"