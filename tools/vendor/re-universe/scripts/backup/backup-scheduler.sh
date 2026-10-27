#!/bin/bash

# Enhanced Automated Ghidra Repository Backup Scheduler (Bash)
# Supports configurable backup frequency and smart scheduling

set -e  # Exit on any error

# Default values
FREQUENCY=""
RETENTION_DAYS=0
BACKUP_PATH=""
LOG_FILE="./backup-scheduler.log"
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
        -f|--frequency)
            FREQUENCY="$2"
            shift 2
            ;;
        -r|--retention)
            RETENTION_DAYS="$2"
            shift 2
            ;;
        -p|--path)
            BACKUP_PATH="$2"
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
            echo "  -f, --frequency FREQUENCY    Backup frequency (hourly, daily, weekly, manual)"
            echo "  -r, --retention DAYS         Days to keep backups"
            echo "  -p, --path PATH             Backup directory path"
            echo "  -l, --log FILE              Log file path"
            echo "  --force                     Force backup regardless of frequency"
            echo "  -h, --help                  Show this help message"
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
    local log_entry="[$timestamp] [$level] $message"

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
                "BACKUP_FREQUENCY") BACKUP_FREQUENCY="$value" ;;
                "BACKUP_RETENTION_DAYS") BACKUP_RETENTION_DAYS="$value" ;;
                "BACKUP_PATH") BACKUP_PATH_CONFIG="$value" ;;
                "BACKUP_HOUR") BACKUP_HOUR="$value" ;;
                "BACKUP_MINUTE") BACKUP_MINUTE="$value" ;;
                "BACKUP_WEEKDAY") BACKUP_WEEKDAY="$value" ;;
            esac
        done < "$config_file"
    fi
}

# Apply configuration with fallbacks
apply_config() {
    BACKUP_FREQUENCY=${FREQUENCY:-${BACKUP_FREQUENCY:-"daily"}}
    RETENTION_DAYS=${RETENTION_DAYS:-${BACKUP_RETENTION_DAYS:-30}}
    BACKUP_PATH=${BACKUP_PATH:-${BACKUP_PATH_CONFIG:-"./backups"}}
    BACKUP_HOUR=${BACKUP_HOUR:-2}
    BACKUP_MINUTE=${BACKUP_MINUTE:-0}
    BACKUP_WEEKDAY=${BACKUP_WEEKDAY:-"Sunday"}
}

# Check if backup is needed based on frequency
test_backup_needed() {
    local frequency="$1"

    if [[ "$FORCE" == "true" ]]; then
        write_log "Force backup requested" "INFO"
        return 0
    fi

    # Find the most recent backup
    local last_backup=$(find "$BACKUP_PATH" -name "auto-*.zip" -type f -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)

    if [[ -z "$last_backup" ]]; then
        write_log "No previous backups found, backup needed" "INFO"
        return 0
    fi

    local last_backup_time=$(stat -c %Y "$last_backup" 2>/dev/null || stat -f %m "$last_backup" 2>/dev/null)
    local current_time=$(date +%s)
    local time_diff=$((current_time - last_backup_time))

    case $frequency in
        "hourly")
            if [[ $time_diff -ge 3600 ]]; then
                local hours_ago=$(echo "scale=1; $time_diff / 3600" | bc 2>/dev/null || echo "scale=1; $time_diff / 3600" | awk '{printf "%.1f", $1}')
                write_log "Hourly check: Last backup $hours_ago hours ago" "INFO"
                return 0
            fi
            ;;
        "daily")
            if [[ $time_diff -ge 86400 ]]; then
                local days_ago=$(echo "scale=1; $time_diff / 86400" | bc 2>/dev/null || echo "scale=1; $time_diff / 86400" | awk '{printf "%.1f", $1}')
                write_log "Daily check: Last backup $days_ago days ago" "INFO"
                return 0
            fi
            ;;
        "weekly")
            if [[ $time_diff -ge 604800 ]]; then
                local days_ago=$(echo "scale=1; $time_diff / 86400" | bc 2>/dev/null || echo "scale=1; $time_diff / 86400" | awk '{printf "%.1f", $1}')
                write_log "Weekly check: Last backup $days_ago days ago" "INFO"
                return 0
            fi
            ;;
        "manual")
            write_log "Manual frequency set, skipping automatic backup" "INFO"
            return 1
            ;;
        *)
            write_log "Unknown frequency '$frequency', defaulting to daily" "WARN"
            if [[ $time_diff -ge 86400 ]]; then
                return 0
            fi
            ;;
    esac

    return 1
}

# Get backup frequency schedule information
get_backup_schedule() {
    local frequency="$1"
    local hour=${BACKUP_HOUR:-2}
    local minute=${BACKUP_MINUTE:-0}
    local weekday=${BACKUP_WEEKDAY:-"Sunday"}

    case $frequency in
        "hourly")
            echo "Every hour"
            echo "Cron: 0 * * * *"
            ;;
        "daily")
            printf "Daily at %02d:%02d" "$hour" "$minute"
            echo ""
            printf "Cron: %d %d * * *" "$minute" "$hour"
            ;;
        "weekly")
            printf "Weekly on %s at %02d:%02d" "$weekday" "$hour" "$minute"
            echo ""
            local weekday_num
            case $weekday in
                "Sunday") weekday_num=0 ;;
                "Monday") weekday_num=1 ;;
                "Tuesday") weekday_num=2 ;;
                "Wednesday") weekday_num=3 ;;
                "Thursday") weekday_num=4 ;;
                "Friday") weekday_num=5 ;;
                "Saturday") weekday_num=6 ;;
                *) weekday_num="*" ;;
            esac
            printf "Cron: %d %d * * %s" "$minute" "$hour" "$weekday_num"
            ;;
        *)
            echo "Manual only"
            echo "Cron: N/A"
            ;;
    esac
}

# Main script execution
main() {
    # Load and apply configuration
    load_config
    apply_config

    write_log "=== Backup Scheduler Started ===" "INFO"
    write_log "Frequency: $BACKUP_FREQUENCY | Retention: $RETENTION_DAYS days | Path: $BACKUP_PATH" "INFO"

    # Get schedule information
    local schedule_info=$(get_backup_schedule "$BACKUP_FREQUENCY")
    write_log "Schedule: $schedule_info" "INFO"

    # Create backup directory if it doesn't exist
    mkdir -p "$BACKUP_PATH"

    # Check if containers are running
    if ! docker ps --filter "name=ghidra-server" --filter "status=running" | grep -q ghidra-server; then
        write_log "Ghidra server is not running, skipping backup" "WARN"
        exit 0
    fi

    # Check if backup is needed
    if ! test_backup_needed "$BACKUP_FREQUENCY"; then
        write_log "Backup not needed based on frequency settings" "INFO"
        exit 0
    fi

    # Create backup with timestamp
    local timestamp=$(date '+%Y%m%d-%H%M%S')
    local backup_name="auto-${BACKUP_FREQUENCY}-${timestamp}"
    write_log "Creating backup: $backup_name" "INFO"

    # Run backup script
    write_log "Calling backup script with BackupName='$backup_name' BackupPath='$BACKUP_PATH'" "INFO"

    if ./backup.sh -BackupName "$backup_name" -BackupPath "$BACKUP_PATH"; then
        write_log "Backup completed successfully: $backup_name" "SUCCESS"
    else
        write_log "Backup failed with exit code: $?" "ERROR"
        exit 1
    fi

    # Cleanup old backups
    write_log "Cleaning up backups older than $RETENTION_DAYS days" "INFO"

    local cutoff_time=$(date -d "$RETENTION_DAYS days ago" +%s 2>/dev/null || date -v-"${RETENTION_DAYS}d" +%s 2>/dev/null || echo "$(( $(date +%s) - (RETENTION_DAYS * 86400) ))")
    local deleted_count=0

    while IFS= read -r -d '' old_backup; do
        if [[ -f "$old_backup" ]]; then
            rm -f "$old_backup"
            write_log "Deleted old backup: $(basename "$old_backup")" "INFO"
            ((deleted_count++))
        fi
    done < <(find "$BACKUP_PATH" -name "auto-*.zip" -type f -printf '%T@ %p\0' 2>/dev/null | awk -v cutoff="$cutoff_time" '$1 < cutoff {print substr($0, index($0, " ")+1)}' | tr '\n' '\0')

    if [[ $deleted_count -gt 0 ]]; then
        write_log "Cleanup complete: $deleted_count old backups removed" "SUCCESS"
    else
        write_log "No old backups to clean up" "INFO"
    fi

    write_log "=== Backup Scheduler Completed ===" "SUCCESS"

    # Display cron setup information
    echo -e "\n${CYAN}=== Cron Setup Information ===${NC}"
    echo -e "${YELLOW}Current frequency: $schedule_info${NC}"
    echo -e "${WHITE}Command: $0${NC}"

    echo -e "\n${CYAN}=== Quick Setup Commands ===${NC}"
    echo -e "${WHITE}Change to hourly:  sed -i 's/BACKUP_FREQUENCY=.*/BACKUP_FREQUENCY=hourly/' .env${NC}"
    echo -e "${WHITE}Change to weekly:  sed -i 's/BACKUP_FREQUENCY=.*/BACKUP_FREQUENCY=weekly/' .env${NC}"
    echo -e "${WHITE}Set backup time:   sed -i 's/BACKUP_HOUR=.*/BACKUP_HOUR=03/' .env${NC}"
    echo -e "${WHITE}Test backup now:   $0 --force${NC}"
}

# Run main function
main "$@"
