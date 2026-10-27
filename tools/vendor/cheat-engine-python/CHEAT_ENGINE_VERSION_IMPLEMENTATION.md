# Cheat Engine Version Detection Implementation

## Overview

This implementation provides direct access to Cheat Engine version information through the MCP (Model Context Protocol) server, fulfilling the request to "directly get from cheat engine the getCEVersion".

## Implementation Details

### Enhanced CheatEngineBridge (`server/cheatengine/ce_bridge.py`)

The `CheatEngineBridge` class has been significantly enhanced with comprehensive version detection capabilities:

#### Key Methods

1. **`_get_ce_version(exe_path: Path) -> str`**
   - Multi-method version detection from executable files
   - Uses `win32api` (preferred), `ctypes` (fallback), and filename parsing
   - Extracts detailed version information from PE headers

2. **`get_cheat_engine_version_info() -> Dict[str, Any]`**
   - Comprehensive installation and version analysis
   - Multiple detection strategies:
     - File system detection
     - Running process scanning
     - Registry inspection
     - Alternative installation search

#### Detection Strategies

**File System Detection:**
- Scans common Cheat Engine installation paths
- Checks for executable files (`cheatengine.exe`, `dbengine.exe`, etc.)
- Extracts version information from PE headers

**Running Process Detection:**
- Uses `psutil` to scan for running Cheat Engine processes
- Identifies processes by name patterns (`cheatengine`, `dbengine`)
- Extracts version from running executable paths

**Registry Detection:**
- Searches Windows registry for installation information
- Checks multiple registry hives and paths
- Extracts version, installation path, and metadata

**Alternative Installation Search:**
- Searches non-standard installation locations
- Checks desktop, downloads, and alternative drives
- Supports portable installations

### MCP Tools (`server/main.py`)

Two MCP tools provide direct access to version information:

#### 1. `get_cheat_engine_basic_version`
```python
@mcp.tool()
def get_cheat_engine_basic_version() -> str:
```
- **Purpose**: Equivalent to the original `getCEVersion` functionality
- **Returns**: Simple version string (e.g., "7.5.0.7461")
- **Use Case**: Quick version checks, compatibility verification

#### 2. `get_cheat_engine_version`
```python
@mcp.tool()
def get_cheat_engine_version() -> str:
```
- **Purpose**: Comprehensive version and installation information
- **Returns**: Formatted string with detailed information:
  - Version number
  - Installation path
  - Executable location
  - Detection methods used
  - Running process information
  - Registry metadata

## Usage Examples

### Basic Version Detection
```python
# Through MCP tool
version = get_cheat_engine_basic_version()
# Returns: "7.5.0.7461"
```

### Comprehensive Version Information
```python
# Through MCP tool
info = get_cheat_engine_version()
# Returns formatted string with:
# 🔍 Cheat Engine Version Information
# ========================================
# 📋 Version: 7.5.0.7461
# 📁 Installation Path: C:\dbengine
# 🎯 Executable: C:\dbengine\dbengine-x86_64.exe
# ✅ Detection Methods: file_system, running_process
```

### Direct API Usage
```python
from cheatengine.ce_bridge import CheatEngineBridge

bridge = CheatEngineBridge()

# Basic version
version = bridge.ce_installation.version

# Comprehensive information
info = bridge.get_cheat_engine_version_info()
```

## Test Results

### Test Environment
- **System**: Windows
- **Cheat Engine Version Detected**: 7.5.0.7461
- **Installation Path**: C:\dbengine
- **Detection Methods**: File system + Running process

### Verification Tests

1. **Syntax Validation**: ✅ All code passes Python AST parsing
2. **Basic Version Detection**: ✅ Returns "7.5.0.7461"
3. **Comprehensive Detection**: ✅ Returns detailed installation information
4. **MCP Tool Integration**: ✅ Both tools work correctly
5. **Error Handling**: ✅ Graceful fallbacks for missing dependencies

## Key Features

### Reliability
- **Multiple Detection Methods**: Ensures version detection works across different installation scenarios
- **Graceful Fallbacks**: Continues working even if optional dependencies are missing
- **Error Handling**: Comprehensive exception handling with meaningful error messages

### Compatibility
- **Windows API Integration**: Uses `win32api` and `ctypes` for native version extraction
- **Process Detection**: Works with both standard and portable installations
- **Registry Support**: Handles multiple registry locations and formats

### Performance
- **Cached Results**: Initial detection results are cached in the bridge instance
- **Efficient Scanning**: Optimized process and file system scanning
- **Minimal Dependencies**: Core functionality works with standard library

## Architecture Benefits

1. **Direct Access**: Provides immediate access to Cheat Engine version without external tools
2. **MCP Integration**: Seamlessly integrates with existing MCP server architecture
3. **Comprehensive Detection**: Multiple strategies ensure reliable version detection
4. **Extensible Design**: Easy to add new detection methods or installation paths
5. **Production Ready**: Robust error handling and logging for production use

## Dependencies

### Required
- `pathlib` (standard library)
- `logging` (standard library)
- `os` (standard library)

### Optional (Enhanced Features)
- `win32api`: Enhanced version extraction from PE headers
- `psutil`: Running process detection
- `winreg`: Registry-based detection
- `ctypes`: Alternative version extraction method

## Conclusion

This implementation successfully provides direct access to Cheat Engine version information through multiple robust detection methods, fully satisfying the requirement to "directly get from cheat engine the getCEVersion" while providing additional comprehensive installation analysis capabilities.
