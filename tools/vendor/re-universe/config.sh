#!/bin/bash
# Configuration Management Script for Ghidra RE Platform

# Default values
ACTION="show"
KEY=""
VALUE=""

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -Action|--action)
            ACTION="$(echo "$2" | tr '[:upper:]' '[:lower:]')"
            shift 2
            ;;
        -Key|--key)
            KEY="$2"
            shift 2
            ;;
        -Value|--value)
            VALUE="$2"
            shift 2
            ;;
        -h|--help)
            echo "Configuration Management Script"
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  -Action show|set|reset|validate  Action to perform (default: show)"
            echo "  -Key <key>                       Configuration key for set action"
            echo "  -Value <value>                   Configuration value for set action"
            echo "  -h, --help                       Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

ENV_FILE="./.env"
EXAMPLE_FILE="./.env.example"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
GRAY='\033[0;37m'
NC='\033[0m' # No Color

show_configuration() {
    echo -e "${CYAN}=== Current Configuration ===${NC}"
    
    if [[ ! -f "$ENV_FILE" ]]; then
        echo -e "${YELLOW}No .env file found. Creating from example...${NC}"
        cp "$EXAMPLE_FILE" "$ENV_FILE"
    fi
    
    echo -e "\n${GREEN}Loaded from ${ENV_FILE}:${NC}"
    while IFS= read -r line; do
        # Skip comments and empty lines
        if [[ "$line" =~ ^[[:space:]]*# ]] || [[ -z "${line// }" ]]; then
            continue
        fi
        # Parse key=value pairs and remove inline comments
        if [[ "$line" =~ ^([^=]+)=(.*)$ ]]; then
            key=$(echo "${BASH_REMATCH[1]}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            raw_value="${BASH_REMATCH[2]}"
            # Remove inline comments (everything after # if present)
            if [[ "$raw_value" =~ ^([^#]*)(#.*)?$ ]]; then
                val=$(echo "${BASH_REMATCH[1]}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            else
                val="$raw_value"
            fi
            echo -e "  ${WHITE}$key = $val${NC}"
        fi
    done < "$ENV_FILE"
    
    echo -e "\n${CYAN}=== Configuration Categories ===${NC}"
    echo -e "${YELLOW}🖥️  Ghidra Server: GHIDRA_IP, GHIDRA_PORT, JVM_MAX_MEMORY, GHIDRA_USERS (password is always 'changeme')${NC}"
    echo -e "${YELLOW}📄 ret-sync: RETSYNC_PORT, RETSYNC_IP${NC}"  
    echo -e "${YELLOW}💾 Storage: REPO_DATA_PATH, SYNC_LOGS_PATH, BACKUP_PATH${NC}"
    echo -e "${YELLOW}⏰ Backup: BACKUP_FREQUENCY, BACKUP_HOUR, BACKUP_RETENTION_DAYS${NC}"
}

set_config_value() {
    local key="$1"
    local value="$2"
    
    if [[ ! -f "$ENV_FILE" ]]; then
        cp "$EXAMPLE_FILE" "$ENV_FILE"
        echo -e "${GREEN}Created .env file from example${NC}"
    fi
    
    local updated=false
    local temp_file=$(mktemp)
    
    while IFS= read -r line; do
        if [[ "$line" =~ ^${key}[[:space:]]*= ]]; then
            echo "${key}=${value}" >> "$temp_file"
            updated=true
            echo -e "${GREEN}Updated: $key = $value${NC}"
        else
            echo "$line" >> "$temp_file"
        fi
    done < "$ENV_FILE"
    
    if [[ "$updated" == "false" ]]; then
        echo "${key}=${value}" >> "$temp_file"
        echo -e "${GREEN}Added: $key = $value${NC}"
    fi
    
    mv "$temp_file" "$ENV_FILE"
}

reset_configuration() {
    echo -e "${YELLOW}Resetting configuration to defaults...${NC}"
    cp "$EXAMPLE_FILE" "$ENV_FILE"
    echo -e "${GREEN}Configuration reset to example defaults${NC}"
}

test_configuration() {
    echo -e "${CYAN}=== Configuration Validation ===${NC}"
    
    if [[ ! -f "$ENV_FILE" ]]; then
        echo -e "${YELLOW}No .env file found. Creating from example...${NC}"
        if [[ -f "$EXAMPLE_FILE" ]]; then
            cp "$EXAMPLE_FILE" "$ENV_FILE"
            echo -e "${GREEN}✅ Created .env file from example${NC}"
        else
            echo -e "${RED}❌ No .env.example file found${NC}"
            return 1
        fi
    fi
    
    # Load configuration into associative array
    declare -A config
    while IFS= read -r line; do
        # Skip comments and empty lines
        if [[ "$line" =~ ^[[:space:]]*# ]] || [[ -z "${line// }" ]]; then
            continue
        fi
        # Parse key=value pairs
        if [[ "$line" =~ ^([^=]+)=(.*)$ ]]; then
            key="${BASH_REMATCH[1]// /}"  # Remove spaces from key
            raw_value="${BASH_REMATCH[2]}"
            # Remove inline comments (everything after # if present)
            if [[ "$raw_value" =~ ^([^#]*)(#.*)?$ ]]; then
                value=$(echo "${BASH_REMATCH[1]}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')  # Trim whitespace
            else
                value="$raw_value"
            fi
            config["$key"]="$value"
        fi
    done < "$ENV_FILE"
    
    local valid=true
    
    # Validate required settings
    local required=("GHIDRA_IP" "GHIDRA_PORT" "JVM_MAX_MEMORY" "GHIDRA_USERS")
    for req in "${required[@]}"; do
        if [[ -z "${config[$req]}" ]]; then
            echo -e "${RED}❌ Missing required setting: $req${NC}"
            valid=false
        else
            echo -e "${GREEN}✅ $req = ${config[$req]}${NC}"
        fi
    done
    
    # Validate port numbers
    local ports=("GHIDRA_PORT" "RETSYNC_PORT" "GHIDRA_PORT_RANGE_START" "GHIDRA_PORT_RANGE_END")
    for port in "${ports[@]}"; do
        if [[ -n "${config[$port]}" ]]; then
            # Check if value is numeric
            if [[ "${config[$port]}" =~ ^[0-9]+$ ]]; then
                local port_num="${config[$port]}"
                if (( port_num < 1024 || port_num > 65535 )); then
                    echo -e "${YELLOW}⚠️  $port ($port_num) outside recommended range (1024-65535)${NC}"
                fi
            else
                echo -e "${RED}❌ Invalid port number for ${port}: ${config[$port]}${NC}"
                valid=false
            fi
        fi
    done
    
    # Validate memory setting
    if [[ -n "${config["JVM_MAX_MEMORY"]}" ]]; then
        if [[ ! "${config["JVM_MAX_MEMORY"]}" =~ ^[0-9]+[gGmM]$ ]]; then
            echo -e "${RED}❌ Invalid memory format for JVM_MAX_MEMORY: ${config["JVM_MAX_MEMORY"]}${NC}"
            echo -e "${GRAY}   Use format like: 2g, 4g, 8g, 512m${NC}"
            valid=false
        fi
    fi
    
    if [[ "$valid" == "true" ]]; then
        return 0
    else
        return 1
    fi
}

# Main script logic
case "$ACTION" in
    "show")
        show_configuration
        ;;
    "set")
        if [[ -z "$KEY" || -z "$VALUE" ]]; then
            echo -e "${RED}ERROR: Both Key and Value are required for set action${NC}"
            echo -e "${GRAY}Usage: $0 -Action set -Key GHIDRA_PORT -Value 13200${NC}"
            exit 1
        fi
        set_config_value "$KEY" "$VALUE"
        ;;
    "reset")
        reset_configuration
        ;;
    "validate")
        if test_configuration; then
            echo -e "\n${GREEN}✅ Configuration is valid${NC}"
        else
            echo -e "\n${RED}❌ Configuration has errors${NC}"
            exit 1
        fi
        ;;
    *)
        echo -e "${RED}Invalid action: $ACTION${NC}"
        echo -e "${GRAY}Valid actions: show, set, reset, validate${NC}"
        exit 1
        ;;
esac

echo -e "\n${CYAN}=== Usage Examples ===${NC}"
echo -e "${WHITE}Show config:     $0${NC}"
echo -e "${WHITE}Set value:       $0 -Action set -Key GHIDRA_PORT -Value 13200${NC}"
echo -e "${WHITE}Validate config: $0 -Action validate${NC}"
echo -e "${WHITE}Reset to default: $0 -Action reset${NC}"
