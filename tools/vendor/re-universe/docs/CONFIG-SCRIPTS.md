# Cross-Platform Configuration Management

## Overview
This directory now contains both PowerShell and Bash versions of the configuration management script, ensuring cross-platform compatibility for the Reverse Engineering Analysis Platform.

## Script Comparison

### Functionality Parity ✅
Both scripts provide identical functionality:
- **Show Configuration**: Display current `.env` settings with clean formatting
- **Set Values**: Update or add configuration key-value pairs  
- **Reset Configuration**: Restore defaults from `.env.example`
- **Validate Configuration**: Check for required settings and valid formats

### Platform-Specific Implementations

#### PowerShell (`config.ps1`)
```powershell
# Windows-optimized implementation
.\config.ps1                              # Show configuration
.\config.ps1 -Action set -Key GHIDRA_PORT -Value 13200
.\config.ps1 -Action validate
.\config.ps1 -Action reset
```

#### Bash (`config.sh`)  
```bash
# Linux/macOS-optimized implementation
./config.sh                               # Show configuration  
./config.sh -Action set -Key GHIDRA_PORT -Value 13200
./config.sh -Action validate
./config.sh -Action reset
```

## Technical Features

### ✅ Validation Capabilities
- **Required Settings**: Validates presence of `GHIDRA_IP`, `GHIDRA_PORT`, `JVM_MAX_MEMORY`, `GHIDRA_USERS`
- **Port Numbers**: Checks numeric format and recommended ranges (1024-65535)
- **Memory Format**: Validates JVM memory format (e.g., `4g`, `512m`)
- **Inline Comments**: Properly handles and strips inline comments from values

### ✅ User Experience  
- **Color-Coded Output**: Success (green), warnings (yellow), errors (red)
- **Clear Documentation**: Built-in usage examples and help text
- **Error Handling**: Graceful failure with informative messages
- **Auto-Creation**: Creates `.env` from template if missing

## Testing Results ✅

Both scripts have been validated and provide consistent behavior:
- Configuration parsing works correctly
- Validation logic matches between platforms
- Set/reset operations maintain file integrity
- Error handling provides helpful feedback

## Integration Notes

These configuration management scripts integrate seamlessly with:
- VS Code tasks (both PowerShell and Bash variants available)
- Docker Compose environment variables
- Backup and restore systems
- Automated setup scripts

The cross-platform approach ensures users on any operating system can manage their Ghidra RE Platform configuration effectively.
