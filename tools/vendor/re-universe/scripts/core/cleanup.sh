#!/bin/bash

# Data Cleanup Script for Ghidra RE Platform
# Bash equivalent of cleanup.ps1
# Removes all data while preserving .gitkeep files for Git tracking

set -e  # Exit on any error

# Default values
FORCE=false
DRY_RUN=false
SKIP_FOLDERS=()

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -Force|--force)
            FORCE=true
            shift
            ;;
        -DryRun|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -SkipFolders|--skip-folders)
            # Parse comma-separated list
            IFS=',' read -ra SKIP_FOLDERS <<< "$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  -Force, --force                    Skip confirmation prompts"
            echo "  -DryRun, --dry-run                 Show what would be deleted without actually deleting"
            echo "  -SkipFolders, --skip-folders LIST  Comma-separated list of folders to skip"
            echo "  -h, --help                         Show this help"
            echo ""
            echo "Examples:"
            echo "  $0 --dry-run"
            echo "  $0 --force"
            echo "  $0 --skip-folders backups,sync-logs"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use -h or --help for usage information"
            exit 1
            ;;
    esac
done

# Folders to clean (relative to workspace root)
# Format: "path|description"
CLEANUP_FOLDERS=(
    "./repo-data|Ghidra repository data"
    "./sync-logs|ret-sync logs"
    "./backups|backup files"
)

# Logging function
log_message() {
    local message="$1"
    local level="${2:-INFO}"
    local timestamp=$(date +"%Y-%m-%d %H:%M:%S")

    case "$level" in
        "INFO") color="\033[37m" ;;    # White
        "WARN") color="\033[33m" ;;    # Yellow
        "ERROR") color="\033[31m" ;;   # Red
        "SUCCESS") color="\033[32m" ;; # Green
        *) color="\033[90m" ;;         # Gray
    esac

    echo -e "${color}[$timestamp] [$level] $message\033[0m"
}

# Get folder size in MB
get_folder_size() {
    local path="$1"
    if [ -d "$path" ]; then
        # Use du to get size in MB, handle different platforms
        if command -v gdu >/dev/null 2>&1; then
            # Some systems have gdu (GNU du)
            size=$(gdu -sm "$path" 2>/dev/null | cut -f1 || echo "0")
        else
            # Standard du, convert to MB
            size_bytes=$(du -sb "$path" 2>/dev/null | cut -f1 || echo "0")
            size=$(echo "scale=2; $size_bytes / 1048576" | bc 2>/dev/null || echo "0")
        fi
        echo "$size"
    else
        echo "0"
    fi
}

# Get item size in MB
get_item_size() {
    local path="$1"
    if [ -d "$path" ]; then
        get_folder_size "$path"
    elif [ -f "$path" ]; then
        size_bytes=$(stat -f%z "$path" 2>/dev/null || stat -c%s "$path" 2>/dev/null || echo "0")
        echo "scale=2; $size_bytes / 1048576" | bc 2>/dev/null || echo "0"
    else
        echo "0"
    fi
}

# Check if folder should be skipped
should_skip_folder() {
    local folder_name="$1"
    for skip in "${SKIP_FOLDERS[@]}"; do
        if [ "$skip" = "$folder_name" ]; then
            return 0
        fi
    done
    return 1
}

# Show cleanup preview
show_cleanup_preview() {
    log_message "=== Cleanup Preview ===" "INFO"

    for folder_info in "${CLEANUP_FOLDERS[@]}"; do
        IFS='|' read -r folder_path description <<< "$folder_info"
        folder_name=$(basename "$folder_path")

        if should_skip_folder "$folder_name"; then
            log_message "SKIPPING: $folder_path - $description" "WARN"
            continue
        fi

        if [ -d "$folder_path" ]; then
            # Count items excluding .gitkeep
            item_count=$(find "$folder_path" -mindepth 1 -not -name ".gitkeep" | wc -l)
            size=$(get_folder_size "$folder_path")

            log_message "FOLDER: $folder_path - $description" "INFO"
            log_message "  Current size: ${size} MB" "INFO"
            log_message "  Items to delete: $item_count" "INFO"

            if [ "$item_count" -gt 0 ]; then
                find "$folder_path" -mindepth 1 -not -name ".gitkeep" | while read -r item; do
                    relative_item=${item#"$folder_path/"}
                    item_size=$(get_item_size "$item")
                    if [ -d "$item" ]; then
                        log_message "    [DIR ] $relative_item (${item_size} MB)" "INFO"
                    else
                        log_message "    [FILE] $relative_item (${item_size} MB)" "INFO"
                    fi
                done
            else
                log_message "  No items to delete (only .gitkeep present)" "SUCCESS"
            fi
        else
            log_message "FOLDER: $folder_path - Not found, will be created" "WARN"
        fi
        echo ""
    done
}

# Invoke cleanup
invoke_cleanup() {
    local dry_run="$1"
    local total_items_deleted=0
    local total_size_freed=0

    for folder_info in "${CLEANUP_FOLDERS[@]}"; do
        IFS='|' read -r folder_path description <<< "$folder_info"
        folder_name=$(basename "$folder_path")

        if should_skip_folder "$folder_name"; then
            log_message "Skipping $folder_path as requested" "WARN"
            continue
        fi

        if [ -d "$folder_path" ]; then
            original_size=$(get_folder_size "$folder_path")
            # Count items excluding .gitkeep
            item_count=$(find "$folder_path" -mindepth 1 -not -name ".gitkeep" | wc -l)

            if [ "$item_count" -gt 0 ]; then
                log_message "Cleaning $folder_path - $description" "INFO"

                find "$folder_path" -mindepth 1 -not -name ".gitkeep" | while read -r item; do
                    relative_item=${item#"$folder_path/"}

                    if [ "$dry_run" = true ]; then
                        log_message "  [DRY RUN] Would delete: $relative_item" "WARN"
                    else
                        if [ -d "$item" ]; then
                            rm -rf "$item"
                            log_message "  Deleted directory: $relative_item" "SUCCESS"
                        else
                            rm -f "$item"
                            log_message "  Deleted file: $relative_item" "SUCCESS"
                        fi
                        total_items_deleted=$((total_items_deleted + 1))
                    fi
                done

                if [ "$dry_run" = false ]; then
                    new_size=$(get_folder_size "$folder_path")
                    freed_space=$(echo "scale=2; $original_size - $new_size" | bc 2>/dev/null || echo "0")
                    total_size_freed=$(echo "scale=2; $total_size_freed + $freed_space" | bc 2>/dev/null || echo "$total_size_freed")
                    log_message "  Freed ${freed_space} MB from $folder_path" "SUCCESS"
                fi
            else
                log_message "No cleanup needed for $folder_path (only .gitkeep present)" "INFO"
            fi
        else
            log_message "Creating missing directory: $folder_path" "INFO"
            mkdir -p "$folder_path"
            touch "$folder_path/.gitkeep"
            log_message "Created $folder_path with .gitkeep" "SUCCESS"
        fi
    done

    if [ "$dry_run" = false ] && [ "$total_items_deleted" -gt 0 ]; then
        log_message "=== Cleanup Summary ===" "SUCCESS"
        log_message "Total items deleted: $total_items_deleted" "SUCCESS"
        log_message "Total space freed: ${total_size_freed} MB" "SUCCESS"
    fi
}

# Main execution
log_message "=== Data Cleanup Tool Started ===" "INFO"

# Show what will be cleaned
show_cleanup_preview

if [ "$DRY_RUN" = true ]; then
    log_message "=== DRY RUN MODE - No actual changes made ===" "WARN"
    invoke_cleanup true
    exit 0
fi

# Confirmation prompt (unless -Force is used)
if [ "$FORCE" = false ]; then
    echo ""
    echo -e "\033[31m⚠️  WARNING: This will permanently delete all data in the specified folders!\033[0m"
    echo -e "\033[33m   Only .gitkeep files will be preserved.\033[0m"
    echo ""
    echo -n -e "\033[36mContinue with cleanup? (y/N): \033[0m"
    read -r confirmation

    if [[ ! "$confirmation" =~ ^[yY].* ]]; then
        log_message "Cleanup cancelled by user" "WARN"
        exit 0
    fi
fi

# Perform cleanup
log_message "Starting cleanup operation..." "INFO"
invoke_cleanup false

log_message "=== Data Cleanup Completed ===" "SUCCESS"

# Verification
log_message "Verifying cleanup results..." "INFO"
for folder_info in "${CLEANUP_FOLDERS[@]}"; do
    IFS='|' read -r folder_path description <<< "$folder_info"

    if [ -d "$folder_path" ]; then
        remaining_count=$(find "$folder_path" -mindepth 1 -not -name ".gitkeep" | wc -l)
        if [ "$remaining_count" -eq 0 ]; then
            log_message "✅ $folder_path - Clean (only .gitkeep remains)" "SUCCESS"
        else
            log_message "⚠️  $folder_path - $remaining_count items remain" "WARN"
        fi
    fi
done

echo ""
echo "=== Usage Examples ==="
echo "Preview cleanup:    ./cleanup.sh --dry-run"
echo "Force cleanup:      ./cleanup.sh --force"
echo "Skip specific dir:  ./cleanup.sh --skip-folders backups,sync-logs"
