#!/bin/bash
#
# generate-prod-credentials.sh - Generate Secure Production Credentials
#
# This script generates cryptographically secure credentials for production deployment
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Configuration
ENV_FILE=".env.production"
BACKUP_DIR="./credential-backups"

# Function to print colored output
print_header() {
    echo -e "${BOLD}${BLUE}$1${NC}"
}

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

# Function to generate secure password
generate_password() {
    local length=${1:-32}
    openssl rand -base64 $length | tr -d "=+/" | cut -c1-${length}
}

# Function to generate secure username
generate_username() {
    local prefix="${1:-bsim}"
    local suffix=$(openssl rand -hex 6)
    echo "${prefix}_${suffix}"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Generate secure production credentials for BSim database"
    echo ""
    echo "Options:"
    echo "  -e, --env-file FILE    Output environment file (default: .env.production)"
    echo "  -b, --backup          Create backup of existing credentials"
    echo "  -f, --force           Overwrite existing credentials without confirmation"
    echo "  -v, --verbose         Enable verbose output"
    echo "  -h, --help            Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                    # Generate credentials in .env.production"
    echo "  $0 --backup          # Generate with backup of existing credentials"
    echo "  $0 -e .env.prod       # Generate in custom file"
}

# Function to backup existing credentials
backup_credentials() {
    if [[ -f "$ENV_FILE" ]]; then
        mkdir -p "$BACKUP_DIR"
        local backup_file="$BACKUP_DIR/$(basename $ENV_FILE).backup.$(date +%Y%m%d_%H%M%S)"

        cp "$ENV_FILE" "$backup_file"
        print_success "Backed up existing credentials to: $backup_file"
    fi
}

# Function to validate environment
validate_environment() {
    # Check for required commands
    local required_commands=("openssl" "date")

    for cmd in "${required_commands[@]}"; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            print_error "Required command not found: $cmd"
            exit 1
        fi
    done

    # Check OpenSSL functionality
    if ! echo "test" | openssl rand -base64 16 >/dev/null 2>&1; then
        print_error "OpenSSL random generation test failed"
        exit 1
    fi
}

# Function to generate SSL configuration
generate_ssl_config() {
    cat << 'EOF'
# SSL Certificate Configuration
SSL_CERT_COUNTRY=US
SSL_CERT_STATE=State
SSL_CERT_CITY=City
SSL_CERT_ORG=Organization
SSL_CERT_UNIT=Security
SSL_CERT_COMMON_NAME=bsim.local
SSL_CERT_DAYS=365
EOF
}

# Function to generate production environment file
generate_production_env() {
    local db_user=$(generate_username "bsim_prod")
    local db_password=$(generate_password 32)
    local backup_key=$(generate_password 32)
    local ssl_passphrase=$(generate_password 24)

    print_status "Generating secure production credentials..."

    cat > "$ENV_FILE" << EOF
# Production BSim Database Configuration
# Generated on: $(date -u '+%Y-%m-%d %H:%M:%S UTC')
# WARNING: Keep these credentials secure and never commit to version control!

# =============================================================================
# DATABASE CONFIGURATION
# =============================================================================

# BSim PostgreSQL Database Settings
BSIM_DB_NAME=bsim_production
BSIM_DB_USER=$db_user
BSIM_DB_PASSWORD=$db_password
BSIM_DB_PORT=5432

# Database Performance Settings
BSIM_DB_SHARED_BUFFERS=8GB
BSIM_DB_EFFECTIVE_CACHE_SIZE=24GB
BSIM_DB_MAINTENANCE_WORK_MEM=2GB

# =============================================================================
# SSL/TLS CONFIGURATION
# =============================================================================

$(generate_ssl_config)
SSL_KEY_PASSPHRASE=$ssl_passphrase

# =============================================================================
# BACKUP CONFIGURATION
# =============================================================================

# Backup Settings
BACKUP_RETENTION_WEEKS=12
BACKUP_ENCRYPTION_KEY=$backup_key
BACKUP_SCHEDULE="0 2 * * 0"  # Weekly on Sunday at 2 AM
BACKUP_COMPRESSION=gzip
BACKUP_VERIFY=true

# =============================================================================
# MONITORING CONFIGURATION
# =============================================================================

# Monitoring and Alerting
MONITOR_DISK_THRESHOLD=85
MONITOR_MEMORY_THRESHOLD=90
MONITOR_CONNECTION_THRESHOLD=80
LOG_LEVEL=INFO
ALERT_EMAIL=admin@yourdomain.com

# =============================================================================
# SECURITY SETTINGS
# =============================================================================

# Security Configuration
FORCE_SSL=true
MIN_TLS_VERSION=1.2
PASSWORD_MIN_LENGTH=16
SESSION_TIMEOUT=3600
MAX_FAILED_LOGINS=3
LOCKOUT_DURATION=1800

# Environment Type
ENVIRONMENT=production
DEPLOYMENT_DATE=$(date -u '+%Y-%m-%d')
EOF

    # Set restrictive permissions
    chmod 600 "$ENV_FILE"

    return 0
}

# Function to display credentials summary
show_credentials_summary() {
    if [[ ! -f "$ENV_FILE" ]]; then
        print_error "Environment file not found: $ENV_FILE"
        return 1
    fi

    local db_user=$(grep "^BSIM_DB_USER=" "$ENV_FILE" | cut -d'=' -f2)

    print_success "Production credentials generated successfully!"
    echo ""
    print_header "=== CREDENTIAL SUMMARY ==="
    echo "📁 Environment File: $ENV_FILE"
    echo "👤 Database User: $db_user"
    echo "🔐 Database Password: [REDACTED - check $ENV_FILE]"
    echo "🔑 Backup Key: [REDACTED - check $ENV_FILE]"
    echo "🛡️  SSL Passphrase: [REDACTED - check $ENV_FILE]"
    echo ""
    print_header "=== SECURITY REMINDERS ==="
    echo "⚠️  Keep $ENV_FILE secure and never commit to git"
    echo "🔄 Schedule regular credential rotation (quarterly recommended)"
    echo "💾 Create encrypted backup of credentials in secure location"
    echo "🔍 Review all settings before production deployment"
    echo ""
    print_header "=== NEXT STEPS ==="
    echo "1. Review and customize settings in $ENV_FILE"
    echo "2. Generate SSL certificates: ./generate-ssl-certs.sh"
    echo "3. Test deployment: ./start-bsim.sh"
    echo "4. Run security validation: ./security-check.sh"
    echo "5. Follow PRODUCTION-DEPLOYMENT.md for full deployment"
}

# Function to generate additional security files
generate_security_files() {
    print_status "Generating additional security configuration..."

    # Create .env.template for reference
    cat > ".env.template" << 'EOF'
# Template Environment Configuration for BSim Database
# Copy this file to .env and modify the values below

# Database Configuration
BSIM_DB_NAME=bsim
BSIM_DB_USER=your_username_here
BSIM_DB_PASSWORD=your_secure_password_here
BSIM_DB_PORT=5432

# SSL Configuration
SSL_CERT_COUNTRY=US
SSL_CERT_STATE=Your_State
SSL_CERT_CITY=Your_City
SSL_CERT_ORG=Your_Organization
SSL_CERT_COMMON_NAME=bsim.yourdomain.com

# Backup Configuration
BACKUP_ENCRYPTION_KEY=your_backup_encryption_key
BACKUP_RETENTION_WEEKS=4

# Security Settings
ENVIRONMENT=development
EOF

    # Create gitignore entries for security
    if [[ ! -f ".gitignore" ]] || ! grep -q ".env.production" .gitignore; then
        echo "" >> .gitignore
        echo "# Security and Credentials" >> .gitignore
        echo ".env.production" >> .gitignore
        echo "credential-backups/" >> .gitignore
        echo "ssl/*.key" >> .gitignore
        echo "*.pem" >> .gitignore
        print_success "Updated .gitignore with security exclusions"
    fi
}

# Parse command line arguments
FORCE=false
VERBOSE=false
BACKUP=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--env-file)
            ENV_FILE="$2"
            shift 2
            ;;
        -b|--backup)
            BACKUP=true
            shift
            ;;
        -f|--force)
            FORCE=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
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
    print_header "🔐 Production Credential Generator"
    echo ""

    # Validate environment
    if [[ "$VERBOSE" == "true" ]]; then
        print_status "Validating environment..."
    fi
    validate_environment

    # Check for existing credentials
    if [[ -f "$ENV_FILE" && "$FORCE" != "true" ]]; then
        print_warning "Environment file already exists: $ENV_FILE"
        read -p "Overwrite existing credentials? [y/N]: " confirm
        if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
            print_status "Operation cancelled"
            exit 0
        fi
    fi

    # Backup existing credentials if requested
    if [[ "$BACKUP" == "true" ]]; then
        backup_credentials
    fi

    # Generate credentials
    generate_production_env

    # Generate additional security files
    generate_security_files

    # Show summary
    show_credentials_summary

    print_success "Production credential generation complete!"
}

# Run main function
main "$@"