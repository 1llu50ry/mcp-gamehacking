#!/bin/bash

# BSim PostgreSQL Database Backup Script
# Backs up the BSim database using pg_dump and integrates with existing backup schedule

set -e

# Default values
BACKUP_NAME=""
BACKUP_PATH=""
RETENTION_DAYS=0
LOG_FILE="./bsim-backup.log"
FORCE=false

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
        -n|--name)
            BACKUP_NAME="$2"
            shift 2
            ;;
        -p|--path)
            BACKUP_PATH="$2"
            shift 2
            ;;
        -r|--retention)
            RETENTION_DAYS="$2"
            shift 2
            ;;
        -l|--log)
            LOG_FILE="$2"
            shift 2
            ;;
        --force)
            FORCE=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -n, --name NAME         Backup name (auto-generated if not provided)"
            echo "  -p, --path PATH         Backup directory path"
            echo "  -r, --retention DAYS    Days to keep backups"
            echo "  -l, --log FILE          Log file path"
            echo "  --force                 Force backup regardless of container status"
            echo "  -h, --help              Show this help message"
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
write_log() {
    local message="$1"
    local level="${2:-INFO}"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local log_entry="[$timestamp] [$level] BSim DB: $message"

    echo "$log_entry" >> "$LOG_FILE"

    case $level in
        "ERROR")
            echo -e "${RED}$log_entry${NC}"
            ;;
        "WARN")
            echo -e "${YELLOW}$log_entry${NC}"
            ;;
        "SUCCESS")
            echo -e "${GREEN}$log_entry${NC}"
            ;;
        *)
            echo -e "${WHITE}$log_entry${NC}"
            ;;
    esac
}

# Load configuration from .env file
load_config() {
    local config_file="./.env"
    if [[ -f "$config_file" ]]; then
        while IFS='=' read -r key value; do
            # Skip comments and empty lines
            [[ $key =~ ^[[:space:]]*# ]] && continue
            [[ -z $key ]] && continue

            # Remove inline comments
            value=$(echo "$value" | sed 's/[[:space:]]*#.*//')

            # Trim whitespace
            key=$(echo "$key" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            value=$(echo "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

            case $key in
                "BACKUP_RETENTION_DAYS") BACKUP_RETENTION_DAYS="$value" ;;
                "BACKUP_PATH") BACKUP_PATH_CONFIG="$value" ;;
                "BSIM_DB_NAME") BSIM_DB_NAME="$value" ;;
                "BSIM_DB_USER") BSIM_DB_USER="$value" ;;
                "BSIM_DB_PASSWORD") BSIM_DB_PASSWORD="$value" ;;
                "BSIM_DB_PORT") BSIM_DB_PORT="$value" ;;
            esac
        done < "$config_file"
    fi
}

# Apply configuration with fallbacks
apply_config() {
    RETENTION_DAYS=${RETENTION_DAYS:-${BACKUP_RETENTION_DAYS:-30}}
    BACKUP_PATH=${BACKUP_PATH:-${BACKUP_PATH_CONFIG:-"./backups"}}
    BSIM_DB_NAME=${BSIM_DB_NAME:-"bsim"}
    BSIM_DB_USER=${BSIM_DB_USER:-"ben"}
    BSIM_DB_PASSWORD=${BSIM_DB_PASSWORD}
    BSIM_DB_PORT=${BSIM_DB_PORT:-"5432"}
}

# Check if BSim PostgreSQL container is running
check_container() {
    if ! docker ps --filter "name=bsim-postgres" --filter "status=running" | grep -q bsim-postgres; then
        if [[ "$FORCE" == "true" ]]; then
            write_log "BSim PostgreSQL container not running, but force flag specified. Attempting backup anyway..." "WARN"
        else
            write_log "BSim PostgreSQL container is not running. Start container or use --force flag." "ERROR"
            exit 1
        fi
    fi
}

# Create database backup using pg_dump
create_backup() {
    local backup_name="$1"
    local backup_file="${BACKUP_PATH}/${backup_name}.sql"

    write_log "Creating BSim database backup: $backup_name" "INFO"

    # Create backup directory if it doesn't exist
    mkdir -p "$BACKUP_PATH"

    # Perform database backup using pg_dump
    if docker exec bsim-postgres pg_dump \
        -U "$BSIM_DB_USER" \
        -d "$BSIM_DB_NAME" \
        --no-password \
        --verbose \
        --clean \
        --if-exists \
        --create > "$backup_file" 2>/dev/null; then

        # Compress the backup
        gzip "$backup_file"
        backup_file="${backup_file}.gz"

        local backup_size=$(ls -lh "$backup_file" | awk '{print $5}')
        write_log "BSim database backup completed: $backup_name.sql.gz ($backup_size)" "SUCCESS"

        return 0
    else
        write_log "BSim database backup failed" "ERROR"
        # Clean up failed backup file
        [[ -f "$backup_file" ]] && rm -f "$backup_file"
        return 1
    fi
}

# Clean up old backups
cleanup_old_backups() {
    write_log "Cleaning up BSim database backups older than $RETENTION_DAYS days" "INFO"

    local cutoff_time=$(date -d "$RETENTION_DAYS days ago" +%s 2>/dev/null || date -v-"${RETENTION_DAYS}d" +%s 2>/dev/null || echo "$(( $(date +%s) - (RETENTION_DAYS * 86400) ))")
    local deleted_count=0

    while IFS= read -r -d '' old_backup; do
        if [[ -f "$old_backup" ]]; then
            rm -f "$old_backup"
            write_log "Deleted old backup: $(basename "$old_backup")" "INFO"
            ((deleted_count++))
        fi
    done < <(find "$BACKUP_PATH" -name "bsim-*.sql.gz" -type f -printf '%T@ %p\0' 2>/dev/null | awk -v cutoff="$cutoff_time" '$1 < cutoff {print substr($0, index($0, " ")+1)}' | tr '\n' '\0')

    if [[ $deleted_count -gt 0 ]]; then
        write_log "BSim backup cleanup complete: $deleted_count old backups removed" "SUCCESS"
    else
        write_log "No old BSim backups to clean up" "INFO"
    fi
}

# Main execution
main() {
    write_log "=== BSim Database Backup Started ===" "INFO"

    # Load and apply configuration
    load_config
    apply_config

    # Generate backup name if not provided
    if [[ -z "$BACKUP_NAME" ]]; then
        local timestamp=$(date '+%Y%m%d-%H%M%S')
        BACKUP_NAME="bsim-backup-${timestamp}"
    fi

    write_log "Backup: $BACKUP_NAME | Retention: $RETENTION_DAYS days | Path: $BACKUP_PATH" "INFO"
    write_log "Database: $BSIM_DB_NAME | User: $BSIM_DB_USER | Port: $BSIM_DB_PORT" "INFO"

    # Check container status
    check_container

    # Create backup
    if create_backup "$BACKUP_NAME"; then
        # Clean up old backups
        cleanup_old_backups
        write_log "=== BSim Database Backup Completed Successfully ===" "SUCCESS"
    else
        write_log "=== BSim Database Backup Failed ===" "ERROR"
        exit 1
    fi

    # Display usage information
    echo -e "\n${CYAN}=== BSim Database Backup Complete ===${NC}"
    echo -e "${WHITE}Backup location: ${BACKUP_PATH}/${BACKUP_NAME}.sql.gz${NC}"
    echo -e "${WHITE}Log file: $LOG_FILE${NC}"
    echo -e "\n${CYAN}=== Restore Instructions ===${NC}"
    echo -e "${WHITE}To restore this backup:${NC}"
    echo -e "${WHITE}  gunzip ${BACKUP_PATH}/${BACKUP_NAME}.sql.gz${NC}"
    echo -e "${WHITE}  docker exec -i bsim-postgres psql -U $BSIM_DB_USER < ${BACKUP_PATH}/${BACKUP_NAME}.sql${NC}"
}

# Run main function
main "$@"