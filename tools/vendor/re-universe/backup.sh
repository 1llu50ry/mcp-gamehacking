#!/bin/bash

# Ghidra Repository Backup Script
# Bash equivalent of backup.ps1

set -e  # Exit on any error

# Default values
BACKUP_NAME=""
BACKUP_PATH="./backups"
INCREMENTAL=false
NEED_RESTART=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -BackupName|--backup-name)
            BACKUP_NAME="$2"
            shift 2
            ;;
        -BackupPath|--backup-path)
            BACKUP_PATH="$2"
            shift 2
            ;;
        -Incremental|--incremental)
            INCREMENTAL=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  -BackupName, --backup-name NAME    Custom backup name"
            echo "  -BackupPath, --backup-path PATH    Backup directory (default: ./backups)"
            echo "  -Incremental, --incremental        Create incremental backup"
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

# Generate timestamp and default name
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
DEFAULT_NAME="ghidra-backup-$TIMESTAMP"
BACKUP_NAME=${BACKUP_NAME:-$DEFAULT_NAME}

echo "=== Ghidra Repository Backup ==="
echo "Backup name: $BACKUP_NAME"

# Docker Compose compatibility function
get_docker_compose_cmd() {
    if command -v docker-compose &> /dev/null; then
        echo "docker-compose"
    else
        echo "docker compose"
    fi
}

DOCKER_COMPOSE_CMD=$(get_docker_compose_cmd)

# Ensure backup directory exists
if [ ! -d "$BACKUP_PATH" ]; then
    mkdir -p "$BACKUP_PATH"
    echo "Created backup directory: $BACKUP_PATH"
fi

# Stop containers to ensure consistent backup
echo ""
echo "Stopping containers for consistent backup..."
# Check if containers are running first
CONTAINERS_RUNNING=$($DOCKER_COMPOSE_CMD ps -q ghidra-server 2>/dev/null | wc -l)
if [ "$CONTAINERS_RUNNING" -gt 0 ]; then
    $DOCKER_COMPOSE_CMD stop ghidra-server >/dev/null 2>&1
    NEED_RESTART=true
else
    echo "No containers running, proceeding with backup..."
    NEED_RESTART=false
fi

# Error handling function
cleanup() {
    echo ""
    if [ "$NEED_RESTART" = "true" ]; then
        echo "Restarting containers..."
        if $DOCKER_COMPOSE_CMD start ghidra-server >/dev/null 2>&1; then
            echo "Containers restarted successfully"
        else
            echo "⚠️ Warning: Could not restart containers"
            # Don't exit with error - backup was successful
        fi
    else
        echo "No containers to restart"
    fi
}

trap cleanup EXIT

try_backup() {
    # Create backup directory
    FULL_BACKUP_PATH="$BACKUP_PATH/$BACKUP_NAME"
    mkdir -p "$FULL_BACKUP_PATH"

    # Backup repository data
    echo "Backing up repository data..."
    if [ -d "./repo-data" ]; then
        cp -r ./repo-data/* "$FULL_BACKUP_PATH/" 2>/dev/null || true
    else
        echo "Warning: repo-data directory not found"
    fi

    # Create metadata file
    echo "Creating metadata file..."
    METADATA_FILE="$FULL_BACKUP_PATH/backup-metadata.json"

    # Get git commit if available
    GIT_COMMIT=""
    if command -v git >/dev/null 2>&1 && [ -d ".git" ]; then
        GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "")
    fi

    # Get Docker image info
    DOCKER_IMAGE=""
    if command -v docker-compose >/dev/null 2>&1; then
        DOCKER_IMAGE=$(docker-compose config 2>/dev/null | grep -o "image.*ghidra[^\"]*" | head -1 | sed 's/image://' | xargs 2>/dev/null || echo "blacktop/ghidra:latest")
    fi

    # Create JSON metadata
    cat > "$METADATA_FILE" << EOF
{
    "BackupDate": "$(date +"%Y-%m-%d %H:%M:%S")",
    "BackupName": "$BACKUP_NAME",
    "BackupType": "$([ "$INCREMENTAL" = true ] && echo "Incremental" || echo "Full")",
    "SourcePath": "$(pwd)/repo-data",
    "GitCommit": "$GIT_COMMIT",
    "DockerImage": "$DOCKER_IMAGE"
}
EOF

    # Create compressed archive
    echo "Creating compressed archive..."
    ARCHIVE_PATH="$BACKUP_PATH/$BACKUP_NAME.zip"

    if command -v zip >/dev/null 2>&1; then
        cd "$FULL_BACKUP_PATH"
        zip -r "../$BACKUP_NAME.zip" . >/dev/null 2>&1
        cd - >/dev/null
    elif command -v python3 >/dev/null 2>&1; then
        # Use Python to create zip file
        python3 - <<EOF
import zipfile
import os
import sys

def create_zip(source_dir, output_path):
    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(source_dir):
            for file in files:
                file_path = os.path.join(root, file)
                # Get relative path for archive
                arcname = os.path.relpath(file_path, source_dir)
                zipf.write(file_path, arcname)
    return True

try:
    create_zip("$FULL_BACKUP_PATH", "$ARCHIVE_PATH")
    print("ZIP file created successfully using Python")
except Exception as e:
    print(f"Error creating ZIP file: {e}")
    sys.exit(1)
EOF
    else
        echo "Warning: neither zip command nor python3 found, creating tar.gz instead"
        ARCHIVE_PATH="$BACKUP_PATH/$BACKUP_NAME.tar.gz"
        tar -czf "$ARCHIVE_PATH" -C "$FULL_BACKUP_PATH" .
    fi

    # Calculate size
    if [ -f "$ARCHIVE_PATH" ]; then
        SIZE_BYTES=$(stat -f%z "$ARCHIVE_PATH" 2>/dev/null || stat -c%s "$ARCHIVE_PATH" 2>/dev/null || echo "0")
        SIZE_MB=$(echo "scale=2; $SIZE_BYTES / 1048576" | bc 2>/dev/null || echo "0")

        echo ""
        echo "=== Backup Complete ==="
        echo "Archive: $ARCHIVE_PATH"
        echo "Size: $SIZE_MB MB"
        echo "Folder: $FULL_BACKUP_PATH"
    else
        echo "Warning: Could not create archive"
    fi

    # Cleanup uncompressed backup folder (automatic)
    echo ""
    echo "Removing uncompressed backup folder..."
    rm -rf "$FULL_BACKUP_PATH"
    echo "Uncompressed backup folder removed"
}

# Execute backup with error handling
if try_backup; then
    echo ""
    echo "=== Usage Tips ==="
    echo "List backups: ls -la $BACKUP_PATH/*.zip"
    echo "Restore: ./restore.sh -BackupFile $BACKUP_PATH/$BACKUP_NAME.zip"
else
    echo "ERROR: Backup failed" >&2
    exit 1
fi
