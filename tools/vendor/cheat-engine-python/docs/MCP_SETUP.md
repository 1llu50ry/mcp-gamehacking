# 🔌 Claude Desktop MCP Setup Guide

## Overview

This guide shows you how to connect the MCP Cheat Engine Server to Claude Desktop so you can use memory analysis tools directly in your conversations with Claude.

## Prerequisites

- ✅ MCP Cheat Engine Server installed and working
- ✅ Claude Desktop application installed
- ✅ Python 3.9+ installed
- ✅ Administrator privileges (for memory access)

## Step-by-Step Setup

### Step 1: Find Your Claude Desktop Configuration

Claude Desktop stores its configuration in a JSON file. The location depends on your operating system:

**Windows:**
```
%APPDATA%\Claude\claude_desktop_config.json
```

**macOS:**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Linux:**
```
~/.config/Claude/claude_desktop_config.json
```

### Step 2: Open the Configuration File

1. **Close Claude Desktop** if it's running
2. **Navigate to the configuration directory**
3. **Open `claude_desktop_config.json`** in a text editor (create it if it doesn't exist)

### Step 3: Add the MCP Server Configuration

Add the following configuration to your `claude_desktop_config.json` file:

```json
{
  "mcpServers": {
    "cheat-engine": {
      "command": "python",
      "args": [
        "C:\\Users\\benam\\source\\dxt\\cheat-engine-server-python\\server\\main.py",
        "--debug",
        "--read-only"
      ],
      "cwd": "C:\\Users\\benam\\source\\dxt\\cheat-engine-server-python"
    }
  }
}
```

**⚠️ Important:** Replace `C:\\Users\\benam\\source\\dxt\\cheat-engine-server-python` with your actual installation path.

### Step 4: Customize for Your System

#### Option A: Use Full Python Path (Recommended)
If you want to be explicit about which Python to use:

```json
{
  "mcpServers": {
    "cheat-engine": {
      "command": "C:\\Python313\\python.exe",
      "args": [
        "C:\\Your\\Path\\To\\cheat-engine-server-python\\server\\main.py",
        "--debug",
        "--read-only"
      ],
      "cwd": "C:\\Your\\Path\\To\\cheat-engine-server-python"
    }
  }
}
```

#### Option B: Multiple MCP Servers
If you have other MCP servers, add them to the same configuration:

```json
{
  "mcpServers": {
    "cheat-engine": {
      "command": "python",
      "args": [
        "C:\\Your\\Path\\To\\cheat-engine-server-python\\server\\main.py",
        "--debug",
        "--read-only"
      ],
      "cwd": "C:\\Your\\Path\\To\\cheat-engine-server-python"
    },
    "other-server": {
      "command": "node",
      "args": ["path/to/other/server.js"]
    }
  }
}
```

### Step 5: Test the Configuration

1. **Save** the configuration file
2. **Restart Claude Desktop** completely
3. **Start a new conversation** in Claude Desktop
4. **Test the connection** by asking Claude:

```
Please list the available processes using the MCP Cheat Engine server.
```

If everything is working, Claude will use the `list_processes` tool and show you running processes.

## Verification

### Success Indicators

✅ **Claude responds with process list** - Server is working correctly  
✅ **No error messages** - Configuration is valid  
✅ **Tools appear in Claude's responses** - MCP connection established  

### Available Tools

Once connected, Claude can use these tools:

- `list_processes` - Show running processes
- `attach_to_process` - Connect to a process
- `read_memory_region` - Read memory data
- `scan_memory` - Search for patterns
- `analyze_structure` - Analyze data structures
- `disassemble_code` - Show assembly code
- `resolve_pointer_chain` - Follow pointers
- `import_cheat_table` - Load .CT files
- `execute_lua_script` - Run Lua scripts
- `detach_from_process` - Disconnect safely

## Troubleshooting

### Common Issues

#### ❌ "Server not found" or "Command failed"

**Causes:**
- Incorrect file paths in configuration
- Python not in PATH
- Server files missing

**Solutions:**
1. **Check file paths** - Ensure all paths are correct and use double backslashes (`\\`) on Windows
2. **Use full Python path** - Replace `"python"` with full path like `"C:\\Python313\\python.exe"`
3. **Test manually** - Run the server command in PowerShell to verify it works

#### ❌ "Permission denied" errors

**Causes:**
- Claude Desktop not running as Administrator
- Memory access requires elevated privileges

**Solutions:**
1. **Run Claude Desktop as Administrator**
2. **Verify your user account has admin privileges**
3. **Check Windows UAC settings**

#### ❌ Python import errors

**Causes:**
- Missing dependencies
- Wrong Python version
- Virtual environment issues

**Solutions:**
1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
2. **Check Python version:**
   ```bash
   python --version  # Should be 3.9+
   ```
3. **Test imports manually:**
   ```bash
   python -c "import mcp, trio, psutil, capstone; print('OK')"
   ```

#### ❌ Configuration file issues

**Causes:**
- Invalid JSON syntax
- Wrong file location
- File permissions

**Solutions:**
1. **Validate JSON** using an online JSON validator
2. **Check file location** - ensure you're editing the right file
3. **Check file permissions** - ensure Claude can read the file

### Testing Commands

#### Manual Server Test
```bash
cd C:\Your\Path\To\cheat-engine-server-python
python server/main.py --debug --read-only
```

#### Configuration Validation
Use an online JSON validator to check your `claude_desktop_config.json` syntax.

#### Dependency Check
```bash
python -c "
import sys
print(f'Python: {sys.version}')
import mcp; print('✅ mcp')
import trio; print('✅ trio') 
import psutil; print('✅ psutil')
import capstone; print('✅ capstone')
print('All dependencies OK!')
"
```

## Security Notes

### Safe Configuration

The recommended configuration includes safety flags:
- `--read-only` - Prevents memory modification
- `--debug` - Enables detailed logging

### Process Whitelist

The server only allows access to whitelisted processes defined in `process_whitelist.json`. This prevents accidental access to sensitive system processes.

### Administrator Privileges

Memory access requires Administrator privileges. Only run Claude Desktop as Administrator when you need to use the MCP Cheat Engine Server.

## Example Usage

Once configured, you can ask Claude things like:

- "Show me the running processes"
- "Attach to Notepad and read some memory"
- "Scan memory for a specific pattern"
- "Analyze the structure of data at this address"
- "Disassemble code at this location"

Claude will use the appropriate MCP tools to fulfill your requests.

## Next Steps

1. ✅ **Complete setup** using this guide
2. ✅ **Test connection** with a simple process list
3. ✅ **Read the main documentation** in `README.md`
4. ✅ **Follow the user guide** in `USER_GUIDE.md`
5. ✅ **Check the API reference** for advanced usage

---

**Need more help?** Check the main `README.md` file or the `FAQ.md` for additional troubleshooting tips.
