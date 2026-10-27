#!/bin/bash

# Production BSim Backup Script
# Automated backup solution for production BSim database

set -e

# Configuration
BACKUP_DIR="/opt/bsim/backups"
LOG_FILE="/var/log/bsim-backup.log"
RETENTION_DAYS=30
COMPRESSION_LEVEL=9
ENCRYPTION_ENABLED=true

# Load production environment
ENV_FILE="${1:-.env.production}"
if [[ -f "$ENV_FILE" ]]; then
    source "$ENV_FILE"
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging functions
log_info() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [INFO] $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] $1" | tee -a "$LOG_FILE"
}

log_success() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [SUCCESS] $1" | tee -a "$LOG_FILE"
}

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Generate backup filename
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
BACKUP_NAME="bsim_production_${TIMESTAMP}"
BACKUP_FILE="${BACKUP_DIR}/${BACKUP_NAME}.sql"
COMPRESSED_FILE="${BACKUP_FILE}.gz"
ENCRYPTED_FILE="${COMPRESSED_FILE}.enc"

log_info "Starting production backup: $BACKUP_NAME"

# Check container health
if ! docker exec bsim-postgres pg_isready -U "${BSIM_DB_USER}" > /dev/null 2>&1; then
    log_error "Database container is not ready"
    exit 1
fi

# Create database dump
log_info "Creating database dump..."
if docker exec bsim-postgres pg_dump \
    -U "${BSIM_DB_USER}" \
    -d "${BSIM_DB_NAME}" \
    --verbose \
    --no-owner \
    --no-privileges \
    --create \
    --clean \
    > "$BACKUP_FILE" 2>>"$LOG_FILE"; then
    log_success "Database dump completed: $(du -h "$BACKUP_FILE" | cut -f1)"
else
    log_error "Database dump failed"
    exit 1
fi

# Compress backup
log_info "Compressing backup..."
if gzip -$COMPRESSION_LEVEL "$BACKUP_FILE"; then
    log_success "Compression completed: $(du -h "$COMPRESSED_FILE" | cut -f1)"
else
    log_error "Compression failed"
    exit 1
fi

# Encrypt backup if enabled
if [[ "$ENCRYPTION_ENABLED" == "true" ]] && [[ -n "$BACKUP_ENCRYPTION_KEY" ]]; then
    log_info "Encrypting backup..."
    if openssl enc -aes-256-cbc -salt -in "$COMPRESSED_FILE" -out "$ENCRYPTED_FILE" -k "$BACKUP_ENCRYPTION_KEY"; then
        log_success "Encryption completed: $(du -h "$ENCRYPTED_FILE" | cut -f1)"
        rm -f "$COMPRESSED_FILE"
        FINAL_FILE="$ENCRYPTED_FILE"
    else
        log_error "Encryption failed"
        FINAL_FILE="$COMPRESSED_FILE"
    fi
else
    FINAL_FILE="$COMPRESSED_FILE"
fi

# Generate checksums
log_info "Generating checksums..."
sha256sum "$FINAL_FILE" > "${FINAL_FILE}.sha256"
log_success "Checksum created: ${FINAL_FILE}.sha256"

# Clean up old backups
log_info "Cleaning up backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR" -name "bsim_production_*" -type f -mtime +$RETENTION_DAYS -delete
REMAINING_BACKUPS=$(find "$BACKUP_DIR" -name "bsim_production_*" -type f | wc -l)
log_success "Cleanup completed. Remaining backups: $REMAINING_BACKUPS"

# Create backup manifest
cat > "${BACKUP_DIR}/latest_backup.json" <<EOF
{
  "timestamp": "$(date -Iseconds)",
  "filename": "$(basename "$FINAL_FILE")",
  "size": $(stat -c%s "$FINAL_FILE"),
  "checksum": "$(cat "${FINAL_FILE}.sha256" | cut -d' ' -f1)",
  "database": "${BSIM_DB_NAME}",
  "compressed": true,
  "encrypted": $ENCRYPTION_ENABLED
}
EOF

log_success "Backup completed successfully: $FINAL_FILE"

# Optional: Upload to remote storage (uncomment and configure)
# if [[ -n "$REMOTE_BACKUP_URL" ]]; then
#     log_info "Uploading to remote storage..."
#     # Add your remote upload logic here (S3, SFTP, etc.)
# fi

echo -e "${GREEN}Production backup completed successfully!${NC}"
echo -e "${BLUE}File: $FINAL_FILE${NC}"
echo -e "${BLUE}Size: $(du -h "$FINAL_FILE" | cut -f1)${NC}"