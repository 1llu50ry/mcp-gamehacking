# GitHub Copilot Instructions - Reverse Engineering Analysis Platform

## 📋 Project Overview

**Project Name**: Reverse Engineering Analysis Platform with Ghidra Server, ret-sync, and x64dbg
**Last Updated**: September 1, 2025
**Status**: ✅ **PRODUCTION READY** - Cross-platform support implemented

### 🎯 Core Purpose
This project provides a comprehensive reverse engineering environment featuring:
- **Ghidra Server Backend**: Collaborative reverse engineering with shared repositories
- **ret-sync Integration**: Real-time synchronization between Ghidra and x64dbg
- **x64dbg Support**: Dynamic analysis capabilities
- **Cross-Platform Compatibility**: Windows, Linux, and macOS support

### 🏗️ Architecture
- **Containerized**: Docker-based infrastructure using `blacktop/ghidra:latest`
- **Multi-Platform**: PowerShell scripts (Windows) + Bash scripts (Linux/macOS)
- **Configuration-Driven**: Environment variables via `.env` file
- **GitOps**: Infrastructure as code with version control

---

## 🔧 Technical Context

### Environment Variables
```bash
# Core Configuration
GHIDRA_USERS=admin                    # Default Ghidra user
GHIDRA_PORT=13100                     # Server port
GHIDRA_IP=localhost                   # Server IP

# Backup Configuration
BACKUP_FREQUENCY=hourly               # hourly, daily, weekly, manual
BACKUP_PATH=./backups                 # Backup storage location
RETENTION_DAYS=30                     # Days to keep backups
```

### Key Technologies
- **Docker**: Container orchestration
- **Ghidra**: Reverse engineering framework
- **ret-sync**: Ghidra ↔ x64dbg synchronization
- **x64dbg**: Dynamic analysis debugger
- **PowerShell/Bash**: Cross-platform scripting

### File Structure
```
├── docker-compose.yml          # Container orchestration
├── .env                        # Environment configuration
├── .env.example               # Configuration template
├── *.ps1                      # PowerShell scripts (Windows)
├── *.sh                       # Bash scripts (Linux/macOS)
├── repo-data/                 # Ghidra repository data
├── backups/                   # Backup storage
├── sync-logs/                 # ret-sync logs
└── .github/                   # GitHub configuration
    └── copilot-instructions.md # This file
```

---

## 🚀 Development Guidelines

### Code Style & Conventions

#### PowerShell Scripts
```powershell
# Use consistent parameter naming
param(
    [string]$BackupName,
    [string]$BackupPath = "./backups",
    [switch]$Force
)

# Use Write-Host with colors for user feedback
Write-Host "Operation completed" -ForegroundColor Green

# Handle errors properly
try {
    # Operation code
} catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
    exit 1
}
```

#### Bash Scripts
```bash
# Use consistent parameter parsing
while [[ $# -gt 0 ]]; do
    case $1 in
        -BackupName|--backup-name)
            BACKUP_NAME="$2"
            shift 2
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
    esac
done

# Use colored output for user feedback
echo -e "\033[32mSUCCESS: Operation completed\033[0m"

# Handle errors with traps
trap cleanup EXIT
```

### Cross-Platform Compatibility

#### 🔄 Platform-Specific Patterns
| Feature | Windows (PowerShell) | Linux/macOS (Bash) |
|---------|---------------------|-------------------|
| Path Separators | `\` | `/` |
| Archive Format | `.zip` | `.zip` or `.tar.gz` |
| Size Calculation | `Get-Item.Length` | `stat -f%z` or `du -b` |
| Environment Variables | `$env:VARIABLE` | `$VARIABLE` |

#### 🛠️ Tool Detection & Fallbacks
```bash
# Check for tool availability
if command -v jq >/dev/null 2>&1; then
    # Use jq for JSON parsing
    jq -r '.field' file.json
else
    # Fallback to grep/sed
    grep '"field"' file.json | sed 's/.*"field": "\([^"]*\)".*/\1/'
fi
```

### Error Handling Best Practices

#### PowerShell
```powershell
$ErrorActionPreference = "Stop"
try {
    # Risky operation
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    # Cleanup code
}
```

#### Bash
```bash
set -e  # Exit on error
trap 'echo "ERROR: Script failed"; cleanup' ERR

cleanup() {
    # Cleanup operations
    echo "Performing cleanup..."
}

# Use trap for exit cleanup
trap cleanup EXIT
```

---

## 📁 File Organization

### Script Categories

#### 🔧 Management Scripts
- `start.ps1` / `start.sh`: Start Ghidra Server
- `stop.ps1` / `stop.sh`: Stop Ghidra Server
- `setup.ps1`: Initial environment setup

#### 💾 Backup & Recovery
- `backup.ps1` / `backup.sh`: Create backups
- `restore.ps1` / `restore.sh`: Restore from backups
- `backup-scheduler.ps1` / `backup-scheduler.sh`: Automated scheduling

#### 🧹 Maintenance
- `cleanup.ps1` / `cleanup.sh`: Data cleanup
- `test-connectivity.ps1` / `test-connectivity.sh`: Connectivity testing

### Configuration Files
- `.env`: Runtime configuration
- `.env.example`: Configuration template
- `docker-compose.yml`: Container definitions

---

## 🧪 Testing & Validation

### Automated Testing Checklist

#### ✅ Pre-Commit Checks
- [ ] Environment variables loaded correctly
- [ ] Docker containers start/stop properly
- [ ] Port connectivity verified
- [ ] File permissions correct
- [ ] Backup/restore cycle works

#### ✅ Cross-Platform Validation
- [ ] PowerShell scripts work on Windows
- [ ] Bash scripts work on Linux (Ubuntu tested)
- [ ] Bash scripts compatible with macOS
- [ ] Tool detection handles missing dependencies

### Manual Testing Scenarios

#### Basic Functionality
```bash
# Test connectivity
./test-connectivity.sh

# Test backup creation
./backup.sh -BackupName "test-$(date +%Y%m%d-%H%M%S)"

# Test restore (with safety backup)
./restore.sh -BackupFile "./backups/test-backup.zip" --force

# Test cleanup (dry run first)
./cleanup.sh --dry-run
```

#### Error Scenarios
- Test with missing Docker
- Test with invalid backup files
- Test with insufficient permissions
- Test with network connectivity issues

---

## 🔄 Maintenance & Updates

### Regular Maintenance Tasks

#### Monthly
- [ ] Review backup retention policies
- [ ] Update Docker images
- [ ] Test restore procedures
- [ ] Verify cross-platform compatibility

#### Weekly
- [ ] Monitor disk usage
- [ ] Check log files for errors
- [ ] Validate backup integrity
- [ ] Test connectivity

### Update Procedures

#### Adding New Scripts
1. Create both PowerShell (`.ps1`) and Bash (`.sh`) versions
2. Test on all supported platforms
3. Update this documentation
4. Add to automated testing

#### Modifying Existing Scripts
1. Update both platform versions simultaneously
2. Maintain parameter compatibility
3. Test cross-platform functionality
4. Update usage examples

### Documentation Updates
- Update this file when adding new features
- Include testing results and known issues
- Document platform-specific considerations
- Maintain usage examples and troubleshooting guides

---

## 🚨 Troubleshooting Guide

### Common Issues & Solutions

#### Docker Issues
```bash
# Check container status
docker ps -a --filter "name=ghidra-server"

# View container logs
docker logs ghidra-server

# Restart containers
docker-compose restart
```

#### Permission Issues
```bash
# Fix script permissions (Linux/macOS)
chmod +x *.sh

# Check file ownership
ls -la repo-data/
```

#### Network Issues
```bash
# Test port connectivity
nc -z localhost 13100

# Check firewall settings
sudo ufw status  # Linux
# Windows Firewall GUI  # Windows
```

#### Backup/Restore Issues
```bash
# Verify backup integrity
unzip -t backup.zip

# Check available disk space
df -h  # Linux/macOS
Get-WmiObject Win32_LogicalDisk  # PowerShell
```

---

## 📚 Usage Examples

### Quick Start (Cross-Platform)

#### Windows (PowerShell)
```powershell
# Start the platform
.\start.ps1

# Test connectivity
.\test-connectivity.ps1

# Create backup
.\backup.ps1 -BackupName "daily-backup"
```

#### Linux/macOS (Bash)
```bash
# Start the platform
./start.sh

# Test connectivity
./test-connectivity.sh

# Create backup
./backup.sh -BackupName "daily-backup"
```

### Advanced Usage

#### Automated Backup Scheduling
```bash
# Set up hourly backups
echo "BACKUP_FREQUENCY=hourly" >> .env
echo "BACKUP_HOUR=02" >> .env

# Run scheduler
./backup-scheduler.sh --force
```

#### Custom Cleanup
```bash
# Preview cleanup
./cleanup.sh --dry-run

# Clean specific folders only
./cleanup.sh --skip-folders backups,sync-logs
```

---

## 🎯 Development Priorities

### ✅ Completed Features
- [x] Docker-based Ghidra Server infrastructure
- [x] Cross-platform PowerShell and Bash scripts
- [x] Automated backup and restore system
- [x] Environment-based configuration
- [x] Comprehensive testing in WSL Ubuntu
- [x] GitHub Copilot instructions documentation

### 🔄 Current Focus
- [ ] Complete README.md documentation
- [ ] Implement ret-sync integration
- [ ] Add x64dbg configuration

### 🔮 Future Enhancements
- [ ] Web-based management interface
- [ ] Plugin system for additional tools
- [ ] Multi-user collaboration features
- [ ] Integration with other RE frameworks

---

## 📞 Support & Resources

### Getting Help
1. Check this documentation first
2. Review script help: `script.sh --help`
3. Check logs in `sync-logs/` directory
4. Test connectivity: `./test-connectivity.sh`

### Useful Commands
```bash
# System status
docker-compose ps
docker stats

# Log analysis
tail -f sync-logs/*.log
docker logs ghidra-server

# Backup management
ls -la backups/*.zip
./backup.sh --help
```

---

*This document serves as a comprehensive guide for working with the Reverse Engineering Analysis Platform. Keep it updated as the project evolves.*
