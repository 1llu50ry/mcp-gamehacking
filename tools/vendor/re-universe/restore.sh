#!/bin/bash

# Ghidra Repository Restore Script
# Bash equivalent of restore.ps1

set -e  # Exit on any error

# Default values
BACKUP_FILE=""
FORCE=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -BackupFile|--backup-file)
            BACKUP_FILE="$2"
            shift 2
            ;;
        -Force|--force)
            FORCE=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 -BackupFile FILE [options]"
            echo "Options:"
            echo "  -BackupFile, --backup-file FILE    Backup file to restore from (required)"
            echo "  -Force, --force                    Skip confirmation prompt"
            echo "  -h, --help                         Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use -h or --help for usage information"
            exit 1
            ;;
    esac
done

# Validate required parameters
if [ -z "$BACKUP_FILE" ]; then
    echo "ERROR: Backup file is required. Use -BackupFile to specify the backup file."
    exit 1
fi

echo "=== Ghidra Repository Restore ==="

# Validate backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo "ERROR: Backup file not found: $BACKUP_FILE"
    exit 1
fi

# Check if it's a zip or tar.gz file
if [[ "$BACKUP_FILE" != *.zip && "$BACKUP_FILE" != *.tar.gz ]]; then
    echo "ERROR: Backup file must be a .zip or .tar.gz archive"
    exit 1
fi

# Extract backup name
BACKUP_NAME=$(basename "$BACKUP_FILE" | sed 's/\.zip$//' | sed 's/\.tar\.gz$//')
echo "Restoring from: $BACKUP_NAME"

# Warning about data loss
if [ "$FORCE" = false ]; then
    echo ""
    echo "WARNING: This will replace all current repository data!"
    read -p "Are you sure you want to continue? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        echo "Restore cancelled"
        exit 0
    fi
fi

# Stop containers
echo ""
echo "Stopping containers..."
docker-compose stop ghidra-server

# Error handling function
cleanup() {
    # Cleanup temp directory
    if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
        rm -rf "$TEMP_DIR"
    fi

    echo ""
    echo "Restarting containers..."
    docker-compose start ghidra-server
    echo "Containers restarted"
}

trap cleanup EXIT

try_restore() {
    # Create temporary extraction directory
    TEMP_DIR=$(mktemp -d "/tmp/ghidra-restore-XXXXXX")

    # Extract backup
    echo "Extracting backup archive..."
    if [[ "$BACKUP_FILE" == *.zip ]]; then
        if command -v unzip >/dev/null 2>&1; then
            unzip -q "$BACKUP_FILE" -d "$TEMP_DIR"
        else
            echo "ERROR: unzip command not found. Please install unzip to restore from zip files."
            return 1
        fi
    else
        tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR"
    fi

    # Find the backup folder (should be the only subfolder)
    EXTRACTED_FOLDER=$(find "$TEMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -1)

    if [ -z "$EXTRACTED_FOLDER" ]; then
        echo "ERROR: No backup folder found in archive"
        return 1
    fi

    # Read metadata if available
    METADATA_PATH="$EXTRACTED_FOLDER/backup-metadata.json"
    if [ -f "$METADATA_PATH" ]; then
        echo ""
        echo "=== Backup Information ==="

        # Try to parse JSON with jq if available, otherwise use grep
        if command -v jq >/dev/null 2>&1; then
            BACKUP_DATE=$(jq -r '.BackupDate // empty' "$METADATA_PATH" 2>/dev/null || echo "")
            BACKUP_TYPE=$(jq -r '.BackupType // empty' "$METADATA_PATH" 2>/dev/null || echo "")
            GIT_COMMIT=$(jq -r '.GitCommit // empty' "$METADATA_PATH" 2>/dev/null || echo "")
        else
            BACKUP_DATE=$(grep -o '"BackupDate": "[^"]*"' "$METADATA_PATH" 2>/dev/null | cut -d'"' -f4 || echo "")
            BACKUP_TYPE=$(grep -o '"BackupType": "[^"]*"' "$METADATA_PATH" 2>/dev/null | cut -d'"' -f4 || echo "")
            GIT_COMMIT=$(grep -o '"GitCommit": "[^"]*"' "$METADATA_PATH" 2>/dev/null | cut -d'"' -f4 || echo "")
        fi

        [ -n "$BACKUP_DATE" ] && echo "Backup Date: $BACKUP_DATE"
        [ -n "$BACKUP_TYPE" ] && echo "Backup Type: $BACKUP_TYPE"
        [ -n "$GIT_COMMIT" ] && echo "Git Commit: $GIT_COMMIT"
    fi

    # Backup current data (safety backup)
    TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
    SAFETY_BACKUP="./repo-data-safety-backup-$TIMESTAMP"

    if [ -d "./repo-data" ]; then
        echo ""
        echo "Creating safety backup of current data..."
        cp -r "./repo-data" "$SAFETY_BACKUP"
        echo "Safety backup created: $SAFETY_BACKUP"
    fi

    # Remove current repo-data and restore from backup
    echo "Restoring repository data..."
    if [ -d "./repo-data" ]; then
        rm -rf "./repo-data"
    fi

    # Copy restored data (exclude metadata file)
    mkdir -p "./repo-data"
    cp -r "$EXTRACTED_FOLDER"/* "./repo-data/" 2>/dev/null || true

    # Remove metadata file from restored data
    if [ -f "./repo-data/backup-metadata.json" ]; then
        rm "./repo-data/backup-metadata.json"
    fi

    echo ""
    echo "=== Restore Complete ==="
    echo "Repository data restored from: $BACKUP_FILE"
    if [ -d "$SAFETY_BACKUP" ]; then
        echo "Safety backup available at: $SAFETY_BACKUP"
    fi
}

# Execute restore with error handling
if try_restore; then
    echo ""
    echo "=== Next Steps ==="
    echo "1. Test connectivity: ./test-connectivity.sh"
    echo "2. Connect Ghidra client to localhost:13100"
    echo "3. Verify projects are restored correctly"
else
    echo "ERROR: Restore failed" >&2
    exit 1
fi
