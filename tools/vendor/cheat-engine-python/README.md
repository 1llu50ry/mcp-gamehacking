# MCP Cheat Engine Server Documentation

> If you find this useful, please ⭐ star the repo — it helps others discover it!

## 📋 Table of Contents

1. [Overview](#overview)
2. [Quick Start Guide](#quick-start-guide)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [Using the Tools](#using-the-tools)
6. [Safety & Security](#safety--security)
7. [Troubleshooting](#troubleshooting)
8. [Advanced Usage](#advanced-usage)
9. [API Reference](#api-reference)
10. [FAQ](#faq)

---

## 🎯 Overview

The **MCP Cheat Engine Server** provides safe, structured access to memory analysis and debugging functionality through the Model Context Protocol (MCP). This tool is designed for:

- **Software developers** debugging applications
- **Security researchers** analyzing programs
- **Students** learning about computer memory and reverse engineering
- **Game modders** understanding game mechanics

### ⚠️ Important Safety Notice
This server operates in **READ-ONLY mode** for safety. It can read and analyze memory but cannot modify it. All operations are logged for security auditing.

### 🔧 Key Features
- ✅ Process enumeration and attachment
- ✅ Memory reading with multiple data types
- ✅ Pattern scanning and searching
- ✅ Assembly code disassembly
- ✅ Pointer chain resolution
- ✅ Cheat Engine table (.CT) import
- ✅ Safe Lua script analysis
- ✅ Comprehensive security controls

---

## 🚀 Quick Start Guide

### Prerequisites
- **Windows 10/11** (64-bit recommended)
- **Python 3.9 or higher**
- **Administrator privileges** (for memory access)
- **Claude Desktop** or compatible MCP client

### 30-Second Setup
1. **Download** the server files to your computer
2. **Open PowerShell as Administrator**
3. **Navigate** to the server directory
4. **Install dependencies**: `pip install -r requirements.txt`
5. **Start the server**: `python server/main.py`

### First Use
1. **List processes**: Use the `list_processes` tool to see available programs
2. **Attach to a process**: Use `attach_to_process` with a process ID
3. **Read memory**: Use `read_memory_region` to examine memory
4. **Detach safely**: Use `detach_from_process` when done

### 🔌 Claude Desktop MCP Setup

**📖 For detailed Claude Desktop setup instructions, see [MCP_SETUP.md](MCP_SETUP.md)**

Quick configuration summary:
1. **Find your Claude Desktop config**: `%APPDATA%\Claude\claude_desktop_config.json` (Windows)
2. **Add the MCP server configuration**:
```json
{
  "mcpServers": {
    "cheat-engine": {
      "command": "python",
      "args": ["path\\to\\server\\main.py", "--debug", "--read-only"],
      "cwd": "path\\to\\cheat-engine-server-python"
    }
  }
}
```
3. **Restart Claude Desktop**
4. **Test**: Ask Claude to "list processes using the MCP server"

---

## 📦 Installation

### Step 1: System Requirements
- **Operating System**: Windows 10/11 (Primary), Linux/macOS (Limited)
- **Python Version**: 3.9, 3.10, 3.11, or 3.12
- **Memory**: 4GB RAM minimum, 8GB recommended
- **Permissions**: Administrator/root access required

### Step 2: Download and Setup
```powershell
# Clone or download the project
cd C:\your-desired-location
# Extract files if downloaded as ZIP

# Navigate to project directory
cd cheat-engine-server-python

# Verify Python version
python --version
```

### Step 3: Install Dependencies
```powershell
# Install required packages
pip install -r requirements.txt

# Verify installation
python -c "import mcp, trio, psutil, capstone; print('All dependencies installed successfully!')"
```

### Step 4: Test Installation
```powershell
# Test the server
python server/main.py --test

# You should see: "MCP Cheat Engine Server initialized successfully"
```

---

## ⚙️ Configuration

### Basic Configuration
The server uses configuration files in the `server/config/` directory:

#### `settings.json` (Auto-created on first run)
```json
{
  "security": {
    "read_only_mode": true,
    "require_whitelist": true,
    "log_all_operations": true
  },
  "performance": {
    "max_memory_read": 1048576,
    "scan_timeout": 30,
    "max_results": 1000
  }
}
```

#### `whitelist.json` (Process Access Control)
```json
{
  "processes": [
    {
      "name": "notepad.exe",
      "allowed": true,
      "description": "Text editor for testing"
    },
    {
      "name": "calculator.exe", 
      "allowed": true,
      "description": "Calculator application"
    }
  ]
}
```

### Security Settings Explained

| Setting | Description | Default | Recommendation |
|---------|-------------|---------|----------------|
| `read_only_mode` | Prevents memory writing | `true` | Keep enabled |
| `require_whitelist` | Only allow whitelisted processes | `true` | Enable for safety |
| `log_all_operations` | Log every operation | `true` | Enable for auditing |
| `max_memory_read` | Maximum bytes per read | 1MB | Adjust as needed |

---

## 🛠️ Using the Tools

### 1. Process Management

#### List Available Processes
```python
# Find processes you can attach to
result = use_tool("list_processes")
```
**What you'll see:**
- Process name and ID
- Memory usage
- Whether it's accessible
- Security level required

#### Attach to a Process
```python
# Attach to a specific process
result = use_tool("attach_to_process", {
    "process_id": 1234
})
```
**Best practices:**
- Start with simple programs like Notepad
- Always detach when finished
- Check the whitelist if attachment fails

### 2. Memory Reading

#### Read Memory at Address
```python
# Read 64 bytes starting at address 0x140000000
result = use_tool("read_memory_region", {
    "address": "0x140000000",
    "size": 64,
    "data_type": "bytes"
})
```

#### Supported Data Types
- `bytes` - Raw byte data
- `string` - ASCII/UTF-8 text
- `int32` - 32-bit signed integer
- `uint32` - 32-bit unsigned integer
- `int64` - 64-bit signed integer
- `uint64` - 64-bit unsigned integer
- `float` - 32-bit floating point
- `double` - 64-bit floating point

### 3. Memory Scanning

#### Search for Patterns
```python
# Find all occurrences of a byte pattern
result = use_tool("scan_memory", {
    "pattern": "48 8B 05 ?? ?? ?? ??",  # ?? = wildcard
    "start_address": "0x140000000",
    "end_address": "0x141000000"
})
```

#### Pattern Format Examples
- `"41 42 43"` - Find bytes 0x41, 0x42, 0x43
- `"48 ?? 05 ?? ?? ?? ??"` - Wildcards for unknown bytes
- `"Hello World"` - Search for ASCII text
- `"00 00 00 01"` - Find integer value 1

### 4. Code Analysis

#### Disassemble Assembly Code
```python
# Disassemble 100 bytes of code
result = use_tool("disassemble_code", {
    "address": "0x140001000",
    "size": 100,
    "architecture": "x64"
})
```

#### Analyze Data Structures
```python
# Analyze memory for data structures
result = use_tool("analyze_structure", {
    "address": "0x200000000",
    "size": 256
})
```

### 5. Pointer Chains

#### Follow Multi-Level Pointers
```python
# Resolve [[base + 0x10] + 0x20] + 0x30
result = use_tool("resolve_pointer_chain", {
    "base_address": "0x140000000",
    "offsets": [16, 32, 48]  # 0x10, 0x20, 0x30 in decimal
})
```

---

## 🔒 Safety & Security

### Read-Only Protection
The server **cannot modify memory** - it can only read and analyze. This prevents:
- Accidental program crashes
- Security vulnerabilities
- System instability

### Process Whitelist
Only approved processes can be accessed:
```json
{
  "processes": [
    {"name": "notepad.exe", "allowed": true},
    {"name": "suspicious.exe", "allowed": false}
  ]
}
```

### Operation Logging
All operations are logged to `logs/operations.log`:
```
2025-07-30 10:30:15 - INFO - Process attached: notepad.exe (PID: 1234)
2025-07-30 10:30:20 - INFO - Memory read: 0x140000000, size: 64
2025-07-30 10:30:25 - INFO - Process detached: notepad.exe
```

### Permission Requirements
- **Windows**: Run as Administrator
- **Linux**: Run as root or with appropriate capabilities
- **macOS**: May require disabling SIP for some operations

---

## 🔧 Troubleshooting

### Common Issues

#### "Access Denied" Error
**Problem**: Cannot attach to process
**Solutions**:
1. Run as Administrator
2. Check if process is in whitelist
3. Verify process is not protected by anti-virus

#### "Module Not Found" Error
**Problem**: Python dependencies missing
**Solution**:
```powershell
pip install --upgrade -r requirements.txt
```

#### "Process Not Found" Error
**Problem**: Process ID doesn't exist
**Solutions**:
1. Use `list_processes` to get current IDs
2. Check if process is still running
3. Try process name instead of ID

#### Memory Read Fails
**Problem**: Cannot read memory at address
**Solutions**:
1. Check if address is valid with `get_memory_regions`
2. Verify memory protection allows reading
3. Try smaller read size

### Debug Mode
Enable detailed logging:
```powershell
python server/main.py --debug
```

### Getting Help
1. Check the FAQ section below
2. Review log files in `logs/` directory
3. Verify configuration in `server/config/`
4. Test with simple programs like Notepad first

---

## 🎓 Advanced Usage

### Cheat Engine Table Import
Import existing .CT files:
```python
result = use_tool("import_cheat_table", {
    "file_path": "C:/path/to/table.CT"
})
```

### Lua Script Analysis
Analyze Cheat Engine Lua scripts:
```python
result = use_tool("execute_lua_script", {
    "script_content": "print('Hello from Lua')",
    "safe_mode": true
})
```

### Custom Memory Regions
Define specific regions for analysis:
```python
# Get full memory map
regions = use_tool("get_memory_regions")

# Analyze specific region
for region in regions:
    if region['protect'] == 'PAGE_EXECUTE_READ':
        # Analyze executable memory
        pass
```

### Automation Examples
```python
# Complete analysis workflow
def analyze_process(process_name):
    # 1. Find and attach to process
    processes = use_tool("list_processes")
    target_pid = find_process_by_name(processes, process_name)
    
    # 2. Attach to process
    use_tool("attach_to_process", {"process_id": target_pid})
    
    # 3. Get memory layout
    regions = use_tool("get_memory_regions")
    
    # 4. Scan for patterns
    for region in regions:
        if region['readable']:
            scan_results = use_tool("scan_memory", {
                "pattern": "48 8B 05",
                "start_address": region['base_address'],
                "end_address": region['base_address'] + region['size']
            })
    
    # 5. Clean up
    use_tool("detach_from_process")
```

---

## 📚 API Reference

### Tool Categories

#### Process Management
- **list_processes()** - Get all running processes
- **attach_to_process(process_id)** - Attach to specific process
- **detach_from_process()** - Safely detach from current process
- **get_process_info()** - Get detailed process information

#### Memory Operations  
- **read_memory_region(address, size, data_type)** - Read memory
- **get_memory_regions()** - Get virtual memory layout
- **scan_memory(pattern, start_address, end_address)** - Pattern search

#### Analysis Tools
- **analyze_structure(address, size)** - Structure analysis
- **disassemble_code(address, size, architecture)** - Code disassembly
- **resolve_pointer_chain(base_address, offsets)** - Pointer resolution

#### Advanced Features
- **import_cheat_table(file_path)** - Import .CT files
- **execute_lua_script(script_content, safe_mode)** - Lua analysis

### Data Types Reference

| Type | Size | Range | Use Case |
|------|------|-------|----------|
| `int8` | 1 byte | -128 to 127 | Small signed numbers |
| `uint8` | 1 byte | 0 to 255 | Bytes, characters |
| `int16` | 2 bytes | -32,768 to 32,767 | Short integers |
| `uint16` | 2 bytes | 0 to 65,535 | Port numbers |
| `int32` | 4 bytes | ±2.1 billion | Standard integers |
| `uint32` | 4 bytes | 0 to 4.2 billion | Addresses (32-bit) |
| `int64` | 8 bytes | ±9.2 quintillion | Large numbers |
| `uint64` | 8 bytes | 0 to 18.4 quintillion | Addresses (64-bit) |
| `float` | 4 bytes | ±3.4E±38 | Decimal numbers |
| `double` | 8 bytes | ±1.7E±308 | High precision decimals |

---

## ❓ FAQ

### General Questions

**Q: Is this tool safe to use?**
A: Yes, the server operates in read-only mode and cannot modify memory or harm your system.

**Q: Can I use this on games?**
A: Yes, but respect the terms of service of online games. This tool is primarily for educational and debugging purposes.

**Q: Do I need Cheat Engine installed?**
A: No, this is a standalone server that provides similar functionality through MCP.

### Technical Questions

**Q: Why do I need Administrator privileges?**
A: Windows requires elevated privileges to read memory from other processes for security reasons.

**Q: Can I run this on Mac or Linux?**
A: The server has limited support for Mac/Linux. Some Windows-specific features may not work.

**Q: How much memory does the server use?**
A: Typically 50-100MB, depending on the size of processes being analyzed.

### Usage Questions

**Q: What processes should I start with?**
A: Begin with simple programs like Notepad, Calculator, or your own test applications.

**Q: How do I find the right memory addresses?**
A: Use memory scanning to find patterns, then analyze the results to identify relevant addresses.

**Q: Can I save my analysis results?**
A: Yes, all tool results can be saved to files for later reference and analysis.

### Troubleshooting Questions

**Q: The server won't start - what should I check?**
A: Verify Python version (3.9+), install dependencies, and run as Administrator.

**Q: I can't attach to a process - why?**
A: Check the process whitelist, verify the process is running, and ensure you have Administrator privileges.

**Q: Memory reads are failing - what's wrong?**
A: The memory address may be invalid or protected. Use `get_memory_regions` to find readable areas.

---

## 📝 License & Credits

This project is licensed under the MIT License. Built with:
- **FastMCP** - Model Context Protocol implementation
- **Capstone** - Disassembly engine
- **psutil** - Process and system utilities
- **trio** - Async I/O framework

---

## 📞 Support

For additional help:
1. Review this documentation thoroughly
2. Check the troubleshooting section
3. Enable debug mode for detailed error information
4. Test with simple programs first

Remember: This tool is for educational and legitimate debugging purposes. Always respect software licenses and terms of service.
